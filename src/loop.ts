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
  steps: Record<StepName, LoopStepConfig>
  maxIterations: number
  projectRoot: string
}

const DONE_KEYWORDS = ['DONE', 'PASS', 'COMPLETE', 'APPROVE', 'ACCEPT']
const ITERATE_KEYWORDS = ['ITERATE', 'REVISE', 'RETRY', 'NEXT']

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' {
  const upper = output.toUpperCase()
  if (DONE_KEYWORDS.some(kw => upper.includes(kw))) return 'DONE'
  if (ITERATE_KEYWORDS.some(kw => upper.includes(kw))) return 'ITERATE'
  return 'ITERATE'
}

export const loopEvents = new EventEmitter()

export async function agentLoop(
  getRunner: (mode: SandboxMode) => Promise<AgentRunner>,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter,
): Promise<void> {
  const logFile = createSessionLog(config.projectRoot)
  events.emit('logFile', logFile)

  let lastMessage = ''

  for (let i = 1; i <= config.maxIterations; i++) {
    const steps = [
      { name: 'work' as const, prompt: config.workPrompt },
      { name: 'review' as const, prompt: config.reviewPrompt },
      { name: 'gate' as const, prompt: config.gatePrompt },
    ]

    for (const step of steps) {
      events.emit('step', {
        step: step.name,
        iteration: i,
        agent: config.steps[step.name].agent,
        model: config.steps[step.name].model,
      })

      let output: string
      try {
        const prompt = renderTemplate(cookMD, {
          step: step.name,
          prompt: step.prompt,
          lastMessage,
          iteration: i,
          maxIterations: config.maxIterations,
          logFile,
        })

        events.emit('prompt', prompt)
        const runner = await getRunner(config.steps[step.name].sandbox)
        output = await runner.runAgent(config.steps[step.name].agent, config.steps[step.name].model, prompt, (line) => {
          events.emit('line', line)
        })
      } catch (err) {
        events.emit('error', `${step.name} step failed (iteration ${i}): ${err}`)
        return
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
      return
    }
    if (i < config.maxIterations) {
      logWarn(`Gate: ITERATE — continuing to iteration ${i + 1}`)
    }
  }
  logWarn(`Gate: max iterations (${config.maxIterations}) reached — stopping`)
  events.emit('done')
}
