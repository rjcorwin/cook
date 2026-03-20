#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig, type AgentName, type CookConfig, type StepName, type StepSelection } from './config.js'
import type { SandboxMode } from './runner.js'
import { DEFAULT_COOK_MD, loadCookMD } from './template.js'
import { logPhase, logStep, logOK, logErr, logWarn, BOLD, RESET } from './log.js'
import { parse, separateFlags, buildParsedFlags, type ParsedFlags } from './parser.js'
import { execute, cleanupActiveExecutions, type ExecutionContext } from './executor.js'

const DEFAULT_COOK_CONFIG_JSON = `{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work": {},
    "review": {},
    "gate": {},
    "iterate": {},
    "ralph": {}
  },
  "env": []
}
`

const DEFAULT_COOK_GITIGNORE = `logs/
race/
fork/
compare-*.md
`

const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

process.on('SIGINT', async () => {
  await cleanupActiveExecutions()
  process.exit(1)
})
process.on('SIGTERM', async () => {
  await cleanupActiveExecutions()
  process.exit(1)
})

function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

function usage(): void {
  console.error(`${BOLD}cook${RESET} — sandboxed agent loop

${BOLD}Usage:${RESET}
  cook "work"                          Single LLM call (no review)
  cook "work" review                   Work + review loop (default prompts)
  cook "work" "review" "gate"          Work + review loop (custom prompts)
  cook "work" review x3                Review loop repeated 3 times
  cook "work" x3 review               Work repeated 3 times, then review
  cook "work" review ralph 5 "gate"   Review loop + ralph outer loop
  cook "work" v3 pick "criteria"       3 parallel versions, pick best
  cook "A" vs "B" pick "criteria"     Fork-join: two approaches
  cook "A" vs "B" merge "criteria"    Fork-join: synthesize best parts
  cook "A" vs "B" compare             Fork-join: comparison document
  cook init                           Set up COOK.md, config, and Dockerfile
  cook rebuild                        Rebuild the sandbox Docker image
  cook doctor                         Check Docker + auth readiness

${BOLD}Options:${RESET}
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --iterate PROMPT                Override iterate step prompt
  --max-iterations N              Max review iterations (default: 3)
  --agent AGENT                   Default agent (claude|codex|opencode)
  --model MODEL                   Default model (for default agent)
  --work-agent AGENT              Work step agent override
  --review-agent AGENT            Review step agent override
  --gate-agent AGENT              Gate step agent override
  --iterate-agent AGENT           Iterate step agent override
  --ralph-agent AGENT             Ralph gate step agent override
  --work-model MODEL              Work step model override
  --review-model MODEL            Review step model override
  --gate-model MODEL              Gate step model override
  --iterate-model MODEL           Iterate step model override
  --ralph-model MODEL             Ralph gate step model override
  --sandbox MODE                  Sandbox mode (agent|docker, default: agent)
  --no-wait                       Disable rate-limit retry (fail fast)
  --hide-request                  Hide the templated request for each step
  -h, --help                      Show this help`)
  process.exit(1)
}

function cmdInit(projectRoot: string): void {
  logPhase('Initialize project for cook')

  fs.mkdirSync(path.join(projectRoot, '.cook', 'logs'), { recursive: true })

  const files = [
    { path: 'COOK.md', content: DEFAULT_COOK_MD },
    { path: '.cook/config.json', content: DEFAULT_COOK_CONFIG_JSON },
    { path: '.cook/Dockerfile', content: DEFAULT_COOK_DOCKERFILE },
    { path: '.cook/.gitignore', content: DEFAULT_COOK_GITIGNORE },
  ]

  for (const file of files) {
    const fullPath = path.join(projectRoot, file.path)
    if (fs.existsSync(fullPath)) {
      logOK(`${file.path} already exists`)
    } else {
      try {
        fs.writeFileSync(fullPath, file.content)
        logOK(`${file.path} created`)
      } catch (err) {
        logErr(`Failed to create ${file.path}: ${err}`)
      }
    }
  }

  logOK('Project initialized for cook')
  logStep(`Edit COOK.md to customize the agent loop prompts`)
  logStep(`Edit .cook/config.json to configure agent, sandbox, and env vars`)
  logStep(`Edit .cook/Dockerfile to add project-specific dependencies`)
}

