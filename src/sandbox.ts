import Docker from 'dockerode'
import { pack } from 'tar-stream'
import { PassThrough, type Readable } from 'stream'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentName, DockerConfig } from './config.js'
import type { AgentRunner } from './runner.js'
import { logStep, logOK, logWarn } from './log.js'
import { LineBuffer } from './line-buffer.js'

const BASE_DOCKERFILE = `FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai
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

function resolveDockerfilePath(projectRoot: string): string | null {
  const dockerfilePath = path.join(projectRoot, '.cook', 'Dockerfile')
  if (fs.existsSync(dockerfilePath)) return dockerfilePath
  return null
}

function getProjectImageTag(projectRoot: string): { imageName: string, dockerfile: string } | null {
  const dockerfilePath = resolveDockerfilePath(projectRoot)
  if (!dockerfilePath) return null
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
  await containerExec(container, 'root', ['mkdir', '-p', '/home/cook/.codex'])
  await containerExec(container, 'root', ['mkdir', '-p', '/home/cook/.config/opencode'])
  await containerExec(container, 'root', ['mkdir', '-p', '/home/cook/.local/share/opencode'])

  const home = os.homedir()
  await copyFileToContainer(container, path.join(home, '.claude.json'), '/home/cook/.claude.json')
  await copyFileToContainer(container, path.join(home, '.claude', '.credentials.json'), '/home/cook/.claude/.credentials.json')
  await copyFileToContainer(container, path.join(home, '.codex', 'auth.json'), '/home/cook/.codex/auth.json')
  await copyFileToContainer(container, path.join(home, '.codex', 'config.toml'), '/home/cook/.codex/config.toml')
  await copyFileToContainer(container, path.join(home, '.config', 'opencode', 'opencode.json'), '/home/cook/.config/opencode/opencode.json')
  await copyFileToContainer(container, path.join(home, '.local', 'share', 'opencode', 'auth.json'), '/home/cook/.local/share/opencode/auth.json')

  await containerExec(container, 'root', ['chown', '-R', userSpec, '/home/cook'])
}

function hasClaudeContainerCredentials(env: string[]): boolean {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.claude', '.credentials.json'))) return true
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN && env.includes('CLAUDE_CODE_OAUTH_TOKEN')) return true
  return false
}

function hasCodexContainerCredentials(env: string[]): boolean {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.codex', 'auth.json'))) return true
  if (process.env.OPENAI_API_KEY && env.includes('OPENAI_API_KEY')) return true
  return false
}

function hasOpencodeContainerCredentials(env: string[]): boolean {
  const home = os.homedir()
  if (fs.existsSync(path.join(home, '.local', 'share', 'opencode', 'auth.json'))) return true
  if (fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.json'))) return true
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    if (process.env[name] && env.includes(name)) return true
  }
  return false
}

function gitConfig(key: string, fallback: string): string {
  try {
    const out = execSync(`git config ${key}`, { encoding: 'utf8' }).trim()
    return out || fallback
  } catch {
    return fallback
  }
}

function requiredHostsForAgent(agent: AgentName): string[] {
  switch (agent) {
    case 'claude':
      return ['api.anthropic.com']
    case 'codex':
      return ['api.openai.com']
    case 'opencode':
      // opencode can route to multiple providers depending on user config.
      return ['api.openai.com', 'api.anthropic.com', 'api.opencode.ai']
  }
}

function requiredHostsForAgents(agents: AgentName[]): string[] {
  return [...new Set(agents.flatMap(requiredHostsForAgent))]
}

function generateIptablesScript(agents: AgentName[], allowedHosts: string[]): string {
  const hosts = [...new Set([...requiredHostsForAgents(agents), ...allowedHosts])]
  const hostList = hosts.join(' ')

  return `set -e
ALLOWED_IPS=""
for host in ${hostList}; do
    ips=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)
    ALLOWED_IPS="$ALLOWED_IPS $ips"
done
DNS_SERVERS=$(awk '/^nameserver/{print $2}' /etc/resolv.conf)
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
for dns in $DNS_SERVERS; do
    iptables -A OUTPUT -p udp -d "$dns" --dport 53 -j ACCEPT
    iptables -A OUTPUT -p tcp -d "$dns" --dport 53 -j ACCEPT
