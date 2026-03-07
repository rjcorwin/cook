#!/usr/bin/env node

import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import Docker from 'dockerode'
import { loadConfig, type AgentName, type CookConfig, type StepName } from './config.js'
import { loadCookMD, DEFAULT_COOK_MD } from './template.js'
import { logPhase, logStep, logOK, logErr, logWarn, BOLD, RESET, CYAN } from './log.js'
import { startSandbox, rebuildBaseImage, type DockerConfig } from './sandbox.js'
import { agentLoop, loopEvents } from './loop.js'
import { App } from './ui/App.js'
import { RunnerPool } from './runner-pool.js'
import { NativeRunner, DEFAULT_CLAUDE_PERMISSIONS } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { whichSync } from './agent-utils.js'
import type { SandboxMode } from './runner.js'

const DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`

const DEFAULT_COOK_CONFIG_JSON = `{
  "sandbox": "agent",
  "agent": "claude",
  "steps": {
    "work": {},
    "review": {},
    "gate": {}
  },
  "env": []
}
`

const DEFAULT_DOCKER_JSON = `{
  "network": {
    "mode": "restricted",
    "allowedHosts": []
  }
}
`

const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# This Dockerfile is used when sandbox mode is "docker".
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

const DEFAULT_CLAUDE_AGENT_CONFIG = JSON.stringify(DEFAULT_CLAUDE_PERMISSIONS, null, 2) + '\n'

const DEFAULT_CODEX_AGENT_CONFIG = `# Codex config for autonomous cook runs
# See: https://developers.openai.com/codex/config-reference/

sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false
`

const DEFAULT_OPENCODE_AGENT_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "allow",
    "bash": {
      "*": "deny",
      "npm *": "allow",
      "npx *": "allow",
      "node *": "allow",
      "git status *": "allow",
      "git diff *": "allow",
      "git log *": "allow",
      "git add *": "allow",
      "git commit *": "allow",
      "git checkout *": "allow",
      "ls *": "allow",
      "cat *": "allow",
      "find *": "allow",
      "grep *": "allow",
      "mkdir *": "allow",
      "cp *": "allow",
      "mv *": "allow"
    },
    "webfetch": "deny"
  }
}
`

const DEFAULT_COOK_GITIGNORE = `logs/
`

let pool: RunnerPool | null = null
let inkInstance: { unmount: () => void } | null = null
let cleanupPromise: Promise<void> | null = null
let shuttingDown = false

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    if (inkInstance) {
      try { inkInstance.unmount() } catch { /* best effort */ }
      inkInstance = null
    }
    if (pool) {
      await pool.cleanupAll()
      pool = null
    }
  })()
  return cleanupPromise
}

process.on('SIGINT', async () => {
  shuttingDown = true
  try {
    await cleanup()
  } finally {
    process.exit(130)
  }
})
process.on('SIGTERM', async () => {
  shuttingDown = true
  try {
    await cleanup()
  } finally {
    process.exit(143)
  }
})

function findProjectRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' })
  const out = result.stdout?.trim()
  if (result.status !== 0 || !out) {
    console.error('Error: not inside a git repository. Run cook from within a git repo.')
    process.exit(1)
  }
  return out
}

function tryFindProjectRoot(): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' })
  const out = result.stdout?.trim()
  return result.status === 0 && out ? out : null
}

function usage(): void {
  console.error(`${BOLD}cook${RESET} — agent loop

${BOLD}Usage:${RESET}
  cook "work"                     Run the work→review→gate loop
  cook "work" "review" "gate"    Custom prompts for each step
  cook "work" 5                  Run with 5 max iterations
  cook "work" "review" "gate" 5  All custom prompts + iterations
  cook init                       Set up .cook/ config directory
  cook rebuild                    Rebuild the sandbox Docker image
  cook doctor                     Check agent + auth readiness

${BOLD}Options:${RESET}
  --sandbox MODE                  Sandbox mode: agent (default), docker, none
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --max-iterations N              Max review iterations (default: 3)
  --agent AGENT                   Default agent (claude|codex|opencode)
  --model MODEL                   Default model (for default agent)
  --work-agent AGENT              Work step agent override
  --review-agent AGENT            Review step agent override
  --gate-agent AGENT              Gate step agent override
  --work-model MODEL              Work step model override
  --review-model MODEL            Review step model override
  --gate-model MODEL              Gate step model override
  --hide-request                  Hide the templated request for each step
  -h, --help                      Show this help`)
  process.exit(1)
}

