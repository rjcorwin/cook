// src/executor.ts — Recursive executor that walks the AST

import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import type { Node, Resolver, ParsedFlags } from './parser.js'
import type { AgentName, CookConfig, StepName, StepSelection } from './config.js'
import { agentLoop, loopEvents, type LoopConfig, type LoopResult } from './loop.js'
import { renderTemplate } from './template.js'
import { loadCookMD } from './template.js'
import { createSessionLog, appendToLog } from './log.js'
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
import { retryOnRateLimit } from './retry.js'
import { logPhase, logStep, logOK, logWarn, logErr } from './log.js'
import { RaceApp } from './ui/RaceApp.js'
import { App } from './ui/App.js'

// --- Execution Context ---

export interface ExecutionContext {
  projectRoot: string
  config: CookConfig
  flags: ParsedFlags
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
  cookMD: string
  showRequest: boolean
  // Threading state
  lastMessage: string
  repeatPass?: number
  maxRepeatPasses?: number
  ralphIteration?: number
  maxRalph?: number
}

export interface ExecutionResult {
  lastMessage: string
  logFile?: string
  verdict?: 'DONE' | 'ITERATE' | 'MAX_ITERATIONS'
  iterations?: number
}

// --- Cleanup registry ---

type CleanupFn = () => Promise<void>
const activeCleanups: Set<CleanupFn> = new Set()

function registerCleanup(fn: CleanupFn): () => void {
  activeCleanups.add(fn)
  return () => { activeCleanups.delete(fn) }
}

export async function cleanupActiveExecutions(): Promise<void> {
  await Promise.allSettled(Array.from(activeCleanups).map(fn => fn()))
  activeCleanups.clear()
}

// --- Main executor ---

export async function execute(node: Node, ctx: ExecutionContext): Promise<ExecutionResult> {
  switch (node.type) {
    case 'work':
      return executeWork(node, ctx)
    case 'repeat':
      return executeRepeat(node, ctx)
    case 'review':
      return executeReview(node, ctx)
    case 'ralph':
      return executeRalph(node, ctx)
    case 'composition':
      return executeComposition(node, ctx)
  }
}

// --- Default prompts ---

const DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`

// --- Work: single agent call ---

async function executeWork(node: { type: 'work'; prompt: string }, ctx: ExecutionContext): Promise<ExecutionResult> {
  const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
  const unregister = registerCleanup(async () => { await pool.stopAll() })

  // Render TUI — App listens on the module-level loopEvents singleton
  const { unmount, waitUntilExit } = render(
    React.createElement(App, {
      maxIterations: 1,
      model: ctx.stepConfig.work.model,
      agent: ctx.stepConfig.work.agent,
      showRequest: ctx.showRequest,
      animation: ctx.config.animation,
    }),
    { exitOnCtrlC: false }
  )

  try {
    const logFile = createSessionLog(ctx.projectRoot)
    loopEvents.emit('logFile', logFile)

    loopEvents.emit('step', {
      step: 'work',
      iteration: 1,
      agent: ctx.stepConfig.work.agent,
      model: ctx.stepConfig.work.model,
    })

    const prompt = renderTemplate(ctx.cookMD, {
      step: 'work',
      prompt: node.prompt,
      lastMessage: ctx.lastMessage,
      iteration: 1,
      maxIterations: 1,
      logFile,
      ralphIteration: ctx.ralphIteration,
      maxRalph: ctx.maxRalph,
      repeatPass: ctx.repeatPass,
      maxRepeatPasses: ctx.maxRepeatPasses,
    })

    loopEvents.emit('prompt', prompt)
    const runner = await pool.get(ctx.stepConfig.work.sandbox)
    const output = await retryOnRateLimit(
      () => runner.runAgent(ctx.stepConfig.work.agent, ctx.stepConfig.work.model, prompt, (line) => {
        loopEvents.emit('line', line)
      }),
      ctx.config.retry,
      (info) => loopEvents.emit('waiting', info),
      (info) => loopEvents.emit('retry', info),
    )

    try {
      appendToLog(logFile, 'work', 1, output)
    } catch { /* ok */ }

    loopEvents.emit('done')
    unmount()
    try { await waitUntilExit() } catch { /* ok */ }

    return { lastMessage: output, logFile }
  } finally {
    await pool.stopAll()
    unregister()
  }
}

// --- Repeat: sequential repetition ---

async function executeRepeat(
  node: { type: 'repeat'; inner: Node; count: number },
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  let result: ExecutionResult = { lastMessage: ctx.lastMessage }

  for (let pass = 1; pass <= node.count; pass++) {
    logStep(`Repeat pass ${pass}/${node.count}`)
    result = await execute(node.inner, {
      ...ctx,
      lastMessage: result.lastMessage,
      repeatPass: pass,
      maxRepeatPasses: node.count,
    })
  }

  return result
}

// --- Review: work→review→gate loop ---

async function executeReview(
  node: { type: 'review'; inner: Node; reviewPrompt?: string; gatePrompt?: string; iteratePrompt?: string; maxIterations: number },
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
  const unregister = registerCleanup(async () => { await pool.stopAll() })

  // Determine work prompt from inner node
  let workPrompt: string
  if (node.inner.type === 'work') {
    workPrompt = node.inner.prompt
  } else {
    // For compound inner nodes (e.g., review wrapping repeat),
    // execute the inner node first, then run the review loop on its output
    const innerResult = await execute(node.inner, ctx)

    // Run the review loop using agentLoop (work→review→gate), where
    // the "work" prompt here is for iterate steps
    const iteratePrompt = node.iteratePrompt ?? 'Continue working on the task based on the review feedback.'

    // Render TUI — agentLoop emits on loopEvents
    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        maxIterations: node.maxIterations,
        model: ctx.stepConfig.review.model,
        agent: ctx.stepConfig.review.agent,
        showRequest: ctx.showRequest,
        animation: ctx.config.animation,
      }),
      { exitOnCtrlC: false }
    )

    try {
      const loopConfig: LoopConfig = {
        workPrompt: iteratePrompt,
        reviewPrompt: node.reviewPrompt ?? DEFAULT_REVIEW_PROMPT,
        gatePrompt: node.gatePrompt ?? DEFAULT_GATE_PROMPT,
        iteratePrompt: node.iteratePrompt,
        steps: ctx.stepConfig,
        maxIterations: node.maxIterations,
        projectRoot: ctx.projectRoot,
        initialLastMessage: innerResult.lastMessage,
        skipFirstWork: true,
        retry: ctx.config.retry,
        ralphIteration: ctx.ralphIteration,
        maxRalph: ctx.maxRalph,
        repeatPass: ctx.repeatPass,
        maxRepeatPasses: ctx.maxRepeatPasses,
      }

      const loopResult = await agentLoop(pool.get.bind(pool), loopConfig, ctx.cookMD, loopEvents)

      unmount()
      try { await waitUntilExit() } catch { /* ok */ }

      return {
        lastMessage: loopResult.lastMessage,
        logFile: loopResult.logFile,
        verdict: loopResult.verdict,
        iterations: loopResult.iterations,
      }
    } finally {
      await pool.stopAll()
      unregister()
    }
  }

  // Simple case: inner is a Work node — run agentLoop directly
  const { unmount, waitUntilExit } = render(
    React.createElement(App, {
      maxIterations: node.maxIterations,
      model: ctx.stepConfig.work.model,
      agent: ctx.stepConfig.work.agent,
      showRequest: ctx.showRequest,
      animation: ctx.config.animation,
    }),
    { exitOnCtrlC: false }
  )

  try {
    const loopConfig: LoopConfig = {
      workPrompt,
      reviewPrompt: node.reviewPrompt ?? DEFAULT_REVIEW_PROMPT,
      gatePrompt: node.gatePrompt ?? DEFAULT_GATE_PROMPT,
      iteratePrompt: node.iteratePrompt,
      steps: ctx.stepConfig,
      maxIterations: node.maxIterations,
      projectRoot: ctx.projectRoot,
      retry: ctx.config.retry,
      ralphIteration: ctx.ralphIteration,
      maxRalph: ctx.maxRalph,
      repeatPass: ctx.repeatPass,
      maxRepeatPasses: ctx.maxRepeatPasses,
    }

    const loopResult = await agentLoop(pool.get.bind(pool), loopConfig, ctx.cookMD, loopEvents)

    unmount()
    try { await waitUntilExit() } catch { /* ok */ }

    return {
      lastMessage: loopResult.lastMessage,
      logFile: loopResult.logFile,
      verdict: loopResult.verdict,
      iterations: loopResult.iterations,
    }
  } finally {
    await pool.stopAll()
    unregister()
  }
}

// --- Ralph: outer task loop ---

async function executeRalph(
  node: { type: 'ralph'; inner: Node; maxTasks: number; gatePrompt: string },
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  let result: ExecutionResult = { lastMessage: ctx.lastMessage }

  // Ralph step config falls back to gate if not set
  const ralphStepConfig = ctx.stepConfig.ralph?.agent ? ctx.stepConfig.ralph : ctx.stepConfig.gate

  // Create a single pool for ralph gate calls, reused across all iterations
  const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
  const unregister = registerCleanup(async () => { await pool.stopAll() })

  try {
    for (let task = 1; task <= node.maxTasks; task++) {
      logPhase(`Ralph task ${task}/${node.maxTasks}`)

      // Execute inner node
      result = await execute(node.inner, {
        ...ctx,
        lastMessage: result.lastMessage,
        ralphIteration: task,
        maxRalph: node.maxTasks,
      })

      // If inner loop hit max iterations without converging, stop ralph
      if (result.verdict === 'MAX_ITERATIONS') {
        logWarn(`Ralph: inner loop hit max iterations on task ${task} — stopping (not converging)`)
        return result
      }

      // Run ralph gate
      logStep('Ralph gate...')

      const prompt = renderTemplate(ctx.cookMD, {
        step: 'ralph',
        prompt: node.gatePrompt,
        lastMessage: result.lastMessage,
        iteration: task,
        maxIterations: node.maxTasks,
        logFile: result.logFile ?? '',
        ralphIteration: task,
        maxRalph: node.maxTasks,
        repeatPass: ctx.repeatPass,
        maxRepeatPasses: ctx.maxRepeatPasses,
      })

      const runner = await pool.get(ralphStepConfig.sandbox)
      const output = await retryOnRateLimit(
        () => runner.runAgent(ralphStepConfig.agent, ralphStepConfig.model, prompt, (line) => {
          console.error(`  ${line}`)
        }),
        ctx.config.retry,
        (info) => loopEvents.emit('waiting', info),
        (info) => loopEvents.emit('retry', info),
      )

      // Parse ralph verdict: NEXT or DONE
      const verdict = parseRalphVerdict(output)
      if (verdict === 'DONE') {
        logOK(`Ralph: DONE after ${task} tasks`)
        return { ...result, lastMessage: output }
      }
      logStep(`Ralph: NEXT — continuing to task ${task + 1}`)
    }

    logWarn(`Ralph: max tasks (${node.maxTasks}) reached — stopping`)
    return result
  } finally {
    await pool.stopAll()
    unregister()
  }
}

const NEXT_KEYWORDS = ['NEXT', 'CONTINUE']
const RALPH_DONE_KEYWORDS = ['DONE', 'COMPLETE', 'FINISHED']

function parseRalphVerdict(output: string): 'NEXT' | 'DONE' {
  for (const line of output.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (RALPH_DONE_KEYWORDS.some(kw => upper.includes(kw))) return 'DONE'
    if (NEXT_KEYWORDS.some(kw => upper.includes(kw))) return 'NEXT'
  }
  logWarn('Ralph gate: no NEXT/DONE verdict found in output — defaulting to DONE (fail-safe)')
  return 'DONE'
}

// --- Composition: parallel branches + resolver ---

async function executeComposition(
  node: { type: 'composition'; branches: Node[]; resolver: Resolver; criteria?: string },
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const projectRoot = ctx.projectRoot

  // Verify git repo
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logErr('Composition requires a git repository (for worktree isolation)')
    throw new Error('Composition requires a git repository')
  }

  // Ensure HEAD exists
  try {
    execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logStep('No commits yet — creating initial empty commit')
    execSync('git commit --allow-empty -m "initial (cook)"', { cwd: projectRoot, stdio: 'pipe' })
  }

  // Fail early if working tree has uncommitted changes to tracked files
  try {
    execSync('git diff --quiet', { cwd: projectRoot, stdio: 'pipe' })
    execSync('git diff --cached --quiet', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    throw new Error(
      'Cannot run composition command: working tree has uncommitted changes. ' +
      'Please commit or stash your changes first.'
    )
  }

  const session = sessionId()
  const n = node.branches.length

  logPhase(`Composition — ${n} branches, resolver: ${node.resolver}`)
  logStep(`Session: ${session}`)

  const baseCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim()

  // Create worktrees (wrap in try/catch so partial failures clean up already-created worktrees)
  const worktrees: { worktreePath: string; branchName: string }[] = []
  try {
    for (let i = 1; i <= n; i++) {
      const wtPath = path.join(projectRoot, '.cook', 'race', session, `run-${i}`)
      const branch = `cook-${session}-${i}`
      const wt = createWorktree(projectRoot, wtPath, branch)
      worktrees.push(wt)
      logOK(`Worktree run-${i}: ${wt.branchName}`)
    }
  } catch (err) {
    for (const wt of worktrees) {
      try { removeWorktree(projectRoot, wt.worktreePath, wt.branchName) } catch { /* best effort */ }
    }
    cleanupSessionDir(projectRoot, session)
    throw err
  }

  // Create per-run emitters for RaceApp TUI
  const emitters = worktrees.map(() => new EventEmitter())

  // Track log files per run
  const logFiles: string[] = new Array(n).fill('')
  for (let i = 0; i < n; i++) {
    emitters[i].on('logFile', (logFile: string) => { logFiles[i] = logFile })
  }

  // Create pools and cookMDs before registering cleanup so they're in scope
  const cookMDs = worktrees.map(wt => loadCookMD(wt.worktreePath))
  const pools = worktrees.map(wt => createRunnerPool(wt.worktreePath, ctx.config, ctx.runAgents))

  // Early finish mechanism: resolve this promise to stop waiting for remaining runs
  let finishEarlyResolve: (() => void) | undefined
  const finishEarlyPromise = new Promise<void>(resolve => { finishEarlyResolve = resolve })

  // Per-branch abort controllers for clean cancellation
  const abortControllers = worktrees.map(() => new AbortController())

  const onFinishEarly = () => {
    finishEarlyResolve?.()
  }

  // Render TUI (RaceApp uses per-run emitters, not loopEvents)
  const { unmount, waitUntilExit } = render(
    React.createElement(RaceApp, {
      runCount: n,
      maxIterations: 3,
      emitters,
      animation: ctx.config.animation,
      worktreePaths: worktrees.map(wt => wt.worktreePath),
      onFinishEarly,
    }),
    { exitOnCtrlC: false }
  )

  const unregister = registerCleanup(async () => {
    unmount()
    for (const pool of pools) {
      try { await pool.stopAll() } catch { /* best effort */ }
    }
    for (const wt of worktrees) {
      try { removeWorktree(projectRoot, wt.worktreePath, wt.branchName) } catch { /* best effort */ }
    }
    cleanupSessionDir(projectRoot, session)
  })

  // Track per-run settled results as they complete
  const settledResults: (PromiseSettledResult<ExecutionResult> | undefined)[] = new Array(n).fill(undefined)

  const promises = worktrees.map((wt, i) => {
    const branchNode = node.branches[i]
    return executeBranchForComposition(branchNode, {
      ...ctx,
      projectRoot: wt.worktreePath,
      cookMD: cookMDs[i],
    }, pools[i], emitters[i], abortControllers[i].signal)
  })

  // Wrap promises to track individual completion
  const trackedPromises = promises.map(async (p, i) => {
    try {
      const value = await p
      settledResults[i] = { status: 'fulfilled', value }
    } catch (reason) {
      settledResults[i] = { status: 'rejected', reason }
    }
  })

  // Wait for all to finish, OR early finish signal
  await Promise.race([
    Promise.all(trackedPromises),
    finishEarlyPromise,
  ])

  // If early finish was triggered, stop remaining runs
  const hasUnfinished = settledResults.some(r => r === undefined)
  if (hasUnfinished) {
    logStep('Finishing early — stopping remaining runs...')
    for (let i = 0; i < n; i++) {
      if (!settledResults[i]) {
        abortControllers[i].abort()
        pools[i].stopAll().catch(() => {})
        emitters[i].emit('error', 'cancelled (finished early)')
      }
    }
    // Wait for killed processes to settle
    await Promise.all(trackedPromises)
  }

  unmount()
  // waitUntilExit may never resolve if unmount() races ahead of ink's
  // exit() (e.g. early finish unmounts before React processes allDone).
  // Use a short timeout so we don't hang.
  await Promise.race([
    waitUntilExit().catch(() => {}),
    new Promise<void>(resolve => setTimeout(resolve, 100)),
  ])

  // Restore stdin after ink's useInput cleanup (it pauses/unrefs stdin,
  // which breaks subsequent readline prompts like confirm()).
  // Skip when --yes since no prompts will be shown — leaving stdin
  // resumed/ref'd would keep the event loop alive and hang the process.
  if (!ctx.flags.yes) {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    process.stdin.resume()
    process.stdin.ref()
  }

  // Stop all pools
  for (const pool of pools) {
    await pool.stopAll()
  }

  // Commit changes in each worktree (skip cancelled runs to avoid committing partial work)
  for (let i = 0; i < n; i++) {
    if (settledResults[i]?.status !== 'fulfilled') continue
    const wt = worktrees[i]
    try {
      execSync('git add -A', { cwd: wt.worktreePath, stdio: 'pipe' })
      const status = execSync('git status --porcelain', { cwd: wt.worktreePath, encoding: 'utf8' }).trim()
      if (status) {
        execSync(`git commit -m "cook run ${i + 1}"`, { cwd: wt.worktreePath, stdio: 'pipe' })
      }
    } catch (err) {
      logWarn(`Run ${i + 1} commit failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Build results
  const results: RunResult[] = settledResults.map((result, i) => ({
    index: i + 1,
    status: result?.status === 'fulfilled' ? 'done' as const : 'error' as const,
    logFile: result?.status === 'fulfilled' ? (result.value.logFile ?? logFiles[i] ?? '') : '',
    worktreePath: worktrees[i].worktreePath,
    branchName: worktrees[i].branchName,
    error: result?.status === 'rejected' ? String(result.reason) : (result === undefined ? 'cancelled' : undefined),
  }))

  // Print summary
  console.error('')
  logPhase('Results')
  for (const r of results) {
    if (r.status === 'done') {
      logOK(`Run ${r.index}: done (${r.branchName})`)
    } else {
      logErr(`Run ${r.index}: error — ${r.error}`)
    }
    if (r.logFile) logStep(`  Log: ${r.logFile}`)
  }

  const successfulRuns = results.filter(r => r.status === 'done')
  if (successfulRuns.length === 0) {
    logErr('All runs failed.')
    await cleanupWorktrees(projectRoot, results, session, ctx.flags.yes)
    unregister()
    return { lastMessage: '' }
  }

  // Dispatch to resolver (keep cleanup registered so Ctrl+C during
  // confirm prompts still removes worktrees)
  let resolverResult: ExecutionResult
  switch (node.resolver) {
    case 'pick':
      resolverResult = await resolvePick(results, successfulRuns, node.criteria, projectRoot, ctx, session)
      break
    case 'merge':
      resolverResult = await resolveMerge(results, successfulRuns, node.criteria ?? 'Combine the best elements.', projectRoot, ctx, session, baseCommit)
      break
    case 'compare':
      resolverResult = await resolveCompare(results, successfulRuns, projectRoot, ctx, session, baseCommit)
      break
  }

  unregister()
  return resolverResult
}