done
for ip in $ALLOWED_IPS; do
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
done`
}

function runCommandForAgent(agent: AgentName, promptFile: string): string {
  switch (agent) {
    case 'claude':
      return `claude --model "$COOK_MODEL" --dangerously-skip-permissions -p < /tmp/${promptFile}`
    case 'codex':
      return `codex exec --model "$COOK_MODEL" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < /tmp/${promptFile}`
    case 'opencode':
      return `opencode run -m "$COOK_MODEL" "$(cat /tmp/${promptFile})"`
  }
}

async function runAgent(
  container: Docker.Container,
  docker: Docker,
  agent: AgentName,
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
  await containerExec(container, 'root', ['chown', userSpec, `/tmp/${promptFile}`])
  const agentCommand = runCommandForAgent(agent, promptFile)

  const exec = await container.exec({
    Cmd: ['sh', '-c', `${agentCommand}; rc=$?; rm -f /tmp/${promptFile}; exit $rc`],
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
    const authHint = agent === 'claude' && stderrText.includes('Not logged in')
      ? ' Claude auth is unavailable in-container. If host `claude auth status` is logged in but this still fails, run `claude setup-token` on host to generate portable CLI credentials.'
      : ''
    const err = new Error(`${agent} exited ${inspect.ExitCode}: ${stderrText}${authHint}`) as Error & { stdout: string }
    err.stdout = output
    throw err
  }

  return output
}

export class Sandbox implements AgentRunner {
  private aborted = false

  constructor(
    private docker: Docker,
    private container: Docker.Container,
    private userSpec: string,
    private env: string[],
    private projectRoot: string,
  ) {}

  async runAgent(agent: AgentName, model: string, prompt: string, onLine: (line: string) => void): Promise<string> {
    if (this.aborted) {
      throw new Error('Runner was stopped (cancelled)')
    }
    return runAgent(this.container, this.docker, agent, model, prompt, this.userSpec, this.env, this.projectRoot, onLine)
  }

  async stop(): Promise<void> {
    this.aborted = true
    await this.container.remove({ force: true }).catch(() => {})
    logOK('Sandbox stopped')
  }
}

export async function startSandbox(docker: Docker, projectRoot: string, env: string[], dockerConfig: DockerConfig, agents: AgentName[]): Promise<Sandbox> {
  try {
    await docker.ping()
  } catch {
    console.error('Error: Docker daemon is not running. Start Docker and try again.')
    process.exit(1)
  }

  await cleanupStaleContainers(docker, projectRoot)
  await ensureBaseImage(docker)
  if (agents.includes('claude') && !hasClaudeContainerCredentials(env)) {
    logWarn('Claude selected but ~/.claude/.credentials.json is missing on host. OAuth/keychain-only logins usually do not transfer to Linux containers; run `claude setup-token` on host.')
  }
  if (agents.includes('codex') && !hasCodexContainerCredentials(env)) {
    logWarn('Codex selected but no container-usable credentials found. Add ~/.codex/auth.json or set OPENAI_API_KEY and include it in .cook.config.json env passthrough.')
  }
  if (agents.includes('opencode') && !hasOpencodeContainerCredentials(env)) {
    logWarn('OpenCode selected but no container-usable credentials found. Add ~/.local/share/opencode/auth.json or set OPENAI_API_KEY/ANTHROPIC_API_KEY and include it in .cook.config.json env passthrough.')
  }

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
  const containerEnv = [
    `GIT_AUTHOR_NAME=${gitName}`,
    `GIT_AUTHOR_EMAIL=${gitEmail}`,
    `GIT_COMMITTER_NAME=${gitName}`,
    `GIT_COMMITTER_EMAIL=${gitEmail}`,
  ]
  for (const varName of env) {
    const val = process.env[varName]
    if (val !== undefined) containerEnv.push(`${varName}=${val}`)
  }

  const projectHash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)
  const containerName = `cook-${projectHash}`
  const container = await docker.createContainer({
    name: containerName,
    Image: imageName,
    Cmd: ['sleep', 'infinity'],
    Labels: { 'cook.project': projectRoot },
    HostConfig: {
      Binds: [`${projectRoot}:${projectRoot}`],
      CapAdd: dockerConfig.network.mode !== 'unrestricted' ? ['NET_ADMIN'] : [],
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

  if (dockerConfig.network.mode !== 'unrestricted') {
    logStep('Applying network restrictions...')
    const script = generateIptablesScript(agents, dockerConfig.network.allowedHosts)
    await containerExec(container, 'root', ['sh', '-c', script])
    const allHosts = [...new Set([...requiredHostsForAgents(agents), ...dockerConfig.network.allowedHosts])]
    logOK(`Network restricted to: ${allHosts.join(', ')}`)
  }

  logOK(`Sandbox started (container: ${containerName})`)

  return new Sandbox(docker, container, userSpec, containerEnv, projectRoot)
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
