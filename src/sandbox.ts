import Docker from 'dockerode'
import { pack } from 'tar-stream'
import { PassThrough, type Readable } from 'stream'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CookConfig } from './config.js'
import { logStep, logOK } from './log.js'
import { LineBuffer } from './line-buffer.js'

const BASE_DOCKERFILE = `FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
`

const BASE_IMAGE_NAME = 'cook-sandbox'

function createTarWithDockerfile(dockerfile: string): Readable {
  const p = pack()
  p.entry({ name: 'Dockerfile', size: Buffer.byteLength(dockerfile) }, dockerfile)
  p.finalize()
  return p
}

function createTarWithFile(filename: string, data: Buffer): Readable {
  const p = pack()
  p.entry({ name: filename, size: data.length }, data)
  p.finalize()
  return p
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function imageExists(docker: Docker, imageName: string): Promise<boolean> {
  try {
    await docker.getImage(imageName).inspect()
    return true
  } catch {
    return false
  }
}

async function containerExec(container: Docker.Container, user: string, cmd: string[]): Promise<void> {
  const exec = await container.exec({
    Cmd: cmd,
    User: user,
    AttachStdout: true,
    AttachStderr: true,
  })
  const stream = await exec.start({ hijack: true, stdin: false })
  stream.resume()
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  stream.destroy()

  const inspect = await exec.inspect()
  if (inspect.ExitCode !== 0) {
    throw new Error(`Setup command exited ${inspect.ExitCode}: ${cmd.join(' ')}`)
  }
}

async function ensureBaseImage(docker: Docker): Promise<void> {
  const exists = await imageExists(docker, BASE_IMAGE_NAME)
  if (exists) return
  logStep('Building sandbox image (first run)...')
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false)
}

async function buildImage(docker: Docker, imageName: string, dockerfile: string, verbose: boolean): Promise<void> {
  const tarStream = createTarWithDockerfile(dockerfile)

  const stream = await docker.buildImage(tarStream as NodeJS.ReadableStream, {
    t: imageName,
    rm: true,
  })

  if (verbose) {
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => err ? reject(err) : resolve(), (event: { stream?: string }) => {
        if (event.stream) process.stderr.write(event.stream)
      })
    })
  } else {
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => err ? reject(err) : resolve())
    })
  }

  logOK(`Image ${imageName} built`)
}

function getProjectImageTag(projectRoot: string): { imageName: string, dockerfile: string } | null {
  const dockerfilePath = path.join(projectRoot, '.cook.Dockerfile')
  let data: Buffer
  try {
    data = fs.readFileSync(dockerfilePath) as Buffer
  } catch {
    return null
  }
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12)
  const projectName = path.basename(projectRoot)
  return {
    imageName: `cook-project-${projectName}:${hash}`,
    dockerfile: data.toString(),
  }
}

async function cleanupStaleContainers(docker: Docker, projectRoot: string): Promise<void> {
  const containers = await docker.listContainers({ all: true })
  for (const info of containers) {
    if (info.Labels['cook.project'] !== projectRoot) continue
    for (const name of info.Names) {
      if (name.startsWith('/cook-')) {
        const container = docker.getContainer(info.Id)
        await container.remove({ force: true }).catch(() => {})
      }
    }
  }
}

async function copyFileToContainer(container: Docker.Container, hostPath: string, containerPath: string): Promise<void> {
  let data: Buffer
  try {
    data = fs.readFileSync(hostPath) as Buffer
  } catch {
    return
  }
  const dir = path.dirname(containerPath)
  const filename = path.basename(containerPath)
  const tarStream = createTarWithFile(filename, data)
  await container.putArchive(tarStream as NodeJS.ReadableStream, { path: dir })
}

async function copyAuthFiles(container: Docker.Container, userSpec: string): Promise<void> {
  await containerExec(container, 'root', ['mkdir', '-p', '/home/cook/.claude'])

  const home = os.homedir()
  await copyFileToContainer(container, path.join(home, '.claude.json'), '/home/cook/.claude.json')
  await copyFileToContainer(container, path.join(home, '.claude', '.credentials.json'), '/home/cook/.claude/.credentials.json')

  await containerExec(container, 'root', ['chown', '-R', userSpec, '/home/cook'])
}

function gitConfig(key: string, fallback: string): string {
  try {
    const out = execSync(`git config ${key}`, { encoding: 'utf8' }).trim()
    return out || fallback
  } catch {
    return fallback
  }
}

function generateIptablesScript(allowedHosts: string[]): string {
  const hosts = ['api.anthropic.com', ...allowedHosts]
  const hostList = hosts.join(' ')

  return `set -e
ALLOWED_IPS=""
for host in ${hostList}; do
    ips=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' || true)
    ALLOWED_IPS="$ALLOWED_IPS $ips"
done
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT
for ip in $ALLOWED_IPS; do
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
done`
}