/**
 * Execute a branch node within a composition context, using the provided
 * emitter for TUI events (instead of the global loopEvents).
 */
async function executeBranchForComposition(
  node: Node,
  ctx: ExecutionContext,
  pool: ReturnType<typeof createRunnerPool>,
  emitter: EventEmitter,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  switch (node.type) {
    case 'work': {
      // Single work call, emitting on the branch emitter
      const logFile = createSessionLog(ctx.projectRoot)
      emitter.emit('logFile', logFile)

      emitter.emit('step', {
        step: 'work',
        iteration: 1,
        agent: ctx.stepConfig.work.agent,
        model: ctx.stepConfig.work.model,
      })

      const prompt = renderTemplate(ctx.cookMD, {
        step: 'work',
        prompt: node.prompt,
        lastMessage: ctx.lastMessage,
        iteration: 1,
        maxIterations: 1,
        logFile,
        ralphIteration: ctx.ralphIteration,
        maxRalph: ctx.maxRalph,
        repeatPass: ctx.repeatPass,
        maxRepeatPasses: ctx.maxRepeatPasses,
      })

      emitter.emit('prompt', prompt)
      const runner = await pool.get(ctx.stepConfig.work.sandbox)
      const output = await retryOnRateLimit(
        () => runner.runAgent(ctx.stepConfig.work.agent, ctx.stepConfig.work.model, prompt, (line) => {
          emitter.emit('line', line)
        }),
        ctx.config.retry,
        (info) => emitter.emit('waiting', info),
        (info) => emitter.emit('retry', info),
        signal,
      )

      try { appendToLog(logFile, 'work', 1, output) } catch { /* ok */ }
      emitter.emit('done')
      return { lastMessage: output, logFile }
    }

    case 'review': {
      // Run agentLoop with the branch emitter
      let workPrompt: string
      if (node.inner.type === 'work') {
        workPrompt = node.inner.prompt
      } else {
        // Execute inner node first (e.g., repeat), then review
        const innerResult = await executeBranchForComposition(node.inner, ctx, pool, emitter, signal)
        workPrompt = node.iteratePrompt ?? 'Continue working on the task based on the review feedback.'
        ctx = { ...ctx, lastMessage: innerResult.lastMessage }
      }

      const loopConfig: LoopConfig = {
        workPrompt,
        reviewPrompt: node.reviewPrompt ?? DEFAULT_REVIEW_PROMPT,
        gatePrompt: node.gatePrompt ?? DEFAULT_GATE_PROMPT,
        iteratePrompt: node.iteratePrompt,
        steps: ctx.stepConfig,
        maxIterations: node.maxIterations,
        projectRoot: ctx.projectRoot,
        initialLastMessage: ctx.lastMessage,
        skipFirstWork: node.inner.type !== 'work',
        retry: ctx.config.retry,
        ralphIteration: ctx.ralphIteration,
        maxRalph: ctx.maxRalph,
        repeatPass: ctx.repeatPass,
        maxRepeatPasses: ctx.maxRepeatPasses,
      }

      const loopResult = await agentLoop(pool.get.bind(pool), loopConfig, ctx.cookMD, emitter, signal)
      return {
        lastMessage: loopResult.lastMessage,
        logFile: loopResult.logFile,
        verdict: loopResult.verdict,
        iterations: loopResult.iterations,
      }
    }

    case 'repeat': {
      let result: ExecutionResult = { lastMessage: ctx.lastMessage }
      for (let pass = 1; pass <= node.count; pass++) {
        result = await executeBranchForComposition(node.inner, {
          ...ctx,
          lastMessage: result.lastMessage,
          repeatPass: pass,
          maxRepeatPasses: node.count,
        }, pool, emitter, signal)
      }
      return result
    }

    case 'ralph': {
      let result: ExecutionResult = { lastMessage: ctx.lastMessage }
      for (let task = 1; task <= node.maxTasks; task++) {
        result = await executeBranchForComposition(node.inner, {
          ...ctx,
          lastMessage: result.lastMessage,
          ralphIteration: task,
          maxRalph: node.maxTasks,
        }, pool, emitter, signal)

        // If inner loop hit max iterations without converging, stop ralph
        if (result.verdict === 'MAX_ITERATIONS') {
          logWarn(`Ralph: inner loop hit max iterations on task ${task} — stopping (not converging)`)
          return result
        }

        // Run ralph gate
        const ralphStepConfig = ctx.stepConfig.ralph?.agent ? ctx.stepConfig.ralph : ctx.stepConfig.gate
        const prompt = renderTemplate(ctx.cookMD, {
          step: 'ralph',
          prompt: node.gatePrompt,
          lastMessage: result.lastMessage,
          iteration: task,
          maxIterations: node.maxTasks,
          logFile: result.logFile ?? '',
          ralphIteration: task,
          maxRalph: node.maxTasks,
          repeatPass: ctx.repeatPass,
          maxRepeatPasses: ctx.maxRepeatPasses,
        })

        const runner = await pool.get(ralphStepConfig.sandbox)
        const output = await retryOnRateLimit(
          () => runner.runAgent(ralphStepConfig.agent, ralphStepConfig.model, prompt, (line) => {
            console.error(`  ${line}`)
          }),
          ctx.config.retry,
          (info) => emitter.emit('waiting', info),
          (info) => emitter.emit('retry', info),
          signal,
        )

        const verdict = parseRalphVerdict(output)
        if (verdict === 'DONE') {
          return { ...result, lastMessage: output }
        }
      }
      return result
    }

    case 'composition': {
      // Nested composition — fall back to full execute (creates its own worktrees)
      return execute(node, ctx)
    }
  }
}

