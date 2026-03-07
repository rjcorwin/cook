import fs from 'fs'
import path from 'path'
import { logWarn } from './log.js'
import type { SandboxMode } from './runner.js'

export type AnimationStyle = 'flame' | 'strip' | 'campfire' | 'pot' | 'pulse'
export type AgentName = 'claude' | 'codex' | 'opencode'
export type StepName = 'work' | 'review' | 'gate'

export interface StepAgentConfig {
  agent?: AgentName
  model?: string
  sandbox?: SandboxMode
}

export interface CookConfig {
  sandbox: SandboxMode
  env: string[]
  animation: AnimationStyle
  agent: AgentName
  model?: string
  steps: Record<StepName, StepAgentConfig>
}

function isAnimationStyle(value: unknown): value is AnimationStyle {
  return value === 'flame' || value === 'strip' || value === 'campfire' || value === 'pot' || value === 'pulse'
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === 'agent' || value === 'docker' || value === 'none'
}

function isAgentName(value: unknown): value is AgentName {
  return value === 'claude' || value === 'codex' || value === 'opencode'
}

function parseStepAgentConfig(value: unknown): StepAgentConfig {
  if (!value || typeof value !== 'object') return {}
  const step = value as { agent?: unknown, model?: unknown, sandbox?: unknown }
  const parsed: StepAgentConfig = {}
  if (isAgentName(step.agent)) parsed.agent = step.agent
  if (typeof step.model === 'string' && step.model.trim().length > 0) parsed.model = step.model
  if (isSandboxMode(step.sandbox)) parsed.sandbox = step.sandbox
  return parsed
}

export function loadConfig(projectRoot: string): CookConfig {
  const newPath = path.join(projectRoot, '.cook', 'config.json')
  const legacyPath = path.join(projectRoot, '.cook.config.json')
  const defaults: CookConfig = {
    sandbox: 'agent',
    env: ['CLAUDE_CODE_OAUTH_TOKEN'],
    animation: 'strip',
    agent: 'claude',
    steps: { work: {}, review: {}, gate: {} },
  }
  let raw: string
  let configSource: string
  try {
    raw = fs.readFileSync(newPath, 'utf8')
    configSource = newPath
  } catch {
    try {
      raw = fs.readFileSync(legacyPath, 'utf8')
      configSource = legacyPath
    } catch {
      return defaults
    }
  }
  try {
    const parsed = JSON.parse(raw)
    const sandbox = isSandboxMode(parsed.sandbox) ? parsed.sandbox : defaults.sandbox
    // If user provides env, it replaces defaults entirely (no merge).
    // This lets users opt out of default vars like CLAUDE_CODE_OAUTH_TOKEN.
    const env = Array.isArray(parsed.env)
      ? parsed.env.filter((value: unknown): value is string => typeof value === 'string')
      : defaults.env
    const animation = isAnimationStyle(parsed.animation) ? parsed.animation : defaults.animation
    const agent = isAgentName(parsed.agent) ? parsed.agent : defaults.agent
    const model = typeof parsed.model === 'string' && parsed.model.trim().length > 0 ? parsed.model : undefined
    const steps = {
      work: parseStepAgentConfig(parsed.steps?.work),
      review: parseStepAgentConfig(parsed.steps?.review),
      gate: parseStepAgentConfig(parsed.steps?.gate),
    }
    return {
      sandbox,
      env,
      animation,
      agent,
      model,
      steps,
    }
  } catch (err) {
    logWarn(`Malformed ${configSource}: ${err}`)
    return defaults
  }
}
