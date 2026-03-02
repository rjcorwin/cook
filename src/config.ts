import fs from 'fs'
import path from 'path'
import { logWarn } from './log.js'

export type AnimationStyle = 'flame' | 'strip' | 'campfire' | 'pot' | 'pulse'
export type AgentName = 'claude' | 'codex' | 'opencode'
export type StepName = 'work' | 'review' | 'gate'

export interface StepAgentConfig {
  agent?: AgentName
  model?: string
}

export interface CookConfig {
  network: {
    mode: 'default' | 'restricted'
    allowedHosts: string[]
  }
  env: string[]
  animation: AnimationStyle
  agent: AgentName
  model?: string
  steps: Record<StepName, StepAgentConfig>
}

function isAnimationStyle(value: unknown): value is AnimationStyle {
  return value === 'flame' || value === 'strip' || value === 'campfire' || value === 'pot' || value === 'pulse'
}

function isAgentName(value: unknown): value is AgentName {
  return value === 'claude' || value === 'codex' || value === 'opencode'
}

function parseStepAgentConfig(value: unknown): StepAgentConfig {
  if (!value || typeof value !== 'object') return {}
  const step = value as { agent?: unknown, model?: unknown }
  const parsed: StepAgentConfig = {}
  if (isAgentName(step.agent)) parsed.agent = step.agent
  if (typeof step.model === 'string' && step.model.trim().length > 0) parsed.model = step.model
  return parsed
}

export function loadConfig(projectRoot: string): CookConfig {
  const configPath = path.join(projectRoot, '.cook.config.json')
  const defaults: CookConfig = {
    network: { mode: 'default', allowedHosts: [] },
    env: [],
    animation: 'strip',
    agent: 'claude',
    steps: { work: {}, review: {}, gate: {} },
  }
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch {
    return defaults
  }
  try {
    const parsed = JSON.parse(raw)
    const networkMode = parsed.network?.mode === 'restricted' ? 'restricted' : defaults.network.mode
    const allowedHosts = Array.isArray(parsed.network?.allowedHosts)
      ? parsed.network.allowedHosts.filter((value: unknown): value is string => typeof value === 'string')
      : defaults.network.allowedHosts
    const env = Array.isArray(parsed.env) ? parsed.env.filter((value: unknown): value is string => typeof value === 'string') : defaults.env
    const animation = isAnimationStyle(parsed.animation) ? parsed.animation : defaults.animation
    const agent = isAgentName(parsed.agent) ? parsed.agent : defaults.agent
    const model = typeof parsed.model === 'string' && parsed.model.trim().length > 0 ? parsed.model : undefined
    const steps = {
      work: parseStepAgentConfig(parsed.steps?.work),
      review: parseStepAgentConfig(parsed.steps?.review),
      gate: parseStepAgentConfig(parsed.steps?.gate),
    }
    return {
      network: { mode: networkMode, allowedHosts },
      env,
      animation,
      agent,
      model,
      steps,
    }
  } catch (err) {
    logWarn(`Malformed .cook.config.json: ${err}`)
    return defaults
  }
}