// --- Resolver: Pick ---

async function resolvePick(
  results: RunResult[],
  successfulRuns: RunResult[],
  criteria: string | undefined,
  projectRoot: string,
  ctx: ExecutionContext,
  session: string,
): Promise<ExecutionResult> {
  if (successfulRuns.length === 1) {
    logOK(`Only Run ${successfulRuns[0].index} succeeded — auto-selecting.`)
    await applyAndCleanup(projectRoot, results, successfulRuns[0].index, session, ctx.flags.yes)
    return { lastMessage: `Run ${successfulRuns[0].index} selected` }
  }

  logPhase('Picking best run')
  logStep('Spawning pick agent to compare results...')

  const judgePrompt = buildJudgePrompt(results, criteria)
  const gateStep = ctx.stepConfig.gate
  const pool = createRunnerPool(projectRoot, ctx.config, ctx.runAgents)

  let judgeOutput: string
  try {
    const runner = await pool.get(gateStep.sandbox)
    judgeOutput = await retryOnRateLimit(
      () => runner.runAgent(gateStep.agent, gateStep.model, judgePrompt, (line) => {
        console.error(`  ${line}`)
      }),
      ctx.config.retry,
    )
  } catch (err) {
    logErr(`Pick failed: ${err}`)
    logWarn('You can manually compare branches and merge the winner.')
    for (const r of results) {
      logStep(`  Run ${r.index}: git diff HEAD...${r.branchName}`)
    }
    await pool.stopAll()
    await cleanupWorktrees(projectRoot, results, session, ctx.flags.yes)
    return { lastMessage: '' }
  }
  await pool.stopAll()

  const winner = parseJudgeVerdict(judgeOutput, results.length)
  if (winner === null || !successfulRuns.some(r => r.index === winner)) {
    logWarn('Pick did not return a clear verdict. You can manually compare:')
    for (const r of successfulRuns) {
      logStep(`  Run ${r.index}: git diff HEAD...${r.branchName}`)
    }
    await cleanupWorktrees(projectRoot, results, session, ctx.flags.yes)
    return { lastMessage: '' }
  }

  logOK(`Picked Run ${winner}`)
  await applyAndCleanup(projectRoot, results, winner, session, ctx.flags.yes)
  return { lastMessage: `Run ${winner} selected` }
}