async function cmdRebuild(): Promise<void> {
  logPhase('Rebuild sandbox image')
  const { rebuildBaseImage } = await import('./sandbox.js')
  await rebuildBaseImage()
}

// --- Agent/model resolution ---

function parseAgent(value: string | undefined, fallback: AgentName): AgentName {
  const normalized = (value ?? fallback).toLowerCase()
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'opencode') {
    return normalized
  }
  console.error(`Error: invalid agent "${value}". Expected one of: claude, codex, opencode.`)
  process.exit(1)
}

function defaultModelForAgent(agent: AgentName): string {
  switch (agent) {
    case 'claude': return 'opus'
    case 'codex': return 'gpt-5-codex'
    case 'opencode': return 'gpt-5'
  }
}

const ALL_STEP_NAMES: StepName[] = ['work', 'review', 'gate', 'iterate', 'ralph']

function parseStepAgentArg(flags: ParsedFlags, step: StepName): string | undefined {
  switch (step) {
    case 'work': return flags.workAgent
    case 'review': return flags.reviewAgent
    case 'gate': return flags.gateAgent
    case 'iterate': return flags.iterateAgent
    case 'ralph': return flags.ralphAgent
  }
}

function parseStepModelArg(flags: ParsedFlags, step: StepName): string | undefined {
  switch (step) {
    case 'work': return flags.workModel
    case 'review': return flags.reviewModel
    case 'gate': return flags.gateModel
    case 'iterate': return flags.iterateModel
    case 'ralph': return flags.ralphModel
  }
}

function resolveStepSelection(
  flags: ParsedFlags,
  config: CookConfig,
  step: StepName,
  defaultAgent: AgentName,
  defaultModel: string,
): StepSelection {
  const configStep = config.steps[step]

  // Iterate falls back to work config; ralph falls back to gate config
  let fallbackStep: StepName | undefined
  if (step === 'iterate') fallbackStep = 'work'
  if (step === 'ralph') fallbackStep = 'gate'

  const fallbackConfig = fallbackStep ? config.steps[fallbackStep] : undefined

  const agent = parseAgent(
    parseStepAgentArg(flags, step),
    configStep.agent ?? fallbackConfig?.agent ?? defaultAgent
  )
  const model = parseStepModelArg(flags, step)
    ?? configStep.model
    ?? fallbackConfig?.model
    ?? (agent === defaultAgent ? defaultModel : defaultModelForAgent(agent))
  const sandbox = configStep.sandbox ?? fallbackConfig?.sandbox ?? flags.sandbox ?? config.sandbox
  return { agent, model, sandbox }
}

function resolveAgentPlan(flags: ParsedFlags, config: CookConfig): {
  defaultAgent: AgentName
  defaultModel: string
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
} {
  const defaultAgent = parseAgent(flags.agent, config.agent)
  const defaultModel = flags.model ?? config.model ?? defaultModelForAgent(defaultAgent)
  const stepConfig = {} as Record<StepName, StepSelection>
  for (const step of ALL_STEP_NAMES) {
    stepConfig[step] = resolveStepSelection(flags, config, step, defaultAgent, defaultModel)
  }
  const runAgents = [...new Set(ALL_STEP_NAMES.map(step => stepConfig[step].agent))]
  return { defaultAgent, defaultModel, stepConfig, runAgents }
}

// --- Doctor ---

function envPassesThrough(config: CookConfig, name: string): boolean {
  return config.env.includes(name)
}

function hasFile(file: string): boolean {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

function hasCommandOnPath(command: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`where.exe ${command}`, { encoding: 'utf8', stdio: 'ignore' })
    } else {
      execSync(`command -v ${command}`, { encoding: 'utf8', stdio: 'ignore', shell: '/bin/sh' })
    }
    return true
  } catch {
    return false
  }
}

