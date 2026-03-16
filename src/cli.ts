#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import { loadConfig, loadDockerConfig, type AgentName, type CookConfig, type StepName, type StepSelection } from './config.js'
import { RunnerPool, type SandboxMode } from './runner.js'
import { NativeRunner } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { loadCookMD, DEFAULT_COOK_MD } from './template.js'
import { logPhase, logStep, logOK, logErr, logWarn, BOLD, RESET } from './log.js'
// sandbox.js is imported dynamically to avoid loading dockerode when not needed
import { agentLoop, loopEvents } from './loop.js'
import { App } from './ui/App.js'
import { runRace } from './race.js'
import { runRalph } from './ralph.js'
import { runForkJoin, cleanupActiveForkJoins, type ForkJoinConfig, type ForkJoinBranch } from './fork-join.js'

const DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`

const DEFAULT_GATE_PROMPT_WITH_NEXT = `Based on the review, respond with exactly DONE, ITERATE, or NEXT
on its own line, followed by a brief reason.

DONE if: all tasks are complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.
NEXT if: the current task is complete and correct, but there are more tasks to do.`

const DEFAULT_ITERATE_PROMPT = `Address the issues found in the review.
Check the session log for the review findings and fix the High severity issues.`

const DEFAULT_NEXT_PROMPT = `The previous task passed review. Continue to the next task.
Check the session log for context on what was completed.`

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
race/
fork/
`

const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

// Shared flag sets used by both parseArgs and cmdKeywordSegments
const VALUE_FLAGS = new Set([
  '--work', '--review', '--gate', '--model', '--agent',
  '--work-agent', '--review-agent', '--gate-agent',
  '--work-model', '--review-model', '--gate-model',
  '--max-iterations', '--max-nexts', '--sandbox',
])
const BOOLEAN_FLAGS = new Set(['--hide-request'])
const HYBRID_FLAGS = new Set(['--iterate', '--next'])
const SHORT_FLAG_MAP: Record<string, string> = { '-i': '--iterate', '-n': '--next', '-h': '--help' }

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
  await cleanupActiveForkJoins()
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
    return process.cwd()
  }
}