function writeIfMissing(fullPath: string, content: string, label: string): void {
  if (fs.existsSync(fullPath)) {
    logOK(`${label} already exists`)
  } else {
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content)
      logOK(`${label} created`)
    } catch (err) {
      logErr(`Failed to create ${label}: ${err}`)
    }
  }
}

function cmdInit(projectRoot: string): void {
  logPhase('Initialize project for cook')

  writeIfMissing(path.join(projectRoot, 'COOK.md'), DEFAULT_COOK_MD, 'COOK.md')
  writeIfMissing(path.join(projectRoot, '.cook', 'config.json'), DEFAULT_COOK_CONFIG_JSON, '.cook/config.json')
  writeIfMissing(path.join(projectRoot, '.cook', 'docker.json'), DEFAULT_DOCKER_JSON, '.cook/docker.json')
  writeIfMissing(path.join(projectRoot, '.cook', 'Dockerfile'), DEFAULT_COOK_DOCKERFILE, '.cook/Dockerfile')
  writeIfMissing(path.join(projectRoot, '.cook', '.gitignore'), DEFAULT_COOK_GITIGNORE, '.cook/.gitignore')
  writeIfMissing(path.join(projectRoot, '.cook', 'agents', 'claude.json'), DEFAULT_CLAUDE_AGENT_CONFIG, '.cook/agents/claude.json')
  writeIfMissing(path.join(projectRoot, '.cook', 'agents', 'codex.toml'), DEFAULT_CODEX_AGENT_CONFIG, '.cook/agents/codex.toml')
  writeIfMissing(path.join(projectRoot, '.cook', 'agents', 'opencode.json'), DEFAULT_OPENCODE_AGENT_CONFIG, '.cook/agents/opencode.json')

  fs.mkdirSync(path.join(projectRoot, '.cook', 'logs'), { recursive: true })

  logOK('Project initialized for cook')
  logStep('Edit COOK.md to customize the agent loop prompts')
  logStep('Edit .cook/config.json to configure agent, model, and sandbox mode')
  logStep('Edit .cook/agents/ to customize agent permissions for autonomous runs')
}

async function cmdRebuild(config: CookConfig): Promise<void> {
  if (config.sandbox !== 'docker') {
    logStep(`Rebuild is only relevant for Docker sandbox mode. Current mode: ${config.sandbox}`)
    return
  }
  logPhase('Rebuild sandbox image')
  await rebuildBaseImage()
}

interface ParsedArgs {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  sandbox?: string
  model?: string
  agent?: string
  workAgent?: string
  reviewAgent?: string
  gateAgent?: string
  workModel?: string
  reviewModel?: string
  gateModel?: string
  showRequest: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const VALUE_FLAGS = new Set([
    '--work',
    '--review',
    '--gate',
    '--model',
    '--agent',
    '--sandbox',
    '--work-agent',
    '--review-agent',
    '--gate-agent',
    '--work-model',
    '--review-model',
    '--gate-model',
    '--max-iterations',
  ])
  const BOOLEAN_FLAGS = new Set(['--hide-request'])

