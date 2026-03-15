import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import React from 'react'
import { render } from 'ink'
import { agentLoop, type LoopConfig } from './loop.js'
import { RunnerPool, type SandboxMode } from './runner.js'
import { NativeRunner } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { loadCookMD } from './template.js'
import { loadConfig, loadDockerConfig, type AgentName, type CookConfig, type StepName } from './config.js'
import { logPhase, logStep, logOK, logWarn, logErr, BOLD, RESET } from './log.js'
import { RaceApp } from './ui/RaceApp.js'

interface StepSelection {
  agent: AgentName
  model: string
  sandbox: SandboxMode
}

interface RaceRunConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  stepConfig: Record<StepName, StepSelection>
  config: CookConfig
  runAgents: AgentName[]
  showRequest: boolean
  judgePrompt?: string
}

interface RunResult {
  index: number
  status: 'done' | 'error'
  logFile: string
  worktreePath: string
  branchName: string
  error?: string
}

// --- Worktree management ---

function sessionId(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function createWorktree(projectRoot: string, session: string, runIndex: number): { worktreePath: string; branchName: string } {
  const worktreePath = path.join(projectRoot, '.cook', 'race', session, `run-${runIndex}`)
  const branchName = `cook-race-${session}-${runIndex}`
  execSync(`git worktree add "${worktreePath}" -b "${branchName}" HEAD`, { cwd: projectRoot, stdio: 'pipe' })

  // Copy config files that may be gitignored
  const filesToCopy = ['.cook/config.json', '.cook/docker.json', 'COOK.md']
  for (const file of filesToCopy) {
    const src = path.join(projectRoot, file)
    const dst = path.join(worktreePath, file)
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.cpSync(src, dst)
    }
  }

  return { worktreePath, branchName }
}

