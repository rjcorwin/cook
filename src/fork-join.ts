import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import { agentLoop, type LoopConfig } from './loop.js'
import { loadCookMD } from './template.js'
import type { AgentName, CookConfig, StepName, StepSelection } from './config.js'
import { logPhase, logStep, logOK, logWarn, logErr } from './log.js'
import {
  sessionId,
  createWorktree,
  removeWorktree,
  createRunnerPool,
  buildJudgePrompt,
  parseJudgeVerdict,
  confirm,
  type RunResult,
} from './race.js'
import { RaceApp } from './ui/RaceApp.js'

// --- Cleanup registry for SIGINT/SIGTERM ---

type CleanupFn = () => Promise<void>
const activeCleanups: Set<CleanupFn> = new Set()

function registerCleanup(fn: CleanupFn): () => void {
  activeCleanups.add(fn)
  return () => { activeCleanups.delete(fn) }
}

export async function cleanupActiveForkJoins(): Promise<void> {
  for (const fn of activeCleanups) {
    try { await fn() } catch { /* best effort */ }
  }
  activeCleanups.clear()
}

// --- Types ---

export interface ForkJoinBranch {
  work: string
  review: string
  gate: string
  maxIterations: number
}

export interface ForkJoinConfig {
  branches: ForkJoinBranch[]
  join:
    | { type: 'judge'; criteria: string }
    | { type: 'merge'; criteria: string; maxIterations: number }
    | { type: 'summarize' }
  parallel: { count: number; criteria: string | null } | null
}

interface ForkJoinRunConfig {
  forkJoin: ForkJoinConfig
  stepConfig: Record<StepName, StepSelection>
  config: CookConfig
  runAgents: AgentName[]
  showRequest: boolean
}

interface BranchResult {
  index: number
  status: 'done' | 'error'
  logFile: string
  worktreePath: string
  branchName: string
  error?: string
}

interface InstanceResult {
  instanceIndex: number
  winner?: BranchResult
  mergeWorktree?: { worktreePath: string; branchName: string }
  comparisonPath?: string
  branchResults: BranchResult[]
}

// --- Fork-Join Instance ---