  const flags: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const flag = args[i]
      if (flag.includes('=')) {
        const [key, ...rest] = flag.split('=')
        if (!VALUE_FLAGS.has(key) && !BOOLEAN_FLAGS.has(key)) {
          console.error(`Error: unknown option "${key}"`)
          usage()
        }
        flags[key] = rest.join('=')
      } else {
        if (VALUE_FLAGS.has(flag)) {
          if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
            console.error(`Error: missing value for "${flag}"`)
            usage()
          }
          flags[flag] = args[i + 1]
          i++
        } else if (BOOLEAN_FLAGS.has(flag)) {
          flags[flag] = 'true'
        } else {
          console.error(`Error: unknown option "${flag}"`)
          usage()
        }
      }
    } else {
      positional.push(args[i])
    }
    i++
  }

  let maxIterations = 3
  if (flags['--max-iterations']) {
    const n = parseInt(flags['--max-iterations'], 10)
    if (isNaN(n) || n < 1) {
      console.error(`Error: --max-iterations must be a positive integer, got "${flags['--max-iterations']}"`)
      process.exit(1)
    }
    maxIterations = n
  }
  const prompts = [...positional]
  if (prompts.length > 1) {
    const last = prompts[prompts.length - 1]
    const n = parseInt(last, 10)
    if (!isNaN(n) && n.toString() === last) {
      if (n < 1) {
        console.error(`Error: max iterations must be a positive integer, got "${last}"`)
        process.exit(1)
      }
      maxIterations = n
      prompts.pop()
    }
  }

  const workPrompt = flags['--work'] ?? prompts[0] ?? ''
  const reviewPrompt = flags['--review'] ?? prompts[1] ?? DEFAULT_REVIEW_PROMPT
  const gatePrompt = flags['--gate'] ?? prompts[2] ?? DEFAULT_GATE_PROMPT
  const sandbox = flags['--sandbox']
  const model = flags['--model']
  const agent = flags['--agent']
  const workAgent = flags['--work-agent']
  const reviewAgent = flags['--review-agent']
  const gateAgent = flags['--gate-agent']
  const workModel = flags['--work-model']
  const reviewModel = flags['--review-model']
  const gateModel = flags['--gate-model']
  const showRequest = flags['--hide-request'] !== 'true'

  return {
    workPrompt,
    reviewPrompt,
    gatePrompt,
    maxIterations,
    sandbox,
    model,
    agent,
    workAgent,
    reviewAgent,
    gateAgent,
    workModel,
    reviewModel,
    gateModel,
    showRequest,
  }
}

function parseSandboxMode(value: string | undefined, fallback: SandboxMode): SandboxMode {
  if (!value) return fallback
  const normalized = value.toLowerCase()
  if (normalized === 'agent' || normalized === 'docker' || normalized === 'none') {
    return normalized
  }
  console.error(`Error: invalid sandbox mode "${value}". Expected one of: agent, docker, none.`)
  process.exit(1)
}

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

interface StepSelection {
  agent: AgentName
  model: string
  sandbox?: SandboxMode
}

const STEP_NAMES: StepName[] = ['work', 'review', 'gate']
const FALLBACK_CONFIG: CookConfig = {
  sandbox: 'agent',
  env: ['CLAUDE_CODE_OAUTH_TOKEN'],
  animation: 'strip',
  agent: 'claude',
  steps: { work: {}, review: {}, gate: {} },
}

function parseStepAgentArg(parsed: ParsedArgs, step: StepName): string | undefined {
  switch (step) {
    case 'work': return parsed.workAgent
    case 'review': return parsed.reviewAgent
    case 'gate': return parsed.gateAgent
  }
}

function parseStepModelArg(parsed: ParsedArgs, step: StepName): string | undefined {
  switch (step) {
    case 'work': return parsed.workModel
    case 'review': return parsed.reviewModel
    case 'gate': return parsed.gateModel
  }
}

function resolveStepSelection(
  parsed: ParsedArgs,
  config: CookConfig,
  step: StepName,
  defaultAgent: AgentName,
  defaultModel: string,
): StepSelection {
  const configStep = config.steps[step]
  const agent = parseAgent(parseStepAgentArg(parsed, step), configStep.agent ?? defaultAgent)
  const model = parseStepModelArg(parsed, step) ?? configStep.model ?? (agent === defaultAgent ? defaultModel : defaultModelForAgent(agent))
  return { agent, model, sandbox: configStep.sandbox }
}

