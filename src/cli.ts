#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import { loadConfig, loadDockerConfig, type AgentName, type CookConfig, type StepName } from './config.js'
import { RunnerPool, type SandboxMode } from './runner.js'
import { NativeRunner } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { loadCookMD, DEFAULT_COOK_MD } from './template.js'
import { logPhase, logStep, logOK, logErr, logWarn, BOLD, RESET } from './log.js'
// sandbox.js is imported dynamically to avoid loading dockerode when not needed
import { agentLoop, loopEvents } from './loop.js'
import { App } from './ui/App.js'

const DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`

const DEFAULT_COOK_CONFIG_JSON = `{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work": {},
    "review": {},
    "gate": {}
  },
  "env": []
}
`

const DEFAULT_COOK_GITIGNORE = `logs/
`

const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

let pool: RunnerPool | null = null
let inkInstance: { unmount: () => void } | null = null

async function cleanup() {
  if (inkInstance) {
    inkInstance.unmount()
    inkInstance = null
  }
  if (pool) {
    await pool.stopAll()
    pool = null
  }
}

process.on('SIGINT', async () => {
  await cleanup()
  process.exit(1)
})
process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(1)
})

function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    console.error('Error: not inside a git repository. Run cook from within a git repo.')
    process.exit(1)
  }
}

function tryFindProjectRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function usage(): void {
  console.error(`${BOLD}cook${RESET} — sandboxed agent loop

${BOLD}Usage:${RESET}
  cook "work"                     Run the work→review→gate loop
  cook "work" "review" "gate"    Custom prompts for each step
  cook "work" 5                  Run with 5 max iterations
  cook "work" "review" "gate" 5  All custom prompts + iterations
  cook init                       Set up COOK.md, config, and Dockerfile
  cook rebuild                    Rebuild the sandbox Docker image
  cook doctor                     Check Docker + auth readiness

${BOLD}Options:${RESET}
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
  --sandbox MODE                  Sandbox mode (agent|docker|none, default: agent)
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

interface ParsedArgs {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  model?: string
  agent?: string
  sandbox?: SandboxMode
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
    '--work-agent',
    '--review-agent',
    '--gate-agent',
    '--work-model',
    '--review-model',
    '--gate-model',
    '--max-iterations',
    '--sandbox',
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

  let maxIterations = flags['--max-iterations'] ? parseInt(flags['--max-iterations'], 10) : 3
  const prompts = [...positional]
  if (prompts.length > 1) {
    const last = prompts[prompts.length - 1]
    const n = parseInt(last, 10)
    if (!isNaN(n) && n.toString() === last) {
      maxIterations = n
      prompts.pop()
    }
  }

  const workPrompt = flags['--work'] ?? prompts[0] ?? ''
  const reviewPrompt = flags['--review'] ?? prompts[1] ?? DEFAULT_REVIEW_PROMPT
  const gatePrompt = flags['--gate'] ?? prompts[2] ?? DEFAULT_GATE_PROMPT
  const model = flags['--model']
  const agent = flags['--agent']
  const sandboxFlag = flags['--sandbox']
  const sandbox = (sandboxFlag === 'agent' || sandboxFlag === 'docker' || sandboxFlag === 'none') ? sandboxFlag : undefined
  if (sandboxFlag !== undefined && sandbox === undefined) {
    console.error(`Error: invalid sandbox mode "${sandboxFlag}". Expected one of: agent, docker, none.`)
    process.exit(1)
  }
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
    model,
    agent,
    sandbox,
    workAgent,
    reviewAgent,
    gateAgent,
    workModel,
    reviewModel,
    gateModel,
    showRequest,
  }
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
  sandbox: SandboxMode
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
  const sandbox = configStep.sandbox ?? parsed.sandbox ?? config.sandbox
  return { agent, model, sandbox }
}

