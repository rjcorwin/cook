import { EventEmitter } from 'events'
import type { AgentRunner, SandboxMode } from './runner.js'
import { renderTemplate, type LoopContext } from './template.js'
import { createSessionLog, appendToLog, logOK, logWarn } from './log.js'
import type { AgentName, StepName } from './config.js'

interface LoopStepConfig {
  agent: AgentName
  model: string
  sandbox: SandboxMode
}

export interface LoopConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  iteratePrompt?: string
  nextPrompt?: string
  maxNexts?: number
  steps: Record<StepName, LoopStepConfig>
  maxIterations: number
  projectRoot: string
}

export interface LoopResult {
  verdict: 'DONE' | 'ITERATE' | 'NEXT' | 'MAX_ITERATIONS' | 'ERROR'
  iterations: number
  nextCount: number
}

const DONE_KEYWORDS = ['DONE', 'PASS', 'COMPLETE', 'APPROVE', 'ACCEPT']
const ITERATE_KEYWORDS = ['ITERATE', 'REVISE', 'RETRY', 'CONTINUE']
const NEXT_KEYWORDS = ['NEXT', 'ADVANCE']

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' | 'NEXT' {
  for (const line of output.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (DONE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'DONE'
    if (NEXT_KEYWORDS.some(kw => upper.startsWith(kw))) return 'NEXT'
    if (ITERATE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'ITERATE'
  }
  return 'ITERATE'
}

export const loopEvents = new EventEmitter()

export async function agentLoop(
  getRunner: (mode: SandboxMode) => Promise<AgentRunner>,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter,
): Promise<LoopResult> {
  const logFile = createSessionLog(config.projectRoot)
  events.emit('logFile', logFile)

  let lastMessage = ''
  let nextCount = 0
  let iteration = 1
  let currentWorkPrompt = config.workPrompt
  let isIterating = false
  let isNext = false
  const maxNexts = config.maxNexts ?? 3
  // In inline mode (no ralph keyword), handle NEXT internally.
  // In composed mode, the caller sets nextPrompt but agentLoop returns NEXT.
  const inlineNextMode = config.nextPrompt !== undefined

  while (iteration <= config.maxIterations) {
    const steps = [
      { name: 'work' as const, prompt: currentWorkPrompt },
      { name: 'review' as const, prompt: config.reviewPrompt },
      { name: 'gate' as const, prompt: config.gatePrompt },
    ]

    for (const step of steps) {
      events.emit('step', {
        step: step.name,
        iteration,
        agent: config.steps[step.name].agent,
        model: config.steps[step.name].model,
        nextCount,
        isIterating,
        isNext,
      })

      let output: string
      try {
        const prompt = renderTemplate(cookMD, {
          step: step.name,
          prompt: step.prompt,
          lastMessage,
          iteration,
          maxIterations: config.maxIterations,
          logFile,
          nextCount,
          maxNexts,
          isIterating,
          isNext,
        })

        events.emit('prompt', prompt)
        const runner = await getRunner(config.steps[step.name].sandbox)
        output = await runner.runAgent(config.steps[step.name].agent, config.steps[step.name].model, prompt, (line) => {
          events.emit('line', line)
        })
      } catch (err) {
        events.emit('error', `${step.name} step failed (iteration ${iteration}): ${err}`)
        return { verdict: 'ERROR', iterations: iteration, nextCount }
      }

      lastMessage = output
      try {
        appendToLog(logFile, step.name, iteration, output)
      } catch (err) {
        console.error(`Warning: failed to write session log: ${err}`)
      }
    }

    const verdict = parseGateVerdict(lastMessage)
    if (verdict === 'DONE') {
      logOK('Gate: DONE — loop complete')
      events.emit('done')
      return { verdict: 'DONE', iterations: iteration, nextCount }
    }
    if (verdict === 'NEXT') {
      if (!inlineNextMode) {
        // No next prompt configured — treat as DONE (backward compat)
        logOK('Gate: NEXT (no next prompt configured) — treating as DONE')
        events.emit('done')
        return { verdict: 'NEXT', iterations: iteration, nextCount }
      }
      nextCount++
      if (nextCount >= maxNexts) {
        logWarn(`Gate: NEXT — max nexts (${maxNexts}) reached — stopping`)
        events.emit('done')
        return { verdict: 'NEXT', iterations: iteration, nextCount }
      }
      logOK(`Gate: NEXT — advancing to task ${nextCount + 1}`)
      iteration = 1
      currentWorkPrompt = config.nextPrompt!
      isIterating = false
      isNext = true
      continue
    }
    // ITERATE
    if (iteration < config.maxIterations) {
      logWarn(`Gate: ITERATE — continuing to iteration ${iteration + 1}`)
    }
    iteration++
    currentWorkPrompt = config.iteratePrompt ?? config.workPrompt
    isIterating = true
    isNext = false
  }
  logWarn(`Gate: max iterations (${config.maxIterations}) reached — stopping`)
  events.emit('done')
  return { verdict: 'MAX_ITERATIONS', iterations: iteration - 1, nextCount }
}