function resolveAgentPlan(parsed: ParsedArgs, config: CookConfig): {
  defaultAgent: AgentName
  defaultModel: string
  sandboxMode: SandboxMode
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
} {
  const defaultAgent = parseAgent(parsed.agent, config.agent)
  const defaultModel = parsed.model ?? config.model ?? defaultModelForAgent(defaultAgent)
  const sandboxMode = parseSandboxMode(parsed.sandbox, config.sandbox)
  const stepConfig: Record<StepName, StepSelection> = {
    work: resolveStepSelection(parsed, config, 'work', defaultAgent, defaultModel),
    review: resolveStepSelection(parsed, config, 'review', defaultAgent, defaultModel),
    gate: resolveStepSelection(parsed, config, 'gate', defaultAgent, defaultModel),
  }
  const runAgents = [...new Set(STEP_NAMES.map(step => stepConfig[step].agent))]
  return { defaultAgent, defaultModel, sandboxMode, stepConfig, runAgents }
}

function validateAgentSandboxCombos(stepConfig: Record<StepName, StepSelection>, defaultSandbox: SandboxMode): void {
  for (const step of STEP_NAMES) {
    const effectiveSandbox = stepConfig[step].sandbox ?? defaultSandbox
    if (effectiveSandbox === 'agent' && stepConfig[step].agent === 'opencode') {
      console.error(`Error: OpenCode does not have a native OS sandbox (step: ${step}). Use --sandbox docker or --sandbox none with OpenCode.`)
      process.exit(1)
    }
  }
}

function resolveEnvPassthrough(config: CookConfig): string[] {
  const env: string[] = []
  for (const varName of config.env) {
    const val = process.env[varName]
    if (val !== undefined) env.push(`${varName}=${val}`)
  }
  return env
}

function loadDockerConfig(projectRoot: string): DockerConfig {
  const defaults: DockerConfig = { network: { mode: 'restricted', allowedHosts: [] } }
  const newPath = path.join(projectRoot, '.cook', 'docker.json')
  const legacyPath = path.join(projectRoot, '.cook.config.json')
  let raw: string | null = null

  try {
    raw = fs.readFileSync(newPath, 'utf8')
  } catch {
    // fall back to legacy config for network settings
    try {
      raw = fs.readFileSync(legacyPath, 'utf8')
    } catch {
      return defaults
    }
  }

  try {
    const parsed = JSON.parse(raw!)
    const rawMode = parsed.network?.mode
    const networkMode: DockerConfig['network']['mode'] =
      rawMode === 'bridge' ? 'bridge' :
      rawMode === 'none' ? 'none' : 'restricted'
    const allowedHosts = Array.isArray(parsed.network?.allowedHosts)
      ? parsed.network.allowedHosts.filter((v: unknown): v is string => typeof v === 'string')
      : defaults.network.allowedHosts
    return { network: { mode: networkMode, allowedHosts } }
  } catch (err) {
    logWarn(`Malformed docker config: ${err}`)
    return defaults
  }
}

function envPassesThrough(config: CookConfig, name: string): boolean {
  return config.env.includes(name)
}

function hostClaudeLoggedIn(): boolean {
  const result = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) return false
  try {
    const parsed = JSON.parse(result.stdout.trim()) as { loggedIn?: boolean }
    return parsed.loggedIn === true
  } catch {
    return false
  }
}

function checkClaudeAuth(config: CookConfig, sandboxMode: SandboxMode): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.claude', '.credentials.json'))) {
    return { ok: true, msg: 'Claude auth: ~/.claude/.credentials.json found' }
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (sandboxMode === 'docker') {
      if (envPassesThrough(config, 'CLAUDE_CODE_OAUTH_TOKEN')) {
        return { ok: true, msg: 'Claude auth: CLAUDE_CODE_OAUTH_TOKEN set and passed through' }
      }
      return { ok: false, msg: 'Claude auth: CLAUDE_CODE_OAUTH_TOKEN is set but missing from config env passthrough' }
    }
    return { ok: true, msg: 'Claude auth: CLAUDE_CODE_OAUTH_TOKEN set' }
  }
  if (hostClaudeLoggedIn()) {
    if (sandboxMode === 'docker') {
      return { ok: false, msg: 'Claude auth: host is logged in, but no portable credentials for container. Run `claude setup-token`.' }
    }
    return { ok: true, msg: 'Claude auth: host is logged in' }
  }
  return { ok: false, msg: 'Claude auth: no credentials detected' }
}

