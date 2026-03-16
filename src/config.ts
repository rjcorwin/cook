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
  iterate?: boolean | string
  iteratePrompt?: string
  next?: boolean | string
  nextPrompt?: string
  maxNexts?: number
}

export interface StepSelection {
  agent: AgentName
  model: string
  sandbox: SandboxMode
}

export interface DockerConfig {
  network: {
    mode: 'restricted' | 'unrestricted'
    allowedHosts: string[]
  }
}

function isAnimationStyle(value: unknown): value is AnimationStyle {
  return value === 'flame' || value === 'strip' || value === 'campfire' || value === 'pot' || value === 'pulse'
}

function isAgentName(value: unknown): value is AgentName {
  return value === 'claude' || value === 'codex' || value === 'opencode'
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === 'agent' || value === 'docker' || value === 'none'
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

function resolveConfigPath(projectRoot: string): string | null {
  const configPath = path.join(projectRoot, '.cook', 'config.json')
  if (fs.existsSync(configPath)) return configPath
  return null
}

export function loadConfig(projectRoot: string): CookConfig {
  const defaults: CookConfig = {
    sandbox: 'agent',
    env: ['CLAUDE_CODE_OAUTH_TOKEN'],
    animation: 'strip',
    agent: 'claude',
    steps: { work: {}, review: {}, gate: {} },
  }

  const configPath = resolveConfigPath(projectRoot)
  if (!configPath) return defaults

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch {
    return defaults
  }
  try {
    const parsed = JSON.parse(raw)
    const userEnv = Array.isArray(parsed.env) ? parsed.env.filter((value: unknown): value is string => typeof value === 'string') : []
    const env = [...new Set([...defaults.env, ...userEnv])]
    const animation = isAnimationStyle(parsed.animation) ? parsed.animation : defaults.animation
    const agent = isAgentName(parsed.agent) ? parsed.agent : defaults.agent
    const model = typeof parsed.model === 'string' && parsed.model.trim().length > 0 ? parsed.model : undefined
    const steps = {
      work: parseStepAgentConfig(parsed.steps?.work),
      review: parseStepAgentConfig(parsed.steps?.review),
      gate: parseStepAgentConfig(parsed.steps?.gate),
    }
    const sandbox = isSandboxMode(parsed.sandbox) ? parsed.sandbox : defaults.sandbox

    // Iterate/next config
    const iterate = parsed.iterate === true || typeof parsed.iterate === 'string' ? parsed.iterate : undefined
    const iteratePrompt = typeof parsed.iteratePrompt === 'string' ? parsed.iteratePrompt
      : typeof parsed.iterate === 'string' ? parsed.iterate : undefined
    const next = parsed.next === true || typeof parsed.next === 'string' ? parsed.next : undefined
    const nextPrompt = typeof parsed.nextPrompt === 'string' ? parsed.nextPrompt
      : typeof parsed.next === 'string' ? parsed.next : undefined
    const maxNexts = typeof parsed.maxNexts === 'number' && parsed.maxNexts > 0 ? parsed.maxNexts : undefined

    return { sandbox, env, animation, agent, model, steps, iterate, iteratePrompt, next, nextPrompt, maxNexts }
  } catch (err) {
    logWarn(`Malformed .cook/config.json: ${err}`)
    return defaults
  }
}

const DEFAULT_DOCKER_CONFIG: DockerConfig = {
  network: { mode: 'restricted', allowedHosts: [] },
}

export function loadDockerConfig(projectRoot: string): DockerConfig {
  const dockerConfigPath = path.join(projectRoot, '.cook', 'docker.json')
  if (!fs.existsSync(dockerConfigPath)) return DEFAULT_DOCKER_CONFIG

  try {
    const parsed = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf8'))
    const networkMode = parsed.network?.mode === 'unrestricted' ? 'unrestricted' : DEFAULT_DOCKER_CONFIG.network.mode
    const allowedHosts = Array.isArray(parsed.network?.allowedHosts)
      ? parsed.network.allowedHosts.filter((value: unknown): value is string => typeof value === 'string')
      : DEFAULT_DOCKER_CONFIG.network.allowedHosts
    return { network: { mode: networkMode, allowedHosts } }
  } catch (err) {
    logWarn(`Malformed .cook/docker.json: ${err}`)
    return DEFAULT_DOCKER_CONFIG
  }
}
