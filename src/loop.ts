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
  steps: Record<StepName, LoopStepConfig>
  maxIterations: number
  projectRoot: string
  // Seed lastMessage with output from a compound inner node (e.g., repeat before review)
  initialLastMessage?: string
  // Skip the work step on iteration 1 (used when inner node already ran the work)
  skipFirstWork?: boolean
  // Extra template context passed through from executor
  ralphIteration?: number
  maxRalph?: number
  repeatPass?: number
  maxRepeatPasses?: number
}

export interface LoopResult {
  verdict: 'DONE' | 'ITERATE' | 'MAX_ITERATIONS'
  iterations: number
  lastMessage: string
  logFile: string
}

const DONE_KEYWORDS = ['DONE', 'PASS', 'COMPLETE', 'APPROVE', 'ACCEPT']
const ITERATE_KEYWORDS = ['ITERATE', 'REVISE', 'RETRY']

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' {
  for (const line of output.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (DONE_KEYWORDS.some(kw => upper.includes(kw))) return 'DONE'
    if (ITERATE_KEYWORDS.some(kw => upper.includes(kw))) return 'ITERATE'
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

  let lastMessage = config.initialLastMessage ?? ''

  for (let i = 1; i <= config.maxIterations; i++) {
    // Iteration 1: work → review → gate (or just review → gate if skipFirstWork)
    // Iteration 2+: iterate (or work) → review → gate
    const workStepName: StepName = (i > 1 && config.iteratePrompt) ? 'iterate' : 'work'
    const workPrompt = (i > 1 && config.iteratePrompt) ? config.iteratePrompt : config.workPrompt

    const steps: { name: StepName; prompt: string }[] = (i === 1 && config.skipFirstWork)
      ? [
          { name: 'review', prompt: config.reviewPrompt },
          { name: 'gate', prompt: config.gatePrompt },
        ]
      : [
          { name: workStepName, prompt: workPrompt },
          { name: 'review', prompt: config.reviewPrompt },
          { name: 'gate', prompt: config.gatePrompt },
        ]

    for (const step of steps) {
      const stepConfig = config.steps[step.name]

      events.emit('step', {
        step: step.name,
        iteration: i,
        agent: stepConfig.agent,
        model: stepConfig.model,
      })

      let output: string
      try {
        const ctx: LoopContext = {
          step: step.name,
          prompt: step.prompt,
          lastMessage,
          iteration: i,
          maxIterations: config.maxIterations,
          logFile,
          ralphIteration: config.ralphIteration,
          maxRalph: config.maxRalph,
          repeatPass: config.repeatPass,
          maxRepeatPasses: config.maxRepeatPasses,
        }
        const prompt = renderTemplate(cookMD, ctx)

        events.emit('prompt', prompt)
        const runner = await getRunner(stepConfig.sandbox)
        output = await runner.runAgent(stepConfig.agent, stepConfig.model, prompt, (line) => {
          events.emit('line', line)
        })
      } catch (err) {
        events.emit('error', `${step.name} step failed (iteration ${i}): ${err}`)
        return { verdict: 'ITERATE', iterations: i, lastMessage, logFile }
      }

      lastMessage = output
      try {
        appendToLog(logFile, step.name, i, output)
      } catch (err) {
        console.error(`Warning: failed to write session log: ${err}`)
      }
    }

    const verdict = parseGateVerdict(lastMessage)
    if (verdict === 'DONE') {
      logOK('Gate: DONE — loop complete')
      events.emit('done')
      return { verdict: 'DONE', iterations: i, lastMessage, logFile }
    }
    if (i < config.maxIterations) {
      logWarn(`Gate: ITERATE — continuing to iteration ${i + 1}`)
    }
  }
  logWarn(`Gate: max iterations (${config.maxIterations}) reached — stopping`)
  events.emit('done')
  return { verdict: 'MAX_ITERATIONS', iterations: config.maxIterations, lastMessage, logFile }
}
