#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render } from 'ink'
import Docker from 'dockerode'
import { loadConfig } from './config.js'
import { loadCookMD, DEFAULT_COOK_MD } from './template.js'
import { logPhase, logStep, logOK, logErr, logWarn, BOLD, RESET, CYAN } from './log.js'
import { startSandbox, rebuildBaseImage, type Sandbox } from './sandbox.js'
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
  "network": {
    "mode": "default",
    "allowedHosts": []
  },
  "env": []
}
`

const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

let sandbox: Sandbox | null = null
let inkInstance: { unmount: () => void } | null = null

async function cleanup() {
  if (inkInstance) {
    inkInstance.unmount()
    inkInstance = null
  }
  if (sandbox) {
    await sandbox.stop()
    sandbox = null
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

function usage(): void {
  console.error(`${BOLD}cook${RESET} — sandboxed agent loop

${BOLD}Usage:${RESET}
  cook "work"                     Run the work→review→gate loop
  cook "work" "review" "gate"    Custom prompts for each step
  cook "work" 5                  Run with 5 max iterations
  cook "work" "review" "gate" 5  All custom prompts + iterations
  cook init                       Set up COOK.md, config, and Dockerfile
  cook rebuild                    Rebuild the sandbox Docker image

${BOLD}Options:${RESET}
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --max-iterations N              Max review iterations (default: 3)
  --model MODEL                   Claude model (default: opus)
  --hide-request                  Hide the templated request for each step
  -h, --help                      Show this help`)
  process.exit(1)
}

function cmdInit(projectRoot: string): void {
  logPhase('Initialize project for cook')

  const files = [
    { path: 'COOK.md', content: DEFAULT_COOK_MD },
    { path: '.cook.config.json', content: DEFAULT_COOK_CONFIG_JSON },
    { path: '.cook.Dockerfile', content: DEFAULT_COOK_DOCKERFILE },
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

  fs.mkdirSync(path.join(projectRoot, '.cook', 'logs'), { recursive: true })

  logOK('Project initialized for cook')
  logStep(`Edit COOK.md to customize the agent loop prompts`)
  logStep(`Edit .cook.config.json to configure network restrictions and env vars`)
  logStep(`Edit .cook.Dockerfile to add project-specific dependencies`)
}

async function cmdRebuild(): Promise<void> {
  logPhase('Rebuild sandbox image')
  await rebuildBaseImage()
}

interface ParsedArgs {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  model: string
  showRequest: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const VALUE_FLAGS = new Set(['--work', '--review', '--gate', '--model', '--max-iterations'])

  const flags: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const flag = args[i]
      if (flag.includes('=')) {
        const [key, ...rest] = flag.split('=')
        flags[key] = rest.join('=')
      } else if (VALUE_FLAGS.has(flag) && i + 1 < args.length) {
        flags[flag] = args[i + 1]
        i++
      } else {
        flags[flag] = 'true'
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
  const model = flags['--model'] ?? 'opus'
  const showRequest = flags['--hide-request'] !== 'true'

  return { workPrompt, reviewPrompt, gatePrompt, maxIterations, model, showRequest }
}

async function runLoop(args: string[]): Promise<void> {
  const projectRoot = findProjectRoot()
  const parsed = parseArgs(args)

  if (!parsed.workPrompt) {
    usage()
  }

  const config = loadConfig(projectRoot)

  console.error(`${BOLD}cook${RESET} — agent loop`)
  console.error(`  Model:      ${parsed.model}`)
  console.error(`  Iterations: ${parsed.maxIterations}`)
  console.error(`  Project:    ${projectRoot}`)

  const docker = new Docker()
  try {
    sandbox = await startSandbox(docker, projectRoot, config)
  } catch (err) {
    logErr(`Sandbox failed: ${err}`)
    process.exit(1)
  }

  try {
    const cookMD = loadCookMD(projectRoot)
    const { unmount, waitUntilExit } = render(
      React.createElement(App, { maxIterations: parsed.maxIterations, model: parsed.model, showRequest: parsed.showRequest }),
      { exitOnCtrlC: false }
    )
    inkInstance = { unmount }

    await agentLoop(sandbox, {
      workPrompt: parsed.workPrompt,
      reviewPrompt: parsed.reviewPrompt,
      gatePrompt: parsed.gatePrompt,
      maxIterations: parsed.maxIterations,
      model: parsed.model,
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
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default:        await runLoop(args); break
  }
}

main().catch(err => { logErr(String(err)); process.exit(1) })