function usage(): void {
  console.error(`${BOLD}cook${RESET} — sandboxed agent loop

${BOLD}Usage:${RESET}
  cook "work"                     Run the work→review→gate loop
  cook "work" "review" "gate"    Custom prompts for each step
  cook "work" 5                  Run with 5 max iterations
  cook "work" "review" "gate" 5  All custom prompts + iterations
  cook "work" x3                  Race 3 parallel runs, judge the best
  cook "work" x3 "judge criteria" Race with custom judge instructions
  cook race 3 "work"              Race (explicit syntax)
  cook "work" -i                  Enable iterate prompt (default text)
  cook "work" -i "fix issues"    Custom iterate prompt
  cook "work" -n                  Enable NEXT verdict (default text)
  cook "work" ralph "next task" 5 Ralph loop: advance through tasks
  cook "work" ralph "n" race 3    Ralph + race composition
  cook "workA" vs "workB" judge "criteria"
                                  Fork-join: compare two approaches
  cook init                       Set up COOK.md, config, and Dockerfile
  cook rebuild                    Rebuild the sandbox Docker image
  cook doctor                     Check Docker + auth readiness

${BOLD}Options:${RESET}
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --iterate [PROMPT], -i          Iterate prompt (on ITERATE verdict)
  --next [PROMPT], -n             Next prompt (on NEXT verdict)
  --max-iterations N              Max review iterations (default: 3)
  --max-nexts N                   Max NEXT transitions (default: 3)
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
  iteratePrompt?: string
  nextPrompt?: string
  maxNexts?: number
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
  const flags: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    // Expand short flags
    if (arg in SHORT_FLAG_MAP) {
      const long = SHORT_FLAG_MAP[arg]
      if (long === '--help') { usage() }
      if (HYBRID_FLAGS.has(long)) {
        // Check if next arg is a value (not a flag, not a keyword)
        if (i + 1 < args.length && !args[i + 1].startsWith('-') && !isKeyword(args[i + 1])) {
          flags[long] = args[i + 1]
          i++
        } else {
          flags[long] = 'true'
        }
      }
      i++
      continue
    }

    if (arg.startsWith('--')) {
      const flag = arg
      if (flag.includes('=')) {
        const [key, ...rest] = flag.split('=')
        if (!VALUE_FLAGS.has(key) && !BOOLEAN_FLAGS.has(key) && !HYBRID_FLAGS.has(key)) {
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
        } else if (HYBRID_FLAGS.has(flag)) {
          // Hybrid: check if next arg is a value (not a flag/keyword)
          if (i + 1 < args.length && !args[i + 1].startsWith('-') && !isKeyword(args[i + 1])) {
            flags[flag] = args[i + 1]
            i++
          } else {
            flags[flag] = 'true'
          }
        } else if (BOOLEAN_FLAGS.has(flag)) {
          flags[flag] = 'true'
        } else {
          console.error(`Error: unknown option "${flag}"`)
          usage()
        }
      }
    } else {
      positional.push(arg)
    }
    i++
  }

  let maxIterations = flags['--max-iterations'] ? parseInt(flags['--max-iterations'], 10) : 3
  const maxNexts = flags['--max-nexts'] ? parseInt(flags['--max-nexts'], 10) : undefined
  const prompts = [...positional]
  if (prompts.length > 1) {
    const last = prompts[prompts.length - 1]
    const n = parseInt(last, 10)
    if (!isNaN(n) && n.toString() === last) {
      maxIterations = n
      prompts.pop()
    }
  }

  // Resolve iterate prompt
  let iteratePrompt: string | undefined
  if (flags['--iterate']) {
    iteratePrompt = flags['--iterate'] === 'true' ? DEFAULT_ITERATE_PROMPT : flags['--iterate']
  }

  // Resolve next prompt
  let nextPrompt: string | undefined
  if (flags['--next']) {
    nextPrompt = flags['--next'] === 'true' ? DEFAULT_NEXT_PROMPT : flags['--next']
  }

  // If iterate prompt is in the positional args (4th position), use it
  const iterateFromPositional = prompts[3]
  if (iterateFromPositional && !iteratePrompt) {
    iteratePrompt = iterateFromPositional
  }

  const workPrompt = flags['--work'] ?? prompts[0] ?? ''
  const reviewPrompt = flags['--review'] ?? prompts[1] ?? DEFAULT_REVIEW_PROMPT
  // Use NEXT-aware gate prompt when next is enabled
  const defaultGate = nextPrompt ? DEFAULT_GATE_PROMPT_WITH_NEXT : DEFAULT_GATE_PROMPT
  const gatePrompt = flags['--gate'] ?? prompts[2] ?? defaultGate
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
    iteratePrompt,
    nextPrompt,
    maxNexts,
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

// --- Keyword segment parser ---

const KEYWORDS = new Set(['race', 'ralph'])

function isKeyword(arg: string): boolean {
  return KEYWORDS.has(arg.toLowerCase())
}

interface KeywordSegment {
  keyword: 'race' | 'ralph'
  numericParam?: number
  stringParam?: string
}

interface ParsedSegments {
  baseArgs: string[]
  keywords: KeywordSegment[]
}

function parseKeywordSegments(positional: string[]): ParsedSegments {
  const baseArgs: string[] = []
  const keywords: KeywordSegment[] = []

  let i = 0

  // Collect base args (everything before first keyword)
  while (i < positional.length && !isKeyword(positional[i])) {
    baseArgs.push(positional[i])
    i++
  }

  // Collect keyword segments
  while (i < positional.length) {
    if (!isKeyword(positional[i])) {
      // Shouldn't happen, but safety
      baseArgs.push(positional[i])
      i++
      continue
    }

    const keyword = positional[i].toLowerCase() as 'race' | 'ralph'
    i++

    let numericParam: number | undefined
    let stringParam: string | undefined

    // Consume duck-typed params until next keyword or end
    while (i < positional.length && !isKeyword(positional[i])) {
      const val = positional[i]
      const n = parseInt(val, 10)
      if (!isNaN(n) && n.toString() === val && n > 0 && numericParam === undefined) {
        numericParam = n
      } else if (stringParam === undefined) {
        stringParam = val
      } else {
        logWarn(`Warning: extra parameter "${val}" for keyword "${keyword}" ignored`)
      }
      i++
    }

    keywords.push({ keyword, numericParam, stringParam })
  }

  return { baseArgs, keywords }
}

function hasKeywordSegments(args: string[]): boolean {
  return args.some(arg => isKeyword(arg))
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

const STEP_NAMES: StepName[] = ['work', 'review', 'gate']

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

  const projectRoot = findProjectRoot()
  const config = loadConfig(projectRoot)

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

async function runLoop(args: string[], overrides?: {
  iteratePrompt?: string
  nextPrompt?: string
  maxNexts?: number
  gatePrompt?: string
}): Promise<void> {
  const projectRoot = findProjectRoot()
  const parsed = parseArgs(args)

  if (!parsed.workPrompt) {
    usage()
  }

  const config = loadConfig(projectRoot)
  const { defaultAgent, defaultModel, stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  // Resolve iterate/next from CLI flags → config → overrides (keyword segments)
  const iteratePrompt = parsed.iteratePrompt
    ?? (config.iterate ? (config.iteratePrompt ?? DEFAULT_ITERATE_PROMPT) : undefined)
    ?? overrides?.iteratePrompt
  const nextPrompt = parsed.nextPrompt
    ?? (config.next ? (config.nextPrompt ?? DEFAULT_NEXT_PROMPT) : undefined)
    ?? overrides?.nextPrompt
  const maxNexts = parsed.maxNexts ?? config.maxNexts ?? overrides?.maxNexts ?? 3

  // Use NEXT-aware gate prompt when next is enabled
  const gatePrompt = overrides?.gatePrompt ?? parsed.gatePrompt
  const effectiveGatePrompt = nextPrompt && gatePrompt === DEFAULT_GATE_PROMPT
    ? DEFAULT_GATE_PROMPT_WITH_NEXT : gatePrompt

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
    ...(iteratePrompt ? [`  Iterate:     enabled`] : []),
    ...(nextPrompt ? [`  Next:        enabled (max ${maxNexts})`] : []),
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
        maxNexts: nextPrompt ? maxNexts : undefined,
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
      gatePrompt: effectiveGatePrompt,
      iteratePrompt,
      nextPrompt,
      maxNexts,
      steps: stepConfig,
      maxIterations: parsed.maxIterations,
      projectRoot,
    }, cookMD, loopEvents)

    await waitUntilExit()
  } finally {
    await cleanup()
  }
}

async function cmdRaceFromMultiplier(n: number, remaining: string[], judgePrompt?: string): Promise<void> {
  const projectRoot = findProjectRoot()

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logErr('cook race requires a git repository (for worktree isolation)')
    process.exit(1)
  }

  const parsed = parseArgs(remaining)
  if (!parsed.workPrompt) {
    logErr('Work prompt is required')
    process.exit(1)
  }

  const config = loadConfig(projectRoot)
  const { stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  const iteratePrompt = parsed.iteratePrompt
    ?? (config.iterate ? (config.iteratePrompt ?? DEFAULT_ITERATE_PROMPT) : undefined)
  const nextPrompt = parsed.nextPrompt
    ?? (config.next ? (config.nextPrompt ?? DEFAULT_NEXT_PROMPT) : undefined)
  const effectiveGatePrompt = nextPrompt && parsed.gatePrompt === DEFAULT_GATE_PROMPT
    ? DEFAULT_GATE_PROMPT_WITH_NEXT : parsed.gatePrompt

  await runRace(n, projectRoot, {
    workPrompt: parsed.workPrompt,
    reviewPrompt: parsed.reviewPrompt,
    gatePrompt: effectiveGatePrompt,
    iteratePrompt,
    nextPrompt,
    maxNexts: parsed.maxNexts ?? config.maxNexts ?? 3,
    maxIterations: parsed.maxIterations,
    stepConfig,
    config,
    runAgents,
    showRequest: parsed.showRequest,
    judgePrompt,
  })
}

async function cmdRace(raceArgs: string[]): Promise<void> {
  const n = parseInt(raceArgs[0], 10)
  if (!n || n < 2) {
    logErr('Usage: cook race N "prompt" (N must be >= 2)')
    process.exit(1)
  }

  const remaining = raceArgs.slice(1)
  const projectRoot = findProjectRoot()

  // Verify we're in a git repo (worktrees require it)
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logErr('cook race requires a git repository (for worktree isolation)')
    process.exit(1)
  }

  const parsed = parseArgs(remaining)
  if (!parsed.workPrompt) {
    logErr('Usage: cook race N "prompt"')
    process.exit(1)
  }

  const config = loadConfig(projectRoot)
  const { stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  const iteratePrompt = parsed.iteratePrompt
    ?? (config.iterate ? (config.iteratePrompt ?? DEFAULT_ITERATE_PROMPT) : undefined)
  const nextPrompt = parsed.nextPrompt
    ?? (config.next ? (config.nextPrompt ?? DEFAULT_NEXT_PROMPT) : undefined)
  const effectiveGatePrompt = nextPrompt && parsed.gatePrompt === DEFAULT_GATE_PROMPT
    ? DEFAULT_GATE_PROMPT_WITH_NEXT : parsed.gatePrompt

  await runRace(n, projectRoot, {
    workPrompt: parsed.workPrompt,
    reviewPrompt: parsed.reviewPrompt,
    gatePrompt: effectiveGatePrompt,
    iteratePrompt,
    nextPrompt,
    maxNexts: parsed.maxNexts ?? config.maxNexts ?? 3,
    maxIterations: parsed.maxIterations,
    stepConfig,
    config,
    runAgents,
    showRequest: parsed.showRequest,
  })
}

/** Scan args for an xN multiplier (e.g. x3). Returns null if not found. */
function extractRaceMultiplier(args: string[]): { n: number; before: string[]; judgePrompt?: string } | null {
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^x(\d+)$/i)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n >= 2) {
        const before = args.slice(0, i)
        // Everything after xN that isn't a flag is the judge prompt
        const after = args.slice(i + 1)
        // Find first non-flag positional arg after xN as judge prompt
        let judgePrompt: string | undefined
        const remaining: string[] = []
        for (let j = 0; j < after.length; j++) {
          if (after[j].startsWith('--')) {
            remaining.push(after[j])
            // If it's a value flag, grab next arg too
            if (j + 1 < after.length && !after[j + 1].startsWith('--')) {
              remaining.push(after[j + 1])
              j++
            }
          } else if (judgePrompt === undefined) {
            judgePrompt = after[j]
          } else {
            remaining.push(after[j])
          }
        }
        return { n, before: [...before, ...remaining], judgePrompt }
      }
    }
  }
  return null
}

const JOIN_KEYWORDS = new Set(['judge', 'merge', 'summarize'])

function parseForkJoinArgs(rawArgs: string[]): { forkJoin: ForkJoinConfig; remaining: string[] } {
  // Separate flags from positional args (uses module-level flag sets)
  const flags: string[] = []
  const positional: string[] = []

  let i = 0
  while (i < rawArgs.length) {
    const arg = rawArgs[i]
    const expanded = SHORT_FLAG_MAP[arg] || arg
    if (expanded.startsWith('--')) {
      flags.push(arg)
      const flagName = expanded.includes('=') ? expanded.split('=')[0] : expanded
      if (VALUE_FLAGS.has(flagName)) {
        if (!expanded.includes('=') && i + 1 < rawArgs.length) {
          flags.push(rawArgs[i + 1])
          i++
        }
      } else if (HYBRID_FLAGS.has(flagName)) {
        // Hybrid flags optionally take a value (next arg if it doesn't look like a flag)
        if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
          flags.push(rawArgs[i + 1])
          i++
        }
      }
    } else {
      positional.push(arg)
    }
    i++
  }

  // Parse positional args: triples separated by "vs", then join keyword, then xN
  const branches: ForkJoinBranch[] = []
  let currentTriple: string[] = []

  let joinType: 'judge' | 'merge' | 'summarize' | null = null
  let joinCriteria = 'Combine the best elements from each branch into a coherent implementation.'
  let joinMaxIterations = 3
  let parallelCount: number | null = null
  let parallelCriteria: string | null = null

  let j = 0
  while (j < positional.length) {
    const token = positional[j]

    if (token.toLowerCase() === 'vs') {
      // Push current triple as a branch
      if (currentTriple.length === 0) {
        console.error('Error: empty branch before "vs"')
        process.exit(1)
      }
      branches.push(tripleToBranch(currentTriple))
      currentTriple = []
      j++
      continue
    }

    if (JOIN_KEYWORDS.has(token.toLowerCase())) {
      // Push any remaining triple
      if (currentTriple.length > 0) {
        branches.push(tripleToBranch(currentTriple))
        currentTriple = []
      }
      joinType = token.toLowerCase() as 'judge' | 'merge' | 'summarize'
      j++

      if (joinType === 'summarize') {
        // No criteria for summarize
      } else {
        // Next positional is criteria (unless it's xN)
        if (j < positional.length && !positional[j].match(/^x\d+$/i)) {
          joinCriteria = positional[j]
          j++
        }
        // For merge, check if next positional is a number (maxIterations)
        if (joinType === 'merge' && j < positional.length && !positional[j].match(/^x\d+$/i)) {
          const n = parseInt(positional[j], 10)
          if (!isNaN(n) && n.toString() === positional[j]) {
            joinMaxIterations = n
            j++
          }
        }
      }
      continue
    }

    const xMatch = token.match(/^x(\d+)$/i)
    if (xMatch) {
      // Push any remaining triple
      if (currentTriple.length > 0) {
        branches.push(tripleToBranch(currentTriple))
        currentTriple = []
      }
      parallelCount = parseInt(xMatch[1], 10)
      j++
      // Next positional is meta-judge criteria
      if (j < positional.length) {
        parallelCriteria = positional[j]
        j++
      }
      continue
    }

    currentTriple.push(token)
    j++
  }

  // Push any remaining triple
  if (currentTriple.length > 0) {
    branches.push(tripleToBranch(currentTriple))
  }

  // Validate
  if (branches.length < 2) {
    console.error('Error: fork-join requires at least 2 branches separated by "vs"')
    process.exit(1)
  }

  for (let b = 0; b < branches.length; b++) {
    if (!branches[b].work.trim()) {
      console.error(`Error: branch ${b + 1} has an empty work prompt`)
      process.exit(1)
    }
  }

  if (!joinType) {
    joinType = 'merge'
  }

  if (joinType === 'summarize' && parallelCount && parallelCount > 1) {
    console.error('Error: summarize + x<N> is not supported (no single output to rank)')
    process.exit(1)
  }

  let join: ForkJoinConfig['join']
  switch (joinType) {
    case 'judge':
      join = { type: 'judge', criteria: joinCriteria }
      break
    case 'merge':
      join = { type: 'merge', criteria: joinCriteria, maxIterations: joinMaxIterations }
      break
    case 'summarize':
      join = { type: 'summarize' }
      break
  }

  const parallel = parallelCount && parallelCount > 1
    ? { count: parallelCount, criteria: parallelCriteria }
    : null

  return {
    forkJoin: { branches, join, parallel },
    remaining: flags,
  }
}

function tripleToBranch(parts: string[]): ForkJoinBranch {
  let maxIterations = 3
  const prompts = [...parts]

  // Check if last element is a number (maxIterations)
  if (prompts.length > 1) {
    const last = prompts[prompts.length - 1]
    const n = parseInt(last, 10)
    if (!isNaN(n) && n.toString() === last) {
      maxIterations = n
      prompts.pop()
    }
  }

  return {
    work: prompts[0] || '',
    review: prompts[1] || DEFAULT_REVIEW_PROMPT,
    gate: prompts[2] || DEFAULT_GATE_PROMPT,
    maxIterations,
  }
}

function hasForkJoinSyntax(rawArgs: string[]): boolean {
  return rawArgs.some(arg => arg.toLowerCase() === 'vs')
}

async function cmdForkJoin(rawArgs: string[]): Promise<void> {
  const projectRoot = findProjectRoot()

  // Verify git repo
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    logErr('cook fork-join requires a git repository (for worktree isolation)')
    process.exit(1)
  }

  const { forkJoin, remaining } = parseForkJoinArgs(rawArgs)
  const parsed = parseArgs(remaining)

  const config = loadConfig(projectRoot)
  const { stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  await runForkJoin(projectRoot, {
    forkJoin,
    stepConfig,
    config,
    runAgents,
    showRequest: parsed.showRequest,
  })
}

async function cmdKeywordSegments(rawArgs: string[]): Promise<void> {
  // Separate flags from positional for keyword parsing
  const flagArgs: string[] = []
  const positionalArgs: string[] = []

  let i = 0
  while (i < rawArgs.length) {
    if (rawArgs[i].startsWith('--') || rawArgs[i] === '-i' || rawArgs[i] === '-n' || rawArgs[i] === '-h') {
      flagArgs.push(rawArgs[i])
      // Check if it's a value flag that consumes the next arg
      if (rawArgs[i].startsWith('--') && !rawArgs[i].includes('=')) {
        if (VALUE_FLAGS.has(rawArgs[i]) && i + 1 < rawArgs.length) {
          flagArgs.push(rawArgs[i + 1])
          i++
        } else if (HYBRID_FLAGS.has(rawArgs[i]) && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-') && !isKeyword(rawArgs[i + 1])) {
          flagArgs.push(rawArgs[i + 1])
          i++
        }
      } else if ((rawArgs[i] === '-i' || rawArgs[i] === '-n') && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-') && !isKeyword(rawArgs[i + 1])) {
        flagArgs.push(rawArgs[i + 1])
        i++
      }
    } else {
      positionalArgs.push(rawArgs[i])
    }
    i++
  }

  const { baseArgs, keywords } = parseKeywordSegments(positionalArgs)

  const projectRoot = findProjectRoot()

  // Check if any keyword needs git (race uses worktrees)
  const hasRace = keywords.some(k => k.keyword === 'race')
  if (hasRace) {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' })
    } catch {
      logErr('cook race requires a git repository (for worktree isolation)')
      process.exit(1)
    }
  }

  // Extract ralph and race segments
  const ralphSegment = keywords.find(k => k.keyword === 'ralph')
  const raceSegment = keywords.find(k => k.keyword === 'race')

  // Merge baseArgs with flags for parseArgs
  const argsForParsing = [...baseArgs, ...flagArgs]
  const parsed = parseArgs(argsForParsing)

  if (!parsed.workPrompt) {
    logErr('Work prompt is required')
    process.exit(1)
  }

  const config = loadConfig(projectRoot)
  const { stepConfig, runAgents } = resolveAgentPlan(parsed, config)

  // Resolve iterate/next from flags, config, and keyword params
  const iteratePrompt = parsed.iteratePrompt
    ?? (config.iterate ? (config.iteratePrompt ?? DEFAULT_ITERATE_PROMPT) : undefined)
  const nextPrompt = ralphSegment?.stringParam
    ?? parsed.nextPrompt
    ?? (config.next ? (config.nextPrompt ?? DEFAULT_NEXT_PROMPT) : undefined)
    ?? DEFAULT_NEXT_PROMPT  // ralph keyword implies next
  const maxNexts = ralphSegment?.numericParam
    ?? parsed.maxNexts
    ?? config.maxNexts
    ?? 3

  // Use NEXT-aware gate prompt when next is enabled
  const effectiveGatePrompt = nextPrompt && parsed.gatePrompt === DEFAULT_GATE_PROMPT
    ? DEFAULT_GATE_PROMPT_WITH_NEXT : parsed.gatePrompt

  if (ralphSegment && raceSegment) {
    // Composed mode: keywords compose right-to-left (rightmost = outermost)
    // e.g., "cook w race 3 ralph n 5" → ralph(race(base))
    // e.g., "cook w ralph n race 3" → race(ralph(base))
    const raceCount = raceSegment.numericParam ?? 3
    const raceCriteria = raceSegment.stringParam

    // Build execution from left to right (innermost first)
    const raceIdx = keywords.indexOf(raceSegment)
    const ralphIdx = keywords.indexOf(ralphSegment)

    if (raceIdx < ralphIdx) {
      // race then ralph → ralph(race(base))
      // Ralph is outer loop, race is inner
      await runRalph(maxNexts, projectRoot, {
        workPrompt: parsed.workPrompt,
        reviewPrompt: parsed.reviewPrompt,
        gatePrompt: effectiveGatePrompt,
        iteratePrompt,
        maxIterations: parsed.maxIterations,
        stepConfig,
        config,
        runAgents,
        showRequest: parsed.showRequest,
        nextPrompt,
        raceCount,
        raceCriteria,
      })
    } else {
      // ralph then race → race(ralph(base))
      // Race is outer, ralph is inner
      await runRace(raceCount, projectRoot, {
        workPrompt: parsed.workPrompt,
        reviewPrompt: parsed.reviewPrompt,
        gatePrompt: effectiveGatePrompt,
        maxIterations: parsed.maxIterations,
        stepConfig,
        config,
        runAgents,
        showRequest: parsed.showRequest,
        judgePrompt: raceCriteria,
        iteratePrompt,
        nextPrompt,
        maxNexts,
      })
    }
  } else if (ralphSegment) {
    // Ralph only (no race)
    await runRalph(maxNexts, projectRoot, {
      workPrompt: parsed.workPrompt,
      reviewPrompt: parsed.reviewPrompt,
      gatePrompt: effectiveGatePrompt,
      iteratePrompt,
      maxIterations: parsed.maxIterations,
      stepConfig,
      config,
      runAgents,
      showRequest: parsed.showRequest,
      nextPrompt,
    })
  } else if (raceSegment) {
    // Race only via keyword syntax
    const raceCount = raceSegment.numericParam ?? 3
    await cmdRaceFromMultiplier(raceCount, [...baseArgs, ...flagArgs], raceSegment.stringParam)
  }
}

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'init':    cmdInit(findProjectRoot()); break
    case 'rebuild': await cmdRebuild(); break
    case 'doctor':  await cmdDoctor(args.slice(1)); break
    case 'race':    await cmdRace(args.slice(1)); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default: {
      // Check for fork-join syntax: cook "workA" vs "workB" judge "criteria"
      if (hasForkJoinSyntax(args)) {
        await cmdForkJoin(args)
      } else if (hasKeywordSegments(args)) {
        // Keyword segment syntax: cook "w" race 3 ralph "n" 5
        await cmdKeywordSegments(args)
      } else {
        // Check for xN multiplier syntax: cook "prompt" x3 "judge instructions"
        const race = extractRaceMultiplier(args)
        if (race) {
          await cmdRaceFromMultiplier(race.n, race.before, race.judgePrompt)
        } else {
          await runLoop(args)
        }
      }
      break
    }
  }
}

main().catch(err => { logErr(String(err)); process.exit(1) })
