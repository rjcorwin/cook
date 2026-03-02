import { EventEmitter } from 'events'
import type { Sandbox } from './sandbox.js'
import { renderTemplate, type LoopContext } from './template.js'
import { createSessionLog, appendToLog, logOK, logWarn } from './log.js'

export interface LoopConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  model: string
  projectRoot: string
}

const DONE_KEYWORDS = ['DONE', 'PASS', 'COMPLETE', 'APPROVE', 'ACCEPT']
const ITERATE_KEYWORDS = ['ITERATE', 'REVISE', 'RETRY']

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' {
  for (const line of output.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (DONE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'DONE'
    if (ITERATE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'ITERATE'
  }
  return 'ITERATE'
}

export const loopEvents = new EventEmitter()

export async function agentLoop(
  sandbox: Sandbox,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter,
): Promise<void> {
  const logFile = createSessionLog(config.projectRoot)
  events.emit('logFile', logFile)

  let lastMessage = ''

  for (let i = 1; i <= config.maxIterations; i++) {
    const steps = [
      { name: 'work', prompt: config.workPrompt },
      { name: 'review', prompt: config.reviewPrompt },
      { name: 'gate', prompt: config.gatePrompt },
    ]

    for (const step of steps) {
      events.emit('step', { step: step.name, iteration: i })

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

        output = await sandbox.runClaude(config.model, prompt, (line) => {
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