async function runClaude(
  container: Docker.Container,
  docker: Docker,
  model: string,
  prompt: string,
  userSpec: string,
  env: string[],
  workingDir: string,
  onLine: (line: string) => void,
): Promise<string> {
  // Write prompt to a temp file to avoid ARG_MAX limits on large prompts
  const promptFile = `cook-prompt-${Date.now()}.txt`
  const promptBuf = Buffer.from(prompt)
  const promptTar = createTarWithFile(promptFile, promptBuf)
  await container.putArchive(promptTar as NodeJS.ReadableStream, { path: '/tmp' })

  const exec = await container.exec({
    Cmd: ['sh', '-c', `claude --model "$COOK_MODEL" --dangerously-skip-permissions -p < /tmp/${promptFile}; rc=$?; rm -f /tmp/${promptFile}; exit $rc`],
    Env: [...env, 'HOME=/home/cook', `COOK_MODEL=${model}`],
    User: userSpec,
    WorkingDir: workingDir,
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await exec.start({ hijack: true, stdin: false })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  docker.modem.demuxStream(stream, stdout, stderr)

  let output = ''
  const lineBuffer = new LineBuffer()

  stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    for (const line of lineBuffer.push(text)) {
      onLine(line)
    }
  })

  const stderrChunks: Buffer[] = []
  stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk)
  })

  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })

  stdout.destroy()
  stderr.destroy()
  stream.destroy()

  for (const line of lineBuffer.flush()) {
    onLine(line)
  }

  const inspect = await exec.inspect()
  if (inspect.ExitCode !== 0) {
    const stderrText = Buffer.concat(stderrChunks).toString()
    const err = new Error(`Claude exited ${inspect.ExitCode}: ${stderrText}`) as Error & { stdout: string }
    err.stdout = output
    throw err
  }

  return output
}

export class Sandbox {
  constructor(
    private docker: Docker,
    private container: Docker.Container,
    private userSpec: string,
    private env: string[],
    private projectRoot: string,
  ) {}

  async runClaude(model: string, prompt: string, onLine: (line: string) => void): Promise<string> {
    return runClaude(this.container, this.docker, model, prompt, this.userSpec, this.env, this.projectRoot, onLine)
  }

  async stop(): Promise<void> {
    await this.container.remove({ force: true }).catch(() => {})
    logOK('Sandbox stopped')
  }
}

export async function startSandbox(docker: Docker, projectRoot: string, config: CookConfig): Promise<Sandbox> {
  try {
    await docker.ping()
  } catch {
    console.error('Error: Docker daemon is not running. Start Docker and try again.')
    process.exit(1)
  }

  await cleanupStaleContainers(docker, projectRoot)
  await ensureBaseImage(docker)

  const projImage = getProjectImageTag(projectRoot)
  let imageName = BASE_IMAGE_NAME
  if (projImage) {
    const exists = await imageExists(docker, projImage.imageName)
    if (!exists) {
      logStep('Building project-specific sandbox image...')
      await buildImage(docker, projImage.imageName, projImage.dockerfile, true)
    }
    imageName = projImage.imageName
  }

  const uid = process.getuid!().toString()
  const gid = process.getgid!().toString()
  const userSpec = `${uid}:${gid}`

  const gitName = gitConfig('user.name', 'cook')
  const gitEmail = gitConfig('user.email', 'cook@localhost')
  const env = [
    `GIT_AUTHOR_NAME=${gitName}`,
    `GIT_AUTHOR_EMAIL=${gitEmail}`,
    `GIT_COMMITTER_NAME=${gitName}`,
    `GIT_COMMITTER_EMAIL=${gitEmail}`,
  ]
  for (const varName of config.env) {
    const val = process.env[varName]
    if (val !== undefined) env.push(`${varName}=${val}`)
  }

  const containerName = `cook-${process.pid}`
  const container = await docker.createContainer({
    name: containerName,
    Image: imageName,
    Cmd: ['sleep', 'infinity'],
    Labels: { 'cook.project': projectRoot },
    HostConfig: {
      Binds: [`${projectRoot}:${projectRoot}`],
      CapAdd: config.network.mode === 'restricted' ? ['NET_ADMIN'] : [],
    },
  })

  try {
    await container.start()
  } catch (err) {
    await container.remove({ force: true }).catch(() => {})
    throw err
  }

  const setupCmd = `groupadd -g ${gid} -o cookgroup 2>/dev/null || true; useradd -m -s /bin/bash -u ${uid} -g ${gid} -o cook 2>/dev/null || true`
  await containerExec(container, 'root', ['bash', '-c', setupCmd])

  await copyAuthFiles(container, userSpec)

  if (config.network.mode === 'restricted') {
    logStep('Applying network restrictions...')
    const script = generateIptablesScript(config.network.allowedHosts)
    await containerExec(container, 'root', ['sh', '-c', script])
    const allHosts = ['api.anthropic.com', ...config.network.allowedHosts]
    logOK(`Network restricted to: ${allHosts.join(', ')}`)
  }

  logOK(`Sandbox started (container: ${containerName})`)

  return new Sandbox(docker, container, userSpec, env, projectRoot)
}

export { BASE_IMAGE_NAME, BASE_DOCKERFILE, buildImage }

export async function rebuildBaseImage(): Promise<void> {
  const docker = new Docker()
  logStep('Removing existing cook-sandbox image...')
  try {
    await docker.getImage(BASE_IMAGE_NAME).remove({ force: true })
  } catch {
    // image doesn't exist, that's fine
  }
  logStep('Building cook-sandbox image...')
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false)
  logOK('Sandbox image rebuilt')
}