function hostClaudeLoggedIn(): boolean {
  try {
    const out = execSync('claude auth status', { encoding: 'utf8' }).trim()
    const parsed = JSON.parse(out) as { loggedIn?: boolean }
    return parsed.loggedIn === true
  } catch {
    return false
  }
}

function checkClaudeAuth(config: CookConfig, usedModes: Set<SandboxMode>): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (hasFile(path.join(home, '.claude', '.credentials.json'))) {
    return { ok: true, msg: 'Claude auth: ~/.claude/.credentials.json found (portable)' }
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (envPassesThrough(config, 'CLAUDE_CODE_OAUTH_TOKEN')) {
      return { ok: true, msg: 'Claude auth: CLAUDE_CODE_OAUTH_TOKEN set and passed through' }
    }
    return { ok: false, msg: 'Claude auth: CLAUDE_CODE_OAUTH_TOKEN is set but missing from .cook/config.json env passthrough' }
  }
  if (hostClaudeLoggedIn()) {
    if (usedModes.has('docker')) {
      return { ok: false, msg: 'Claude auth: host is logged in but not portable to Docker. Run `claude login` to create ~/.claude/.credentials.json or set CLAUDE_CODE_OAUTH_TOKEN.' }
    }
    return { ok: true, msg: 'Claude auth: host is logged in (sufficient for native mode)' }
  }
  return { ok: false, msg: 'Claude auth: no credentials detected. Run `claude login` or set CLAUDE_CODE_OAUTH_TOKEN.' }
}

function checkCodexAuth(config: CookConfig): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (hasFile(path.join(home, '.codex', 'auth.json'))) {
    return { ok: true, msg: 'Codex auth: ~/.codex/auth.json found (portable)' }
  }
  if (process.env.OPENAI_API_KEY) {
    if (envPassesThrough(config, 'OPENAI_API_KEY')) {
      return { ok: true, msg: 'Codex auth: OPENAI_API_KEY set and passed through' }
    }
    return { ok: false, msg: 'Codex auth: OPENAI_API_KEY is set but missing from .cook/config.json env passthrough' }
  }
  return { ok: false, msg: 'Codex auth: no credentials detected. Set OPENAI_API_KEY or run codex login.' }
}

function checkOpencodeAuth(config: CookConfig): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (hasFile(path.join(home, '.local', 'share', 'opencode', 'auth.json')) || hasFile(path.join(home, '.config', 'opencode', 'opencode.json'))) {
    return { ok: true, msg: 'OpenCode auth: local auth/config file found (portable)' }
  }
  const providerEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
  for (const name of providerEnvVars) {
    if (!process.env[name]) continue
    if (envPassesThrough(config, name)) {
      return { ok: true, msg: `OpenCode auth: ${name} set and passed through` }
    }
    return { ok: false, msg: `OpenCode auth: ${name} is set but missing from .cook/config.json env passthrough` }
  }
  return { ok: false, msg: 'OpenCode auth: no credentials detected. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.' }
}

