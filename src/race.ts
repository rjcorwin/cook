// src/race.ts — Worktree, runner, and judge utilities for composition

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import type { AgentName, CookConfig, StepName, StepSelection } from './config.js'
import { RunnerPool, type SandboxMode } from './runner.js'
import { NativeRunner } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { loadDockerConfig } from './config.js'

export interface RunResult {
  index: number
  status: 'done' | 'error'
  logFile: string
  worktreePath: string
  branchName: string
  error?: string
}

// --- Session ID ---

export function sessionId(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}`
}

// --- Worktree management ---

export function createWorktree(projectRoot: string, worktreePath: string, branchName: string): { worktreePath: string; branchName: string } {
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

export function removeWorktree(projectRoot: string, worktreePath: string, branchName: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd: projectRoot, stdio: 'pipe' })
  } catch { /* already removed */ }
  try {
    execSync(`git branch -D "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' })
  } catch { /* already deleted */ }
}

// --- Runner factory ---

export function createRunnerPool(worktreePath: string, config: CookConfig, runAgents: AgentName[]): RunnerPool {
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

// --- Pick (Judge) ---

const JUDGE_PROMPT = `You are judging multiple parallel implementations of the same task.
Read the session logs below and select the best run.
Consider: correctness, completeness, code quality, and whether the gate passed.

Respond with PICK <N> on its own line (e.g. PICK 2), followed by a brief explanation of why this run is the best.`

export function buildJudgePrompt(results: RunResult[], customCriteria?: string): string {
  const logs = results
    .filter(r => r.status === 'done')
    .map(r => {
      const log = fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
      return `--- Run ${r.index} Log ---\n${log}`
    })
    .join('\n\n')

  const preamble = customCriteria
    ? `${JUDGE_PROMPT}\n\nAdditional criteria: ${customCriteria}`
    : JUDGE_PROMPT

  return `${preamble}\n\n${logs}`
}

export function parseJudgeVerdict(output: string, maxRun: number): number | null {
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

export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== 'n')
    })
  })
}

export function pickOne(question: string, count: number): Promise<number | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      const n = parseInt(answer.trim(), 10)
      resolve(!isNaN(n) && n >= 1 && n <= count ? n : null)
    })
  })
}
