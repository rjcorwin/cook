import { type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentRunner } from './runner.js'
import type { AgentName } from './config.js'
import { buildEnv, spawnAgent, gracefulShutdown } from './agent-utils.js'
import { logOK } from './log.js'

export class BareRunner implements AgentRunner {
  private activeProcesses = new Set<ChildProcess>()
  private projectRoot: string
  private env: string[]
  private exitHandler: () => void
  private tempFiles: string[] = []

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

  async runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void,
  ): Promise<string> {
    const { cmd, args, pipeStdin } = this.agentCommand(agent, model, prompt)
    const env = buildEnv(this.env)

    return spawnAgent(cmd, args, prompt, env, this.projectRoot, onLine, this.activeProcesses, pipeStdin)
  }

  private agentCommand(agent: AgentName, model: string, prompt: string): { cmd: string; args: string[]; pipeStdin: boolean } {
    switch (agent) {
      case 'claude':
        return { cmd: 'claude', args: ['--dangerously-skip-permissions', '--model', model, '-p'], pipeStdin: true }
      case 'codex':
        return { cmd: 'codex', args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--model', model, '-'], pipeStdin: true }
      case 'opencode': {
        // Write prompt to temp file to avoid ARG_MAX (~2MB) with large prompts.
        // Shell reads from file via $(cat), keeping the initial spawn args small.
        const tmpFile = path.join(os.tmpdir(), `cook-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
        fs.writeFileSync(tmpFile, prompt)
        this.tempFiles.push(tmpFile)
        return { cmd: 'sh', args: ['-c', 'exec opencode run -m "$1" "$(cat "$2")"', '--', model, tmpFile], pipeStdin: false }
      }
    }
  }

  async cleanup(): Promise<void> {
    process.removeListener('exit', this.exitHandler)
    await gracefulShutdown(this.activeProcesses)

    for (const tmpFile of this.tempFiles) {
      try { fs.unlinkSync(tmpFile) } catch { /* best effort */ }
    }
    this.tempFiles = []
    logOK('Bare runner stopped')
  }
}