async function cmdDoctor(args: string[]): Promise<void> {
  logPhase('Cook doctor')

  const projectRoot = findProjectRoot()
  const config = loadConfig(projectRoot)

  // Parse just flags for doctor — extract flags directly without requiring a work prompt
  const { flags } = separateFlags(args)
  const parsedFlags = buildParsedFlags(flags)
  const plan = resolveAgentPlan(parsedFlags, config)

  logStep(`Default: ${plan.defaultAgent}:${plan.defaultModel}`)
  logStep(`Work: ${plan.stepConfig.work.agent}:${plan.stepConfig.work.model}`)
  logStep(`Review: ${plan.stepConfig.review.agent}:${plan.stepConfig.review.model}`)
  logStep(`Gate: ${plan.stepConfig.gate.agent}:${plan.stepConfig.gate.model}`)
  logStep(`Iterate: ${plan.stepConfig.iterate.agent}:${plan.stepConfig.iterate.model}`)
  logStep(`Ralph: ${plan.stepConfig.ralph.agent}:${plan.stepConfig.ralph.model}`)

  let allGood = true
  const usedModes = new Set(ALL_STEP_NAMES.map(step => plan.stepConfig[step].sandbox))
  logStep(`Sandbox modes: ${[...usedModes].join(', ')}`)

  if (usedModes.has('docker')) {
    try {
      const Docker = (await import('dockerode')).default
      const docker = new Docker()
      try {
        await docker.ping()
        logOK('Docker daemon reachable')
      } catch {
        allGood = false
        logErr('Docker daemon not reachable')
      }
      try {
        await docker.getImage('cook-sandbox').inspect()
        logOK('Base image cook-sandbox present')
      } catch {
        logWarn('Base image cook-sandbox not found (run `cook rebuild`)')
      }
    } catch {
      allGood = false
      logErr('dockerode not available')
    }
  }

  if (usedModes.has('agent')) {
    for (const agent of plan.runAgents) {
      if (agent === 'opencode') continue
      if (hasCommandOnPath(agent)) {
        logOK(`${agent} CLI found on PATH`)
      } else {
        allGood = false
        logErr(`${agent} CLI not found on PATH`)
      }
    }
  }

  for (const agent of plan.runAgents) {
    const result = agent === 'claude'
      ? checkClaudeAuth(config, usedModes)
      : agent === 'codex'
      ? checkCodexAuth(config)
      : checkOpencodeAuth(config)
    if (result.ok) {
      logOK(result.msg)
    } else {
      allGood = false
      logWarn(result.msg)
    }
  }

  if (allGood) {
    logOK('Doctor checks passed')
  } else {
    logWarn('Doctor found issues')
    process.exitCode = 1
  }
}

// --- Main ---

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'init':    cmdInit(findProjectRoot()); break
    case 'rebuild': await cmdRebuild(); break
    case 'doctor':  await cmdDoctor(args.slice(1)); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default: {
      const projectRoot = findProjectRoot()
      const { ast, flags: parsedFlags } = parse(args)
      const config = loadConfig(projectRoot)
      const { defaultAgent, defaultModel, stepConfig, runAgents } = resolveAgentPlan(parsedFlags, config)

      const usedModes = [...new Set(ALL_STEP_NAMES.map(step => stepConfig[step].sandbox))]
      const sandboxLabel = usedModes.length === 1 ? usedModes[0] : usedModes.join(', ')

      const bannerLines = [
        `${BOLD}cook${RESET} — agent loop`,
        ``,
        `  Default:     ${defaultAgent}:${defaultModel}`,
        `  Sandbox:     ${sandboxLabel}`,
        `  Work:        ${stepConfig.work.agent}:${stepConfig.work.model}`,
        `  Review:      ${stepConfig.review.agent}:${stepConfig.review.model}`,
        `  Gate:        ${stepConfig.gate.agent}:${stepConfig.gate.model}`,
        `  Iterate:     ${stepConfig.iterate.agent}:${stepConfig.iterate.model}`,
        `  Ralph:       ${stepConfig.ralph.agent}:${stepConfig.ralph.model}`,
        `  Project:     ${projectRoot}`,
      ]
      const maxLen = Math.max(...bannerLines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length))
      const pad = (line: string) => {
        const visible = line.replace(/\x1b\[[0-9;]*m/g, '').length
        return line + ' '.repeat(Math.max(0, maxLen - visible))
      }
      console.error(`\u250C\u2500${'─'.repeat(maxLen)}\u2500\u2510`)
      for (const line of bannerLines) {
        console.error(`\u2502 ${pad(line)} \u2502`)
      }
      console.error(`\u2514\u2500${'─'.repeat(maxLen)}\u2500\u2518`)

      if (parsedFlags.noWait) {
        config.retry.enabled = false
      }

      const cookMD = loadCookMD(projectRoot)

      const ctx: ExecutionContext = {
        projectRoot,
        config,
        flags: parsedFlags,
        stepConfig,
        runAgents,
        cookMD,
        showRequest: parsedFlags.showRequest,
        lastMessage: '',
      }

      await execute(ast, ctx)
      break
    }
  }
}

main().catch(err => { logErr(String(err)); process.exit(1) })