function checkCodexAuth(config: CookConfig, sandboxMode: SandboxMode): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.codex', 'auth.json'))) {
    return { ok: true, msg: 'Codex auth: ~/.codex/auth.json found' }
  }
  if (process.env.OPENAI_API_KEY) {
    if (sandboxMode === 'docker') {
      if (envPassesThrough(config, 'OPENAI_API_KEY')) {
        return { ok: true, msg: 'Codex auth: OPENAI_API_KEY set and passed through' }
      }
      return { ok: false, msg: 'Codex auth: OPENAI_API_KEY is set but missing from config env passthrough' }
    }
    return { ok: true, msg: 'Codex auth: OPENAI_API_KEY set' }
  }
  return { ok: false, msg: 'Codex auth: no credentials detected' }
}

function checkOpencodeAuth(config: CookConfig, sandboxMode: SandboxMode): { ok: boolean; msg: string } {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.local', 'share', 'opencode', 'auth.json')) || fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.json'))) {
    return { ok: true, msg: 'OpenCode auth: local auth/config file found' }
  }
  const providerEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
  for (const name of providerEnvVars) {
    if (!process.env[name]) continue
    if (sandboxMode === 'docker') {
      if (envPassesThrough(config, name)) {
        return { ok: true, msg: `OpenCode auth: ${name} set and passed through` }
      }
      return { ok: false, msg: `OpenCode auth: ${name} is set but missing from config env passthrough` }
    }
    return { ok: true, msg: `OpenCode auth: ${name} set` }
  }
  return { ok: false, msg: 'OpenCode auth: no credentials detected' }
}

async function cmdDoctor(args: string[]): Promise<void> {
  logPhase('Cook doctor')

  const projectRoot = tryFindProjectRoot()
  const config = projectRoot ? loadConfig(projectRoot) : FALLBACK_CONFIG
  if (projectRoot) {
    logOK(`Project detected: ${projectRoot}`)
  } else {
    logWarn('Not in a git repo; using default config for checks')
  }

  const parsed = parseArgs(args)
  const plan = resolveAgentPlan(parsed, config)

  logStep(`Sandbox:     ${plan.sandboxMode}`)
  logStep(`Default:     ${plan.defaultAgent}:${plan.defaultModel}`)
  logStep(`Work:        ${plan.stepConfig.work.agent}:${plan.stepConfig.work.model}`)
  logStep(`Review:      ${plan.stepConfig.review.agent}:${plan.stepConfig.review.model}`)
  logStep(`Gate:        ${plan.stepConfig.gate.agent}:${plan.stepConfig.gate.model}`)

  let allGood = true

  if (plan.sandboxMode === 'docker') {
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
  }

  if (plan.sandboxMode === 'agent' || plan.sandboxMode === 'none') {
    for (const agent of plan.runAgents) {
      if (whichSync(agent)) {
        logOK(`${agent} CLI found on host`)
      } else {
        allGood = false
        logErr(`${agent} CLI not found on host (required for sandbox: ${plan.sandboxMode})`)
      }
    }
  }

  if (plan.sandboxMode === 'none') {
    logWarn('Sandbox mode is "none" — agents run without isolation')
  }

  for (const agent of plan.runAgents) {
    const result = agent === 'claude'
      ? checkClaudeAuth(config, plan.sandboxMode)
      : agent === 'codex'
      ? checkCodexAuth(config, plan.sandboxMode)
      : checkOpencodeAuth(config, plan.sandboxMode)
    if (result.ok) {
      logOK(result.msg)
    } else {
      allGood = false
      logWarn(result.msg)
    }
  }

  // Validate agent+sandbox combinations
  for (const step of STEP_NAMES) {
    const effectiveSandbox = plan.stepConfig[step].sandbox ?? plan.sandboxMode
    if (effectiveSandbox === 'agent' && plan.stepConfig[step].agent === 'opencode') {
      allGood = false
      logErr(`OpenCode does not have a native OS sandbox (step: ${step}). Use --sandbox docker or --sandbox none with OpenCode.`)
    }
  }

  if (plan.sandboxMode === 'agent') {
    if (projectRoot && !fs.existsSync(path.join(projectRoot, '.cook', 'agents'))) {
      logWarn('No .cook/agents/ directory — using hardcoded default permissions')
    }
  }

  if (allGood) {
    logOK('Doctor checks passed')
  } else {
    logWarn('Doctor found issues')
    process.exitCode = 1
  }
}

