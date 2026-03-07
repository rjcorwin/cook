import { type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseTOML } from './toml.js'
import type { AgentRunner } from './runner.js'
import type { AgentName } from './config.js'
import { buildEnv, spawnAgent, gracefulShutdown } from './agent-utils.js'
import { logOK, logWarn } from './log.js'

export const DEFAULT_CLAUDE_PERMISSIONS = {
  permissions: {
    allow: [
      'Read', 'Glob', 'Grep', 'Edit', 'Write',
      'Bash(npm run *)', 'Bash(npm test *)', 'Bash(npm install *)',
      'Bash(npx *)', 'Bash(node *)',
      'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)',
      'Bash(git add *)', 'Bash(git commit *)', 'Bash(git checkout *)',
      'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)',
      'Bash(wc *)', 'Bash(find *)', 'Bash(grep *)',
      'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)',
    ],
  },
}

function resolveClaudeConfig(projectRoot: string): object {
  const customPath = path.join(projectRoot, '.cook', 'agents', 'claude.json')
  try {
    return JSON.parse(fs.readFileSync(customPath, 'utf8'))
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return DEFAULT_CLAUDE_PERMISSIONS
    }
    throw new Error(`Failed to parse ${customPath}: ${err}`)
  }
}

interface CodexFlags {
  sandbox: string
  approval: string
}

function resolveCodexFlags(projectRoot: string): CodexFlags {
  const defaults: CodexFlags = { sandbox: 'workspace-write', approval: 'never' }
  const customPath = path.join(projectRoot, '.cook', 'agents', 'codex.toml')
  let content: string
  try {
    content = fs.readFileSync(customPath, 'utf8')
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return defaults
    }
    throw new Error(`Failed to read ${customPath}: ${err}`)
  }
  const parsed = parseTOML(content)
  return {
    sandbox: typeof parsed.sandbox_mode === 'string' ? parsed.sandbox_mode : defaults.sandbox,
    approval: typeof parsed.approval_policy === 'string' ? parsed.approval_policy : defaults.approval,
  }
}

export class NativeRunner implements AgentRunner {
  private claudeConfigDir: string | null = null
  private activeProcesses = new Set<ChildProcess>()
  private projectRoot: string
  private env: string[]
  private exitHandler: () => void

  constructor(projectRoot: string, env: string[]) {
    this.projectRoot = projectRoot
    this.env = env

    this.exitHandler = () => {
      for (const proc of this.activeProcesses) {
        proc.kill('SIGKILL')
      }
    }
    process.on('exit', this.exitHandler)
  }

  private setupClaudeConfigDir(): string {
    if (this.claudeConfigDir) return this.claudeConfigDir

    this.claudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-claude-config-'))

    const home = os.homedir()
    const credSrc = path.join(home, '.claude', '.credentials.json')
    const credDst = path.join(this.claudeConfigDir, '.credentials.json')
    try {
      fs.copyFileSync(credSrc, credDst)
      fs.chmodSync(credDst, 0o600)
    } catch {
      logWarn('Claude credentials (~/.claude/.credentials.json) not found — agent may fail with auth error')
    }

    const settings = resolveClaudeConfig(this.projectRoot)
    fs.writeFileSync(
      path.join(this.claudeConfigDir, 'settings.json'),
      JSON.stringify(settings, null, 2),
    )

    return this.claudeConfigDir
  }

  async runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void,
  ): Promise<string> {
    switch (agent) {
      case 'claude':
        return this.runClaude(model, prompt, onLine)
      case 'codex':
        return this.runCodex(model, prompt, onLine)
      case 'opencode':
        throw new Error('OpenCode does not have a native OS sandbox. Use --sandbox docker or --sandbox none.')
    }
  }

  private runClaude(model: string, prompt: string, onLine: (line: string) => void): Promise<string> {
    const configDir = this.setupClaudeConfigDir()
    const env = buildEnv(this.env)
    env.CLAUDE_CONFIG_DIR = configDir

    return spawnAgent(
      'claude',
      ['--model', model, '-p'],
      prompt,
      env,
      this.projectRoot,
      onLine,
      this.activeProcesses,
    )
  }

  private runCodex(model: string, prompt: string, onLine: (line: string) => void): Promise<string> {
    const flags = resolveCodexFlags(this.projectRoot)
    const env = buildEnv(this.env)

    return spawnAgent(
      'codex',
      ['exec', '--sandbox', flags.sandbox, '--ask-for-approval', flags.approval, '--skip-git-repo-check', '--model', model, '-'],
      prompt,
      env,
      this.projectRoot,
      onLine,
      this.activeProcesses,
    )
  }

  async cleanup(): Promise<void> {
    process.removeListener('exit', this.exitHandler)
    await gracefulShutdown(this.activeProcesses)

    if (this.claudeConfigDir) {
      try {
        fs.rmSync(this.claudeConfigDir, { recursive: true, force: true })
      } catch {
        // best effort
      }
      this.claudeConfigDir = null
    }
    logOK('Native runner stopped')
  }
}
