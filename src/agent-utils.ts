import { spawn, spawnSync, type ChildProcess } from 'child_process'
import type { AgentName } from './config.js'
import { LineBuffer } from './line-buffer.js'

export function gracefulShutdown(activeProcesses: Set<ChildProcess>): Promise<void> {
  const killPromises: Promise<void>[] = []
  for (const proc of activeProcesses) {
    if (proc.exitCode !== null) continue
    proc.kill('SIGTERM')
    killPromises.push(
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 5000)
        proc.on('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      }),
    )
  }
  return Promise.all(killPromises).then(() => { activeProcesses.clear() })
}

export function gitConfig(key: string, fallback: string): string {
  const result = spawnSync('git', ['config', key], { encoding: 'utf8', stdio: 'pipe' })
  const out = result.stdout?.trim()
  return out || fallback
}

export function whichSync(cmd: string): boolean {
  const result = spawnSync('which', [cmd], { encoding: 'utf8', stdio: 'pipe' })
  return result.status === 0
}

export function buildEnv(envPassthrough: string[]): Record<string, string> {
  const gitName = gitConfig('user.name', 'cook')
  const gitEmail = gitConfig('user.email', 'cook@localhost')
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GIT_AUTHOR_NAME: gitName,
    GIT_AUTHOR_EMAIL: gitEmail,
    GIT_COMMITTER_NAME: gitName,
    GIT_COMMITTER_EMAIL: gitEmail,
  }
  for (const entry of envPassthrough) {
    const eqIdx = entry.indexOf('=')
    if (eqIdx > 0) {
      env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1)
    }
  }
  return env
}

export function spawnAgent(
  cmd: string,
  args: string[],
  prompt: string,
  env: Record<string, string>,
  cwd: string,
  onLine: (line: string) => void,
  activeProcesses: Set<ChildProcess>,
  pipeStdin: boolean = true,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    activeProcesses.add(proc)

    let output = ''
    const lineBuffer = new LineBuffer()
    const stderrChunks: Buffer[] = []
    let stderrLen = 0
    const STDERR_MAX = 1024 * 1024 // 1 MB

    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      for (const line of lineBuffer.push(text)) {
        onLine(line)
      }
    })

    proc.stderr!.on('data', (chunk: Buffer) => {
      if (stderrLen < STDERR_MAX) {
        stderrChunks.push(chunk)
        stderrLen += chunk.length
      }
    })

    proc.on('close', (code) => {
      activeProcesses.delete(proc)
      for (const line of lineBuffer.flush()) {
        onLine(line)
      }
      if (code !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString()
        const err = new Error(`${cmd} exited ${code}: ${stderrText}`) as Error & { stdout: string }
        err.stdout = output
        reject(err)
      } else {
        resolve(output)
      }
    })

    proc.on('error', (err) => {
      activeProcesses.delete(proc)
      reject(err)
    })

    if (pipeStdin) {
      proc.stdin!.write(prompt)
    }
    proc.stdin!.end()
  })
}