// --- Resolver: Merge ---

async function resolveMerge(
  results: RunResult[],
  successfulRuns: RunResult[],
  criteria: string,
  projectRoot: string,
  ctx: ExecutionContext,
  session: string,
  baseCommit: string,
): Promise<ExecutionResult> {
  if (successfulRuns.length === 1) {
    logOK(`Only Run ${successfulRuns[0].index} succeeded — using as merge result.`)
    await applyAndCleanup(projectRoot, results, successfulRuns[0].index, session, ctx.flags.yes)
    return { lastMessage: `Run ${successfulRuns[0].index} selected` }
  }

  logPhase('Merging runs')
  logStep('Creating merge worktree...')

  const mergeWtPath = path.join(projectRoot, '.cook', 'race', session, 'merge')
  const mergeBranch = `cook-${session}-merge`
  const mergeWt = createWorktree(projectRoot, mergeWtPath, mergeBranch)
  logOK(`Merge worktree: ${mergeWt.branchName}`)

  // Collect diffs and logs from each run
  const contextParts: string[] = []
  for (const r of successfulRuns) {
    let diff = ''
    try {
      diff = execSync(`git diff ${baseCommit}..HEAD`, { cwd: r.worktreePath, encoding: 'utf8' })
    } catch { /* no diff */ }
    const log = r.logFile && fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
    contextParts.push(`--- Run ${r.index} Diff ---\n${diff || '(no changes)'}\n\n--- Run ${r.index} Log ---\n${log}`)
  }

  // Write MERGE_CONTEXT.md
  const mergeContextContent = `# Merge Context\n\nSynthesize the best parts of multiple parallel runs.\n\n## Criteria\n${criteria}\n\n## Run Results\n\n${contextParts.join('\n\n')}\n`
  fs.writeFileSync(path.join(mergeWt.worktreePath, 'MERGE_CONTEXT.md'), mergeContextContent)

  const mergeWorkPrompt = `Synthesize the best parts of the provided runs. Read MERGE_CONTEXT.md for the run diffs and logs.\n\nCriteria: ${criteria}\n\nCombine the strongest elements from each run into a single coherent implementation.`

  const mergeEmitter = new EventEmitter()
  const mergePool = createRunnerPool(mergeWt.worktreePath, ctx.config, ctx.runAgents)

  const { unmount: unmountMerge, waitUntilExit: waitMergeExit } = render(
    React.createElement(RaceApp, {
      runCount: 1,
      maxIterations: 3,
      emitters: [mergeEmitter],
      animation: ctx.config.animation,
      title: 'Merge synthesis',
      runLabel: 'Merge',
    }),
    { exitOnCtrlC: false }
  )

  const mergeLoopConfig: LoopConfig = {
    workPrompt: mergeWorkPrompt,
    reviewPrompt: DEFAULT_REVIEW_PROMPT,
    gatePrompt: DEFAULT_GATE_PROMPT,
    steps: ctx.stepConfig,
    maxIterations: 3,
    projectRoot: mergeWt.worktreePath,
    retry: ctx.config.retry,
    ralphIteration: ctx.ralphIteration,
    maxRalph: ctx.maxRalph,
    repeatPass: ctx.repeatPass,
    maxRepeatPasses: ctx.maxRepeatPasses,
  }

  let mergeResult: LoopResult
  try {
    mergeResult = await agentLoop(mergePool.get.bind(mergePool), mergeLoopConfig, ctx.cookMD, mergeEmitter)
  } catch (err) {
    logErr(`Merge loop failed: ${err}`)
    await mergePool.stopAll()
    unmountMerge()
    // Cleanup all worktrees including merge worktree
    for (const r of results) {
      try { removeWorktree(projectRoot, r.worktreePath, r.branchName) } catch { /* best effort */ }
    }
    try { removeWorktree(projectRoot, mergeWt.worktreePath, mergeBranch) } catch { /* best effort */ }
    cleanupSessionDir(projectRoot, session)
    return { lastMessage: '' }
  }
  await mergePool.stopAll()
  unmountMerge()
  try { await waitMergeExit() } catch { /* ok */ }

  // Remove MERGE_CONTEXT.md
  try { fs.unlinkSync(path.join(mergeWt.worktreePath, 'MERGE_CONTEXT.md')) } catch { /* ok */ }

  // Commit merge result
  try {
    execSync('git add -A', { cwd: mergeWt.worktreePath, stdio: 'pipe' })
    const status = execSync('git status --porcelain', { cwd: mergeWt.worktreePath, encoding: 'utf8' }).trim()
    if (status) {
      execSync('git commit -m "cook merge"', { cwd: mergeWt.worktreePath, stdio: 'pipe' })
    }
  } catch (err) {
    logWarn(`Merge commit failed: ${err instanceof Error ? err.message : err}`)
  }

  // Apply merge result to main branch
  try {
    execSync(`git merge "${mergeBranch}" --no-edit`, { cwd: projectRoot, stdio: 'pipe' })
    logOK(`Merged ${mergeBranch} into current branch`)
  } catch (err) {
    logWarn(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
    logStep(`  cd ${projectRoot} && git status`)
    logStep(`  Merge branch preserved: ${mergeBranch}`)
    for (const r of results) {
      logStep(`  Run ${r.index}: ${r.branchName}`)
    }
    return { lastMessage: mergeResult.lastMessage, logFile: mergeResult.logFile }
  }

  // Cleanup all worktrees
  for (const r of results) {
    removeWorktree(projectRoot, r.worktreePath, r.branchName)
  }
  removeWorktree(projectRoot, mergeWt.worktreePath, mergeBranch)
  cleanupSessionDir(projectRoot, session)
  logOK('Cleaned up worktrees')

  return { lastMessage: mergeResult.lastMessage, logFile: mergeResult.logFile }
}

// --- Resolver: Compare ---

async function resolveCompare(
  results: RunResult[],
  successfulRuns: RunResult[],
  projectRoot: string,
  ctx: ExecutionContext,
  session: string,
  baseCommit: string,
): Promise<ExecutionResult> {
  logPhase('Comparing runs')
  logStep('Spawning agent to build comparison...')

  const contextParts: string[] = []
  for (const r of successfulRuns) {
    let diff = ''
    try {
      diff = execSync(`git diff ${baseCommit}..HEAD`, { cwd: r.worktreePath, encoding: 'utf8' })
    } catch { /* no diff */ }
    const log = r.logFile && fs.existsSync(r.logFile) ? fs.readFileSync(r.logFile, 'utf8') : '(no log)'
    contextParts.push(`--- Run ${r.index} Diff ---\n${diff || '(no changes)'}\n\n--- Run ${r.index} Log ---\n${log}`)
  }

  const comparePrompt = `You are comparing multiple parallel implementations.
Review the run diffs and logs below and produce a structured comparison document in Markdown.

For each run, summarize:
- What approach was taken
- Key strengths
- Key weaknesses
- Notable implementation details

Then provide an overall recommendation with reasoning.

${contextParts.join('\n\n')}`

  const gateStep = ctx.stepConfig.gate
  const pool = createRunnerPool(projectRoot, ctx.config, ctx.runAgents)

  let compareOutput: string
  try {
    const runner = await pool.get(gateStep.sandbox)
    compareOutput = await retryOnRateLimit(
      () => runner.runAgent(gateStep.agent, gateStep.model, comparePrompt, (line) => {
        console.error(`  ${line}`)
      }),
      ctx.config.retry,
    )
  } catch (err) {
    logErr(`Compare failed: ${err}`)
    await pool.stopAll()
    // Cleanup worktrees on error
    for (const r of results) {
      try { removeWorktree(projectRoot, r.worktreePath, r.branchName) } catch { /* best effort */ }
    }
    cleanupSessionDir(projectRoot, session)
    return { lastMessage: '' }
  }
  await pool.stopAll()

  // Write comparison doc
  const compareDir = path.join(projectRoot, '.cook')
  fs.mkdirSync(compareDir, { recursive: true })
  const comparePath = path.join(compareDir, `compare-${session}.md`)
  fs.writeFileSync(comparePath, compareOutput)
  logOK(`Comparison written to ${comparePath}`)

  // Print branch info
  logStep('Run worktrees preserved for inspection:')
  for (const r of successfulRuns) {
    logStep(`  Run ${r.index}: ${r.worktreePath}`)
  }

  return { lastMessage: compareOutput }
}

// --- Helpers ---

async function applyAndCleanup(
  projectRoot: string,
  results: RunResult[],
  winner: number,
  session: string,
  autoYes = false,
): Promise<void> {
  const winnerResult = results.find(r => r.index === winner)!

  const shouldApply = autoYes || await confirm(`\n  Apply Run ${winner} to current branch? [Y/n] `)
  if (shouldApply) {
    try {
      execSync(`git merge "${winnerResult.branchName}" --no-edit`, { cwd: projectRoot, stdio: 'pipe' })
      logOK(`Merged ${winnerResult.branchName} into current branch`)
    } catch (err) {
      logWarn(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
      logStep(`  cd ${projectRoot} && git status`)
      for (const r of results) {
        logStep(`  Run ${r.index}: ${r.branchName} @ ${r.worktreePath}`)
      }
      return
    }
    await cleanupWorktrees(projectRoot, results, session, autoYes)
  } else {
    logStep(`Skipped merge. Winner branch: ${winnerResult.branchName}`)
    logStep(`  To apply later: git merge ${winnerResult.branchName}`)
  }
}

async function cleanupWorktrees(
  projectRoot: string,
  results: RunResult[],
  session: string,
  autoYes = false,
): Promise<void> {
  const shouldClean = autoYes || await confirm(`  Remove worktrees and branches? [Y/n] `)
  if (shouldClean) {
    for (const r of results) {
      removeWorktree(projectRoot, r.worktreePath, r.branchName)
    }
    cleanupSessionDir(projectRoot, session)
    logOK('Cleaned up worktrees and branches')
  } else {
    logStep('Worktrees preserved.')
  }
}

function cleanupSessionDir(projectRoot: string, session: string): void {
  const sessionDir = path.join(projectRoot, '.cook', 'race', session)
  try { fs.rmSync(sessionDir, { recursive: true }) } catch { /* ok */ }
  const raceDir = path.join(projectRoot, '.cook', 'race')
  try {
    const remaining = fs.readdirSync(raceDir)
    if (remaining.length === 0) fs.rmdirSync(raceDir)
  } catch { /* ok */ }
}