function removeWorktree(projectRoot: string, worktreePath: string, branchName: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd: projectRoot, stdio: 'pipe' })
  } catch { /* already removed */ }
  try {
    execSync(`git branch -D "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' })
  } catch { /* already deleted */ }
}

// --- Runner factory ---

function createRunnerPool(worktreePath: string, config: CookConfig, runAgents: AgentName[]): RunnerPool {
  return new RunnerPool(async (mode: SandboxMode) => {
    switch (mode) {
      case 'agent':
        return new NativeRunner(worktreePath, config.env)
      case 'docker': {
        const Docker = (await import('dockerode')).default
        const { startSandbox } = await import('./sandbox.js')
        const dockerConfig = loadDockerConfig(worktreePath)
        return startSandbox(new Docker(), worktreePath, config.env, dockerConfig, runAgents)
      }
      case 'none':
        return new BareRunner(worktreePath, config.env)
    }
  })
}

// --- Judge ---

const JUDGE_PROMPT = `You are judging multiple parallel implementations of the same task.
Read the session logs below and select the best run.
Consider: correctness, completeness, code quality, and whether the gate passed.

Respond with PICK <N> on its own line (e.g. PICK 2), followed by a brief explanation of why this run is the best.`

function buildJudgePrompt(results: RunResult[], customJudgePrompt?: string): string {
  const logs = results
    .filter(r => r.status === 'done')
    .map(r => {
      const log = fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
      return `--- Run ${r.index} Log ---\n${log}`
    })
    .join('\n\n')

  const preamble = customJudgePrompt
    ? `${JUDGE_PROMPT}\n\nAdditional judging criteria: ${customJudgePrompt}`
    : JUDGE_PROMPT

  return `${preamble}\n\n${logs}`
}

function parseJudgeVerdict(output: string, maxRun: number): number | null {
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^PICK\s+(\d+)/i)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n >= 1 && n <= maxRun) return n
    }
  }
  return null
}

// --- User prompts ---

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== 'n')
    })
  })
}

// --- Main race function ---

export async function runRace(
  n: number,
  projectRoot: string,
  raceConfig: RaceRunConfig,
): Promise<void> {
  const session = sessionId()

  logPhase(`cook race \u2014 ${n} runs`)
  logStep(`Session: ${session}`)
  logStep(`Isolation: git worktrees`)

  // Ensure HEAD exists (empty repos have no commits yet)
  try {
    execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logStep('No commits yet — creating initial empty commit')
    execSync('git commit --allow-empty -m "initial (cook race)"', { cwd: projectRoot, stdio: 'pipe' })
  }

  // Create worktrees
  const worktrees: { worktreePath: string; branchName: string }[] = []
  for (let i = 1; i <= n; i++) {
    const wt = createWorktree(projectRoot, session, i)
    worktrees.push(wt)
    logOK(`Worktree run-${i}: ${wt.branchName}`)
  }

  // Create per-run emitters
  const emitters = worktrees.map(() => new EventEmitter())

  // Create per-run runner pools
  const pools = worktrees.map(wt =>
    createRunnerPool(wt.worktreePath, raceConfig.config, raceConfig.runAgents)
  )

  // Render compact TUI
  const { unmount, waitUntilExit } = render(
    React.createElement(RaceApp, {
      runCount: n,
      maxIterations: raceConfig.maxIterations,
      emitters,
      animation: raceConfig.config.animation,
    }),
    { exitOnCtrlC: false }
  )

  // Track log files per run
  const logFiles: string[] = new Array(n).fill('')
  for (let i = 0; i < n; i++) {
    emitters[i].on('logFile', (logFile: string) => { logFiles[i] = logFile })
  }

  // Launch all runs in parallel
  const cookMD = loadCookMD(projectRoot)
  const promises = worktrees.map((wt, i) => {
    const loopConfig: LoopConfig = {
      workPrompt: raceConfig.workPrompt,
      reviewPrompt: raceConfig.reviewPrompt,
      gatePrompt: raceConfig.gatePrompt,
      steps: raceConfig.stepConfig,
      maxIterations: raceConfig.maxIterations,
      projectRoot: wt.worktreePath,
    }
    return agentLoop(pools[i].get.bind(pools[i]), loopConfig, cookMD, emitters[i])
  })

  const settled = await Promise.allSettled(promises)

  // Wait for TUI to exit
  unmount()
  try { await waitUntilExit() } catch { /* ink may throw on unmount */ }

  // Stop all runners
  for (const pool of pools) {
    await pool.stopAll()
  }

  // Commit any changes the agents made in each worktree
  for (let i = 0; i < n; i++) {
    const wt = worktrees[i]
    try {
      // Stage all changes (new files, modifications, deletions)
      execSync('git add -A', { cwd: wt.worktreePath, stdio: 'pipe' })
      // Only commit if there are staged changes
      const status = execSync('git status --porcelain', { cwd: wt.worktreePath, encoding: 'utf8' }).trim()
      if (status) {
        execSync(`git commit -m "cook race run ${i + 1}"`, { cwd: wt.worktreePath, stdio: 'pipe' })
      }
    } catch { /* no changes to commit, or git error — skip */ }
  }

  // Build results
  const results: RunResult[] = settled.map((result, i) => ({
    index: i + 1,
    status: result.status === 'fulfilled' ? 'done' as const : 'error' as const,
    logFile: logFiles[i],
    worktreePath: worktrees[i].worktreePath,
    branchName: worktrees[i].branchName,
    error: result.status === 'rejected' ? String(result.reason) : undefined,
  }))

  // Print summary
  console.error('')
  logPhase('Race results')
  for (const r of results) {
    if (r.status === 'done') {
      logOK(`Run ${r.index}: done (${r.branchName})`)
    } else {
      logErr(`Run ${r.index}: error \u2014 ${r.error}`)
    }
    logStep(`  Log: ${r.logFile}`)
  }

  const successfulRuns = results.filter(r => r.status === 'done')

  if (successfulRuns.length === 0) {
    logErr('All runs failed. No winner to pick.')
    await cleanupAll(projectRoot, results, session)
    return
  }

  if (successfulRuns.length === 1) {
    logOK(`Only Run ${successfulRuns[0].index} succeeded \u2014 auto-selecting as winner.`)
    await applyAndCleanup(projectRoot, results, successfulRuns[0].index, session)
    return
  }

  // Judge step
  logPhase('Judging runs')
  logStep('Spawning judge agent to compare results...')

  const judgePrompt = buildJudgePrompt(results, raceConfig.judgePrompt)
  const gateStep = raceConfig.stepConfig.gate
  const judgePool = createRunnerPool(projectRoot, raceConfig.config, raceConfig.runAgents)

  let judgeOutput: string
  try {
    const runner = await judgePool.get(gateStep.sandbox)
    judgeOutput = await runner.runAgent(gateStep.agent, gateStep.model, judgePrompt, (line) => {
      console.error(`  ${line}`)
    })
  } catch (err) {
    logErr(`Judge failed: ${err}`)
    logWarn('You can manually compare branches and merge the winner.')
    for (const r of results) {
      logStep(`  Run ${r.index}: git diff HEAD...${r.branchName}`)
    }
    await judgePool.stopAll()
    return
  }
  await judgePool.stopAll()

  const winner = parseJudgeVerdict(judgeOutput, n)
  if (winner === null) {
    logWarn('Judge did not return a clear PICK. You can manually compare:')
    for (const r of successfulRuns) {
      logStep(`  Run ${r.index}: git diff HEAD...${r.branchName}`)
    }
    return
  }

  console.error('')
  logOK(`Judge picked Run ${winner}`)
  await applyAndCleanup(projectRoot, results, winner, session)
}

async function applyAndCleanup(
  projectRoot: string,
  results: RunResult[],
  winner: number,
  session: string,
): Promise<void> {
  const winnerResult = results.find(r => r.index === winner)!

  const shouldApply = await confirm(`\n  Apply Run ${winner} to current branch? [Y/n] `)
  if (shouldApply) {
    try {
      execSync(`git merge "${winnerResult.branchName}" --no-edit`, { cwd: projectRoot, stdio: 'pipe' })
      logOK(`Merged ${winnerResult.branchName} into current branch`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logWarn(`Merge failed: ${msg}`)
      logStep(`  cd ${projectRoot} && git status`)
      return
    }
  } else {
    logStep(`Skipped merge. Winner branch: ${winnerResult.branchName}`)
    logStep(`  To apply later: git merge ${winnerResult.branchName}`)
  }

  await cleanupAll(projectRoot, results, session)
}

async function cleanupAll(
  projectRoot: string,
  results: RunResult[],
  session: string,
): Promise<void> {
  const shouldClean = await confirm(`  Remove race worktrees and branches? [Y/n] `)
  if (shouldClean) {
    for (const r of results) {
      removeWorktree(projectRoot, r.worktreePath, r.branchName)
    }
    // Remove session directory
    const sessionDir = path.join(projectRoot, '.cook', 'race', session)
    try { fs.rmSync(sessionDir, { recursive: true }) } catch { /* ok */ }
    // Remove race dir if empty
    const raceDir = path.join(projectRoot, '.cook', 'race')
    try {
      const remaining = fs.readdirSync(raceDir)
      if (remaining.length === 0) fs.rmdirSync(raceDir)
    } catch { /* ok */ }
    logOK('Cleaned up race worktrees and branches')
  } else {
    logStep('Race worktrees preserved. To clean up later:')
    for (const r of results) {
      logStep(`  git worktree remove ${r.worktreePath} --force && git branch -D ${r.branchName}`)
    }
  }
}