function resolveAgentPlan(parsed: ParsedArgs, config: CookConfig): {
  defaultAgent: AgentName
  defaultModel: string
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
} {
  const defaultAgent = parseAgent(parsed.agent, config.agent)
  const defaultModel = parsed.model ?? config.model ?? defaultModelForAgent(defaultAgent)
  const stepConfig: Record<StepName, StepSelection> = {
    work: resolveStepSelection(parsed, config, 'work', defaultAgent, defaultModel),
    review: resolveStepSelection(parsed, config, 'review', defaultAgent, defaultModel),
    gate: resolveStepSelection(parsed, config, 'gate', defaultAgent, defaultModel),
  }
  const runAgents = [...new Set(STEP_NAMES.map(step => stepConfig[step].agent))]
  return { defaultAgent, defaultModel, stepConfig, runAgents }
}

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

  const projectRoot = tryFindProjectRoot()
  const config = projectRoot ? loadConfig(projectRoot) : FALLBACK_CONFIG
  if (projectRoot) {
    logOK(`Project detected: ${projectRoot}`)
  } else {
    logWarn('Not in a git repo; using default config for checks')
  }

  const parsed = parseArgs(args)
  const plan = resolveAgentPlan(parsed, config)

  logStep(`Default: ${plan.defaultAgent}:${plan.defaultModel}`)
  logStep(`Work: ${plan.stepConfig.work.agent}:${plan.stepConfig.work.model}`)
  logStep(`Review: ${plan.stepConfig.review.agent}:${plan.stepConfig.review.model}`)
  logStep(`Gate: ${plan.stepConfig.gate.agent}:${plan.stepConfig.gate.model}`)

  let allGood = true

  // Determine which sandbox modes are in use
  const usedModes = new Set(STEP_NAMES.map(step => plan.stepConfig[step].sandbox))
  logStep(`Sandbox modes: ${[...usedModes].join(', ')}`)

  // Docker checks — only when docker mode is used
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

  // Native mode checks — verify agent CLIs are on PATH
  if (usedModes.has('agent') || usedModes.has('none')) {
    for (const agent of plan.runAgents) {
      if (agent === 'opencode') continue // opencode not supported in native/bare
      try {
        execSync(`which ${agent}`, { encoding: 'utf8' })
        logOK(`${agent} CLI found on PATH`)
      } catch {
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

async function runLoop(args: string[]): Promise<void> {
  const projectRoot = findProjectRoot()
  const parsed = parseArgs(args)

  if (!parsed.workPrompt) {
    usage()
  }

  const config = loadConfig(projectRoot)
  const { defaultAgent, defaultModel, stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  const usedModes = [...new Set(STEP_NAMES.map(step => stepConfig[step].sandbox))]
  const sandboxLabel = usedModes.length === 1 ? usedModes[0] : usedModes.join(', ')

  const bannerLines = [
    `${BOLD}cook${RESET} — agent loop`,
    ``,
    `  Default:     ${defaultAgent}:${defaultModel}`,
    `  Sandbox:     ${sandboxLabel}`,
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

  pool = new RunnerPool(async (mode: SandboxMode) => {
    switch (mode) {
      case 'agent':
        return new NativeRunner(projectRoot, config.env)
      case 'docker': {
        const Docker = (await import('dockerode')).default
        const { startSandbox } = await import('./sandbox.js')
        const dockerConfig = loadDockerConfig(projectRoot)
        return startSandbox(new Docker(), projectRoot, config.env, dockerConfig, runAgents)
      }
      case 'none':
        return new BareRunner(projectRoot, config.env)
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

    await agentLoop(pool.get.bind(pool), {
      workPrompt: parsed.workPrompt,
      reviewPrompt: parsed.reviewPrompt,
      gatePrompt: parsed.gatePrompt,
      steps: stepConfig,
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
    case 'rebuild': await cmdRebuild(); break
    case 'doctor':  await cmdDoctor(args.slice(1)); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default:        await runLoop(args); break
  }
}

main().catch(err => { logErr(String(err)); process.exit(1) })
