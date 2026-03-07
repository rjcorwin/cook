import { spawn, type ChildProcess } from 'child_process'
import type { AgentName } from './config.js'
import type { AgentRunner } from './runner.js'
import { LineBuffer } from './line-buffer.js'

export class NativeRunner implements AgentRunner {
  private child: ChildProcess | null = null

  constructor(
    private projectRoot: string,
    private env: string[],
  ) {}

  protected getBypassFlags(_agent: AgentName): string[] {
    return []
  }

  async runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void,
  ): Promise<string> {
    if (agent === 'opencode') {
      throw new Error('opencode is not supported in native mode — it has no OS-level sandbox. Use --sandbox docker instead.')
    }

    const { cmd, args } = this.buildCommand(agent, model)
    const envVars: Record<string, string> = { ...process.env } as Record<string, string>
    for (const entry of this.env) {
      const eq = entry.indexOf('=')
      if (eq !== -1) {
        envVars[entry.slice(0, eq)] = entry.slice(eq + 1)
      } else {
        const val = process.env[entry]
        if (val !== undefined) envVars[entry] = val
      }
    }

    return new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: this.projectRoot,
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child

      let output = ''
      const lineBuffer = new LineBuffer()
      const stderrChunks: Buffer[] = []

      child.stdout!.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        output += text
        for (const line of lineBuffer.push(text)) {
          onLine(line)
        }
      })

      child.stderr!.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      child.on('close', (code) => {
        this.child = null
        for (const line of lineBuffer.flush()) {
          onLine(line)
        }
        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString()
          const err = new Error(`${agent} exited ${code}: ${stderrText}`) as Error & { stdout: string }
          err.stdout = output
          reject(err)
        } else {
          resolve(output)
        }
      })

      child.on('error', (err) => {
        this.child = null
        reject(err)
      })

      // Write prompt to stdin and close it
      child.stdin!.write(prompt)
      child.stdin!.end()
    })
  }

  async stop(): Promise<void> {
    if (!this.child) return
    this.child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.child?.kill('SIGKILL')
        resolve()
      }, 5000)
      this.child!.on('close', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    this.child = null
  }

  private buildCommand(agent: AgentName, model: string): { cmd: string; args: string[] } {
    const bypassFlags = this.getBypassFlags(agent)
    switch (agent) {
      case 'claude':
        return {
          cmd: 'claude',
          args: ['--model', model, '-p', ...bypassFlags],
        }
      case 'codex':
        return {
          cmd: 'codex',
          args: ['exec', '--model', model, '--skip-git-repo-check', ...bypassFlags, '-'],
        }
      default:
        throw new Error(`Unsupported agent for native runner: ${agent}`)
    }
  }
}