async function runForkJoinInstance(
  forkJoinConfig: ForkJoinConfig,
  runConfig: ForkJoinRunConfig,
  projectRoot: string,
  session: string,
  instanceIndex: number,
): Promise<InstanceResult> {
  const { branches, join } = forkJoinConfig

  // Record base commit so we can diff against it after branches commit
  const baseCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim()

  // Create worktrees for each branch
  const worktrees: { worktreePath: string; branchName: string }[] = []
  for (let j = 1; j <= branches.length; j++) {
    const wtPath = path.join(projectRoot, '.cook', 'fork', session, `inst-${instanceIndex}-branch-${j}`)
    const branch = `cook-fork-${session}-${instanceIndex}-${j}`
    const wt = createWorktree(projectRoot, wtPath, branch)
    worktrees.push(wt)
    logOK(`Worktree inst-${instanceIndex}-branch-${j}: ${wt.branchName}`)
  }

  // Create per-branch emitters and runner pools
  const emitters = worktrees.map(() => new EventEmitter())
  const pools = worktrees.map(wt =>
    createRunnerPool(wt.worktreePath, runConfig.config, runConfig.runAgents)
  )

  // Render TUI (branches are the "runs")
  const { unmount, waitUntilExit } = render(
    React.createElement(RaceApp, {
      runCount: branches.length,
      maxIterations: Math.max(...branches.map(b => b.maxIterations)),
      emitters,
      animation: runConfig.config.animation,
    }),
    { exitOnCtrlC: false }
  )

  // Register cleanup so SIGINT can tear down this instance
  const unregister = registerCleanup(async () => {
    unmount()
    for (const pool of pools) {
      await pool.stopAll()
    }
  })

  // Track log files
  const logFiles: string[] = new Array(branches.length).fill('')
  for (let i = 0; i < branches.length; i++) {
    emitters[i].on('logFile', (logFile: string) => { logFiles[i] = logFile })
  }

  // Launch all branches in parallel
  const cookMD = loadCookMD(projectRoot)
  const promises = worktrees.map((wt, i) => {
    const branch = branches[i]
    const loopConfig: LoopConfig = {
      workPrompt: branch.work,
      reviewPrompt: branch.review,
      gatePrompt: branch.gate,
      steps: runConfig.stepConfig,
      maxIterations: branch.maxIterations,
      projectRoot: wt.worktreePath,
    }
    return agentLoop(pools[i].get.bind(pools[i]), loopConfig, cookMD, emitters[i])
  })

  const settled = await Promise.allSettled(promises)

  // Clean up TUI
  unmount()
  try { await waitUntilExit() } catch { /* ink may throw on unmount */ }

  // Stop all runners
  for (const pool of pools) {
    await pool.stopAll()
  }
  unregister()

  // Commit changes in each worktree
  for (let i = 0; i < branches.length; i++) {
    const wt = worktrees[i]
    try {
      execSync('git add -A', { cwd: wt.worktreePath, stdio: 'pipe' })
      const status = execSync('git status --porcelain', { cwd: wt.worktreePath, encoding: 'utf8' }).trim()
      if (status) {
        execSync(`git commit -m "cook fork-join branch ${i + 1}"`, { cwd: wt.worktreePath, stdio: 'pipe' })
      }
    } catch (err) {
      logWarn(`Branch ${i + 1} commit failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Build results
  const branchResults: BranchResult[] = settled.map((result, i) => ({
    index: i + 1,
    status: result.status === 'fulfilled' ? 'done' as const : 'error' as const,
    logFile: logFiles[i],
    worktreePath: worktrees[i].worktreePath,
    branchName: worktrees[i].branchName,
    error: result.status === 'rejected' ? String(result.reason) : undefined,
  }))

  // Print summary
  console.error('')
  logPhase(`Fork-join instance ${instanceIndex} results`)
  for (const r of branchResults) {
    if (r.status === 'done') {
      logOK(`Branch ${r.index}: done (${r.branchName})`)
    } else {
      logErr(`Branch ${r.index}: error — ${r.error}`)
    }
    logStep(`  Log: ${r.logFile}`)
  }

  const successfulBranches = branchResults.filter(r => r.status === 'done')

  if (successfulBranches.length === 0) {
    logErr('All branches failed. Cannot join.')
    return { instanceIndex, branchResults }
  }

  // Dispatch to join strategy
  switch (join.type) {
    case 'judge':
      return judgeInstance(branchResults, join.criteria, projectRoot, runConfig, session, instanceIndex)
    case 'merge':
      return mergeInstance(branchResults, join.criteria, join.maxIterations, projectRoot, runConfig, session, instanceIndex, baseCommit)
    case 'summarize':
      return summarizeInstance(branchResults, projectRoot, runConfig, session, instanceIndex, baseCommit)
  }
}

// --- Join: Judge ---

async function judgeInstance(
  branchResults: BranchResult[],
  criteria: string,
  projectRoot: string,
  runConfig: ForkJoinRunConfig,
  session: string,
  instanceIndex: number,
): Promise<InstanceResult> {
  const successfulBranches = branchResults.filter(r => r.status === 'done')

  if (successfulBranches.length === 1) {
    logOK(`Only Branch ${successfulBranches[0].index} succeeded — auto-selecting as winner.`)
    return { instanceIndex, winner: successfulBranches[0], branchResults }
  }

  logPhase('Judging branches')
  logStep('Spawning judge agent to compare branches...')

  // Build RunResult-compatible objects for buildJudgePrompt
  const runResults: RunResult[] = branchResults.map(r => ({
    index: r.index,
    status: r.status,
    logFile: r.logFile,
    worktreePath: r.worktreePath,
    branchName: r.branchName,
    error: r.error,
  }))

  const judgePromptText = buildJudgePrompt(runResults, criteria)
  const gateStep = runConfig.stepConfig.gate
  const judgePool = createRunnerPool(projectRoot, runConfig.config, runConfig.runAgents)

  let judgeOutput: string
  try {
    const runner = await judgePool.get(gateStep.sandbox)
    judgeOutput = await runner.runAgent(gateStep.agent, gateStep.model, judgePromptText, (line) => {
      console.error(`  ${line}`)
    })
  } catch (err) {
    logErr(`Judge failed: ${err}`)
    logWarn('You can manually compare branches.')
    for (const r of branchResults) {
      logStep(`  Branch ${r.index}: ${r.worktreePath}`)
    }
    await judgePool.stopAll()
    return { instanceIndex, branchResults }
  }
  await judgePool.stopAll()

  const winner = parseJudgeVerdict(judgeOutput, branchResults.length)
  if (winner === null) {
    logWarn('Judge did not return a clear PICK. You can manually compare:')
    for (const r of successfulBranches) {
      logStep(`  Branch ${r.index}: ${r.worktreePath}`)
    }
    return { instanceIndex, branchResults }
  }

  logOK(`Judge picked Branch ${winner}`)
  const winnerResult = branchResults.find(r => r.index === winner)!
  return { instanceIndex, winner: winnerResult, branchResults }
}

// --- Join: Merge ---

async function mergeInstance(
  branchResults: BranchResult[],
  criteria: string,
  maxIterations: number,
  projectRoot: string,
  runConfig: ForkJoinRunConfig,
  session: string,
  instanceIndex: number,
  baseCommit: string,
): Promise<InstanceResult> {
  const successfulBranches = branchResults.filter(r => r.status === 'done')

  if (successfulBranches.length === 0) {
    logErr('No successful branches to merge.')
    return { instanceIndex, branchResults }
  }

  if (successfulBranches.length === 1) {
    logOK(`Only Branch ${successfulBranches[0].index} succeeded — using it as merge result.`)
    return { instanceIndex, winner: successfulBranches[0], branchResults }
  }

  logPhase('Merging branches')
  logStep('Creating merge worktree and synthesizing...')

  // Create merge worktree
  const mergeWtPath = path.join(projectRoot, '.cook', 'fork', session, `inst-${instanceIndex}-merge`)
  const mergeBranch = `cook-fork-${session}-${instanceIndex}-merge`
  const mergeWt = createWorktree(projectRoot, mergeWtPath, mergeBranch)
  logOK(`Merge worktree: ${mergeWt.branchName}`)

  // Collect diffs and logs from each branch (diff against base commit)
  const branchContextParts: string[] = []
  for (const r of successfulBranches) {
    let diff = ''
    try {
      diff = execSync(`git diff ${baseCommit}..HEAD`, { cwd: r.worktreePath, encoding: 'utf8' })
    } catch { /* no diff */ }
    const log = fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
    branchContextParts.push(
      `--- Branch ${r.index} Diff ---\n${diff || '(no changes)'}\n\n--- Branch ${r.index} Log ---\n${log}`
    )
  }

  // Write MERGE_CONTEXT.md into the merge worktree
  const mergeContextContent = `# Merge Context

You are synthesizing the best parts of multiple parallel explorations.

## Criteria
${criteria}

## Branch Results

${branchContextParts.join('\n\n')}
`
  fs.writeFileSync(path.join(mergeWt.worktreePath, 'MERGE_CONTEXT.md'), mergeContextContent)

  // Build merge work prompt
  const mergeWorkPrompt = `Synthesize the best parts of the provided branches. Read MERGE_CONTEXT.md for the branch diffs and logs.

Criteria: ${criteria}

Combine the strongest elements from each branch into a single coherent implementation.`

  // Use branch 1's review/gate prompts as defaults
  const branch1 = runConfig.forkJoin.branches[0]

  // Run agentLoop in merge worktree with TUI for progress feedback
  const mergeEmitter = new EventEmitter()
  const mergePool = createRunnerPool(mergeWt.worktreePath, runConfig.config, runConfig.runAgents)
  const cookMD = loadCookMD(projectRoot)

  const { unmount: unmountMerge, waitUntilExit: waitMergeExit } = render(
    React.createElement(RaceApp, {
      runCount: 1,
      maxIterations,
      emitters: [mergeEmitter],
      animation: runConfig.config.animation,
    }),
    { exitOnCtrlC: false }
  )

  const mergeLoopConfig: LoopConfig = {
    workPrompt: mergeWorkPrompt,
    reviewPrompt: branch1.review,
    gatePrompt: branch1.gate,
    steps: runConfig.stepConfig,
    maxIterations,
    projectRoot: mergeWt.worktreePath,
  }

  try {
    await agentLoop(mergePool.get.bind(mergePool), mergeLoopConfig, cookMD, mergeEmitter)
  } catch (err) {
    logErr(`Merge loop failed: ${err}`)
  }

  unmountMerge()
  try { await waitMergeExit() } catch { /* ink may throw on unmount */ }
  await mergePool.stopAll()

  // Remove MERGE_CONTEXT.md so it doesn't get committed into the project
  const mergeContextPath = path.join(mergeWt.worktreePath, 'MERGE_CONTEXT.md')
  try { fs.unlinkSync(mergeContextPath) } catch { /* already removed or never created */ }

  // Commit merge result
  try {
    execSync('git add -A', { cwd: mergeWt.worktreePath, stdio: 'pipe' })
    const status = execSync('git status --porcelain', { cwd: mergeWt.worktreePath, encoding: 'utf8' }).trim()
    if (status) {
      execSync('git commit -m "cook fork-join merge"', { cwd: mergeWt.worktreePath, stdio: 'pipe' })
    }
  } catch (err) {
    logWarn(`Merge worktree commit failed: ${err instanceof Error ? err.message : err}`)
  }

  logOK('Merge complete')
  return {
    instanceIndex,
    mergeWorktree: mergeWt,
    branchResults,
  }
}

// --- Join: Summarize ---

async function summarizeInstance(
  branchResults: BranchResult[],
  projectRoot: string,
  runConfig: ForkJoinRunConfig,
  session: string,
  instanceIndex: number,
  baseCommit: string,
): Promise<InstanceResult> {
  const successfulBranches = branchResults.filter(r => r.status === 'done')

  if (successfulBranches.length === 0) {
    logErr('No successful branches to summarize.')
    return { instanceIndex, branchResults }
  }

  logPhase('Summarizing branches')
  logStep('Spawning agent to build comparison...')

  // Collect diffs and logs (diff against base commit)
  const branchContextParts: string[] = []
  for (const r of successfulBranches) {
    let diff = ''
    try {
      diff = execSync(`git diff ${baseCommit}..HEAD`, { cwd: r.worktreePath, encoding: 'utf8' })
    } catch { /* no diff */ }
    const log = fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
    branchContextParts.push(
      `--- Branch ${r.index} Diff ---\n${diff || '(no changes)'}\n\n--- Branch ${r.index} Log ---\n${log}`
    )
  }

  const summarizePrompt = `You are comparing multiple parallel implementations of different approaches.
Review the branch diffs and logs below and produce a structured comparison document in Markdown.

For each branch, summarize:
- What approach was taken
- Key strengths
- Key weaknesses
- Notable implementation details

Then provide an overall recommendation with reasoning.

${branchContextParts.join('\n\n')}`

  const gateStep = runConfig.stepConfig.gate
  const summarizePool = createRunnerPool(projectRoot, runConfig.config, runConfig.runAgents)

  let summaryOutput: string
  try {
    const runner = await summarizePool.get(gateStep.sandbox)
    summaryOutput = await runner.runAgent(gateStep.agent, gateStep.model, summarizePrompt, (line) => {
      console.error(`  ${line}`)
    })
  } catch (err) {
    logErr(`Summarize failed: ${err}`)
    await summarizePool.stopAll()
    return { instanceIndex, branchResults }
  }
  await summarizePool.stopAll()

  // Write comparison to .cook/ with session-stamped name to avoid overwriting user files
  const comparisonDir = path.join(projectRoot, '.cook', 'fork')
  fs.mkdirSync(comparisonDir, { recursive: true })
  const comparisonPath = path.join(comparisonDir, `comparison-${session}.md`)
  fs.writeFileSync(comparisonPath, summaryOutput)
  logOK(`Comparison written to ${comparisonPath}`)

  // Print worktree paths for human inspection
  logStep('Branch worktrees preserved for inspection:')
  for (const r of successfulBranches) {
    logStep(`  Branch ${r.index}: ${r.worktreePath}`)
  }

  return { instanceIndex, comparisonPath, branchResults }
}

// --- Main entry point ---

export async function runForkJoin(
  projectRoot: string,
  runConfig: ForkJoinRunConfig,
): Promise<void> {
  const { forkJoin } = runConfig
  const session = sessionId()

  logPhase(`cook fork-join — ${forkJoin.branches.length} branches`)
  logStep(`Session: ${session}`)
  logStep(`Join strategy: ${forkJoin.join.type}`)
  if (forkJoin.parallel) {
    logStep(`Meta-parallelism: x${forkJoin.parallel.count}`)
  }

  // Ensure HEAD exists
  try {
    execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logStep('No commits yet — creating initial empty commit')
    execSync('git commit --allow-empty -m "initial (cook fork-join)"', { cwd: projectRoot, stdio: 'pipe' })
  }

  const instanceCount = forkJoin.parallel?.count ?? 1

  if (instanceCount === 1) {
    // Single instance
    const result = await runForkJoinInstance(forkJoin, runConfig, projectRoot, session, 1)
    await handleInstanceResult(result, projectRoot, session, forkJoin)
  } else {
    // Meta-parallelism: run N fork-join instances sequentially
    // (each instance renders its own TUI, so they can't overlap)
    logPhase(`Running ${instanceCount} fork-join instances`)

    const instanceResults: InstanceResult[] = []
    for (let i = 0; i < instanceCount; i++) {
      logStep(`Starting instance ${i + 1} of ${instanceCount}`)
      try {
        const result = await runForkJoinInstance(forkJoin, runConfig, projectRoot, session, i + 1)
        instanceResults.push(result)
      } catch (err) {
        logErr(`Instance ${i + 1} failed: ${err}`)
      }
    }

    if (instanceResults.length === 0) {
      logErr('All instances failed.')
      return
    }

    // Meta-judge: pick the best among instance winners
    const winners = instanceResults.filter(r => r.winner || r.mergeWorktree)
    if (winners.length === 0) {
      logWarn('No instance produced a winner. Branch worktrees preserved for manual inspection.')
      return
    }

    if (winners.length === 1) {
      logOK(`Only instance ${winners[0].instanceIndex} produced a result — auto-selecting.`)
      await handleInstanceResult(winners[0], projectRoot, session, forkJoin)
      // Clean up losing instances
      for (const r of instanceResults) {
        if (r !== winners[0]) {
          cleanupInstanceWorktrees(projectRoot, r)
        }
      }
      return
    }

    // Build RunResult-compatible array for meta-judging
    logPhase('Meta-judge: comparing instance winners')
    const metaResults: RunResult[] = winners.map((w, i) => {
      const source = w.mergeWorktree ?? w.winner!
      return {
        index: i + 1,
        status: 'done' as const,
        logFile: w.winner?.logFile ?? '',
        worktreePath: source.worktreePath,
        branchName: source.branchName,
      }
    })

    const metaCriteria = forkJoin.parallel!.criteria ?? (forkJoin.join.type !== 'summarize' ? (forkJoin.join as { criteria: string }).criteria : '')
    const metaJudgePrompt = buildJudgePrompt(metaResults, metaCriteria)
    const gateStep = runConfig.stepConfig.gate
    const metaPool = createRunnerPool(projectRoot, runConfig.config, runConfig.runAgents)

    let metaOutput: string
    try {
      const runner = await metaPool.get(gateStep.sandbox)
      metaOutput = await runner.runAgent(gateStep.agent, gateStep.model, metaJudgePrompt, (line) => {
        console.error(`  ${line}`)
      })
    } catch (err) {
      logErr(`Meta-judge failed: ${err}`)
      await metaPool.stopAll()
      return
    }
    await metaPool.stopAll()

    const metaWinner = parseJudgeVerdict(metaOutput, winners.length)
    if (metaWinner === null) {
      logWarn('Meta-judge did not return a clear PICK.')
      return
    }

    logOK(`Meta-judge picked instance ${winners[metaWinner - 1].instanceIndex}`)
    await handleInstanceResult(winners[metaWinner - 1], projectRoot, session, forkJoin)
    // Clean up all losing instances
    for (const r of instanceResults) {
      if (r !== winners[metaWinner - 1]) {
        cleanupInstanceWorktrees(projectRoot, r)
      }
    }
  }
}

// --- Post-run handling ---

function cleanupInstanceWorktrees(projectRoot: string, result: InstanceResult): void {
  for (const r of result.branchResults) {
    removeWorktree(projectRoot, r.worktreePath, r.branchName)
  }
  if (result.mergeWorktree) {
    removeWorktree(projectRoot, result.mergeWorktree.worktreePath, result.mergeWorktree.branchName)
  }
}

async function handleInstanceResult(
  result: InstanceResult,
  projectRoot: string,
  session: string,
  forkJoinConfig: ForkJoinConfig,
): Promise<void> {
  if (forkJoinConfig.join.type === 'summarize') {
    if (result.comparisonPath) {
      logOK(`Comparison: ${result.comparisonPath}`)
    }
    const shouldClean = await confirm('  Remove fork-join worktrees? [Y/n] ')
    if (shouldClean) {
      await cleanupForkJoin(projectRoot, result, session)
    } else {
      logStep('Worktrees preserved.')
    }
    return
  }

  // Judge or merge — we have a winner or merge worktree to apply
  const winnerBranch = result.mergeWorktree ?? result.winner
  if (!winnerBranch) {
    logWarn('No winner produced.')
    return
  }

  const shouldApply = await confirm(`\n  Apply ${winnerBranch.branchName} to current branch? [Y/n] `)
  if (shouldApply) {
    try {
      execSync(`git merge "${winnerBranch.branchName}" --no-edit`, { cwd: projectRoot, stdio: 'pipe' })
      logOK(`Merged ${winnerBranch.branchName} into current branch`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logWarn(`Merge failed: ${msg}`)
      logStep(`  cd ${projectRoot} && git status`)
      return
    }
    await cleanupForkJoin(projectRoot, result, session)
  } else {
    logStep(`Skipped merge. Winner branch: ${winnerBranch.branchName}`)
    logStep(`  To apply later: git merge ${winnerBranch.branchName}`)
    logStep('Fork-join worktrees preserved.')
  }
}

async function cleanupForkJoin(
  projectRoot: string,
  result: InstanceResult,
  session: string,
): Promise<void> {
  const shouldClean = await confirm('  Remove fork-join worktrees and branches? [Y/n] ')
  if (shouldClean) {
    for (const r of result.branchResults) {
      removeWorktree(projectRoot, r.worktreePath, r.branchName)
    }
    if (result.mergeWorktree) {
      removeWorktree(projectRoot, result.mergeWorktree.worktreePath, result.mergeWorktree.branchName)
    }
    // Remove session directory
    const sessionDir = path.join(projectRoot, '.cook', 'fork', session)
    try { fs.rmSync(sessionDir, { recursive: true }) } catch { /* ok */ }
    // Remove fork dir if empty
    const forkDir = path.join(projectRoot, '.cook', 'fork')
    try {
      const remaining = fs.readdirSync(forkDir)
      if (remaining.length === 0) fs.rmdirSync(forkDir)
    } catch { /* ok */ }
    logOK('Cleaned up fork-join worktrees and branches')
  } else {
    logStep('Fork-join worktrees preserved. To clean up later:')
    for (const r of result.branchResults) {
      logStep(`  git worktree remove ${r.worktreePath} --force && git branch -D ${r.branchName}`)
    }
    if (result.mergeWorktree) {
      logStep(`  git worktree remove ${result.mergeWorktree.worktreePath} --force && git branch -D ${result.mergeWorktree.branchName}`)
    }
  }
}