async function runLoop(args: string[]): Promise<void> {
  const projectRoot = findProjectRoot()
  const parsed = parseArgs(args)

  if (!parsed.workPrompt) {
    usage()
  }

  const config = loadConfig(projectRoot)
  const { defaultAgent, defaultModel, sandboxMode, stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  validateAgentSandboxCombos(stepConfig, sandboxMode)

  const bannerLines = [
    `${BOLD}cook${RESET} — agent loop`,
    ``,
    `  Sandbox:     ${sandboxMode}`,
    `  Default:     ${defaultAgent}:${defaultModel}`,
    `  Work:        ${stepConfig.work.agent}:${stepConfig.work.model}`,
    `  Review:      ${stepConfig.review.agent}:${stepConfig.review.model}`,
    `  Gate:        ${stepConfig.gate.agent}:${stepConfig.gate.model}`,
    `  Iterations:  ${parsed.maxIterations}`,
    `  Project:     ${projectRoot}`,
  ]
  const maxLen = Math.max(...bannerLines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length))
  const pad = (line: string) => {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '').length
    return line + ' '.repeat(Math.max(0, maxLen - visible))
  }
  console.error(`┌─${'─'.repeat(maxLen)}─┐`)
  for (const line of bannerLines) {
    console.error(`│ ${pad(line)} │`)
  }
  console.error(`└─${'─'.repeat(maxLen)}─┘`)

  const envPassthrough = resolveEnvPassthrough(config)

  pool = new RunnerPool(async (mode: SandboxMode) => {
    switch (mode) {
      case 'agent':
        return new NativeRunner(projectRoot, envPassthrough)
      case 'docker': {
        const docker = new Docker()
        const dockerConfig = loadDockerConfig(projectRoot)
        return startSandbox(docker, projectRoot, dockerConfig, envPassthrough, runAgents)
      }
      case 'none':
        return new BareRunner(projectRoot, envPassthrough)
    }
  })

  try {
    const cookMD = loadCookMD(projectRoot)
    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        maxIterations: parsed.maxIterations,
        model: stepConfig.work.model,
        agent: stepConfig.work.agent,
        showRequest: parsed.showRequest,
        animation: config.animation,
      }),
      { exitOnCtrlC: false }
    )
    inkInstance = { unmount }

    await agentLoop(pool, {
      workPrompt: parsed.workPrompt,
      reviewPrompt: parsed.reviewPrompt,
      gatePrompt: parsed.gatePrompt,
      steps: stepConfig,
      defaultSandbox: sandboxMode,
      maxIterations: parsed.maxIterations,
      projectRoot,
    }, cookMD, loopEvents)

    await waitUntilExit()
  } finally {
    await cleanup()
  }
}

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'init':    cmdInit(findProjectRoot()); break
    case 'rebuild': {
      const projectRoot = tryFindProjectRoot()
      const config = projectRoot ? loadConfig(projectRoot) : FALLBACK_CONFIG
      await cmdRebuild(config)
      break
    }
    case 'doctor':  await cmdDoctor(args.slice(1)); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default:        await runLoop(args); break
  }
}

main().catch(err => {
  if (!shuttingDown) logErr(String(err))
  process.exit(1)
})
