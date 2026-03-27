import fs from 'fs'
import path from 'path'
import Docker from 'dockerode'
import { loadConfig, loadDockerConfig } from './config.js'
import { startSandbox, hasCookContainer } from './sandbox.js'
import { hasCommandOnPath, findProjectRoot } from './util.js'
import { logErr, logWarn, BOLD, RESET } from './log.js'

function shellUsage(): void {
  console.error(`${BOLD}cook shell${RESET} — interactive sandbox shell

${BOLD}Usage:${RESET}
  cook shell                          Open interactive bash in sandbox
  cook shell <command>                Run command in sandbox
  cook shell --unrestricted           Shell with unrestricted networking
  cook shell -- <command>             Pass all args after -- to container

${BOLD}Options:${RESET}
  --unrestricted                      Override network to unrestricted mode
  -h, --help                          Show this help

${BOLD}Examples:${RESET}
  cook shell ls -la                   List files in sandbox
  cook shell --unrestricted           Shell with full network access
  cook shell -- env --unrestricted    Run 'env --unrestricted' in container

Network is restricted per .cook/docker.json by default.
See .cook/docker.json for network configuration.`)
}

/**
 * Parse shell flags, supporting -- separator.
 * Flags before -- are parsed; everything after -- is passthrough.
 */
function parseShellArgs(args: string[]): { unrestricted: boolean; help: boolean; command: string[] } {
  let unrestricted = false
  let help = false
  const command: string[] = []
  let pastSeparator = false

  for (const arg of args) {
    if (pastSeparator) {
      command.push(arg)
      continue
    }
    if (arg === '--') {
      pastSeparator = true
      continue
    }
    if (arg === '--unrestricted') {
      unrestricted = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      command.push(arg)
    }
  }

  return { unrestricted, help, command }
}

export async function cmdShell(args: string[]): Promise<void> {
  // 1. Parse flags before any Docker work
  const { unrestricted, help, command } = parseShellArgs(args)

  // 2. If --help, print and exit (no Docker needed)
  if (help) {
    shellUsage()
    return
  }

  // 3. Validate docker CLI on PATH
  if (!hasCommandOnPath('docker')) {
    logErr('docker CLI not found on PATH. Install Docker and try again.')
    process.exitCode = 1
    return
  }

  // 4. Find project root, load config
  const projectRoot = findProjectRoot()

  // 5. Guard: .cook/ directory must exist
  const configPath = path.join(projectRoot, '.cook', 'config.json')
  if (!fs.existsSync(configPath)) {
    logErr("Project not initialized for cook. Run 'cook init' first.")
    process.exitCode = 1
    return
  }

  const config = loadConfig(projectRoot)
  const dockerConfig = loadDockerConfig(projectRoot)

  // Override network mode if --unrestricted
  if (unrestricted) {
    dockerConfig.network.mode = 'unrestricted'
  }

  const docker = new Docker()

  // 6. Guard: check for existing running cook container
  const hasRunning = await hasCookContainer(docker, projectRoot)
  if (hasRunning) {
    logErr("A cook container is already running for this project. Stop it first or use 'docker exec' directly.")
    process.exitCode = 1
    return
  }

  // 7. Start sandbox with verbose=true so users see build progress
  const sandbox = await startSandbox(
    docker,
    projectRoot,
    config.env,
    dockerConfig,
    [config.agent],
    true, // verbose
  )

  // 8. Print network notice if restricted
  if (dockerConfig.network.mode !== 'unrestricted') {
    logWarn('Network restricted per .cook/docker.json. Use --unrestricted for full access.')
  }

  // 9. Run shell, cleanup, propagate exit code
  try {
    const exitCode = await sandbox.shell(command)
    process.exitCode = exitCode
  } finally {
    try {
      await sandbox.stop()
    } catch {
      // Ignore stop errors so they don't mask the original shell error
    }
  }
}
