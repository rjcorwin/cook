# Plan: Rewrite cook in TypeScript with Ink TUI

**Status:** Draft (rev 9 — addresses review 8 issues (8 fixes): HIGH: App component calls useApp().exit() on done/error so Ink unmounts and waitUntilExit() resolves (process no longer hangs). MEDIUM: CLI dispatch wrapped in async main() with .catch() for clean error handling, loadConfig uses logWarn instead of raw console.error, App component fully specified with render JSX (Static/StatusBar/error display), elapsed timer useEffect, and StatusBar component. LOW: Sandbox.stop() logs "Sandbox stopped", loadCookMD() implementation shown, usage() matches Go format (bold intro line, aligned examples with descriptions), startup summary "cook" is bold.)
**Author:** AI
**Created:** 2026-03-01

## Summary

Rewrite cook from a ~850-line Go program to a TypeScript CLI using [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and [dockerode](https://github.com/apocas/dockerode). The rewrite adds a persistent status bar showing loop progress, replaces Go `text/template` with JavaScript template literals for COOK.md, and publishes as an npm package. The core work→review→gate loop, Docker sandbox model, and session logging are preserved unchanged.

## Motivation

The current Go implementation works well but has two UX gaps:

1. **No persistent status display.** Users must scroll through output or `tail -f` the log to know where the loop is. A fixed status bar showing the current step, iteration, elapsed time, and model eliminates this.

2. **Unfamiliar template syntax.** Go's `text/template` (`{{.Step}}`, `{{if .LastMessage}}`) is niche. JavaScript template literals (`${step}`, ternary operators) are universally known among JS/TS developers and more expressive.

Secondary benefits:
- npm distribution (`npx cook`) is simpler than Go binary installation
- TypeScript is more accessible to contributors than Go
- Ink's React component model makes the TUI composable and testable

## Goals

- Full feature parity with the Go version: work→review→gate loop, `init`, `rebuild`, Docker sandbox, session logging, network restriction, env var passthrough, project-specific Dockerfiles
- Persistent status bar at the bottom of the terminal showing step, iteration, model, elapsed time
- Real-time streaming of Claude's output to the terminal (not waiting for completion)
- COOK.md uses JS template literal syntax (`${step}`, `${iteration}`, etc.)
- Publish as `@rjcorwin/cook` on npm
- ESM-only (Ink has been ESM-only since v5; v6 requires Node >= 20 and React >= 19)

## Non-Goals

- Alternate screen buffer (output stays inline, scrollable)
- Token usage or cost tracking in the status bar (future work)
- Backwards compatibility with Go `text/template` COOK.md syntax (users migrate manually)
- Supporting CJS imports
- Web UI or any non-terminal interface

## Technical Design

### Project Structure

```
src/
  cli.ts          — CLI entry point, arg parsing, command dispatch
  config.ts       — .cook.config.json parsing (CookConfig type)
  template.ts     — COOK.md loading, JS template literal evaluation, default template
  loop.ts         — Agent loop orchestration, gate verdict parsing
  sandbox.ts      — Docker lifecycle via dockerode (build, start, exec, stop)
  log.ts          — Session log file management (create, append), colored logging helpers
  line-buffer.ts  — LineBuffer class (shared by sandbox.ts and ui/LogStream.tsx)
  ui/
    App.tsx        — Root Ink component, state management, layout
    StatusBar.tsx  — Fixed bottom bar (step, iteration, model, elapsed time)
    LogStream.tsx  — Streaming output area using Ink's <Static>
package.json
tsconfig.json
tsup.config.ts
```

### Core Types

```typescript
// template.ts
interface LoopContext {
  step: string          // "work", "review", "gate"
  prompt: string        // the step-specific prompt
  lastMessage: string   // output from previous claude run ("" on first call)
  iteration: number
  maxIterations: number
  logFile: string       // path to session log file
}

// config.ts
interface CookConfig {
  network: {
    mode: "default" | "restricted"
    allowedHosts: string[]
  }
  env: string[]
}

// loop.ts
interface LoopConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  model: string
  projectRoot: string
}
```

### Ink TUI Layout

```
┌──────────────────────────────────────────────────┐
│ [Claude output streams here in real-time]        │
│ ...                                              │
│ ...                                              │
│ (past output rendered via <Static> as complete   │
│  lines — scrolls naturally in the terminal)      │
├──────────────────────────────────────────────────┤
│ work 1/3 | opus | 2m 13s | .cook/logs/2026-...  │
└──────────────────────────────────────────────────┘
```

**How it works:**

- `<Static>` renders completed items once and never re-renders them. Each item must be a **complete line** with a stable, unique key. Raw dockerode chunks are buffered into complete lines before being committed to `<Static>` (see "Streaming line buffer" below).
- The status bar is a `<Box>` with fixed height at the bottom. The content area above uses `flexGrow: 1` to fill remaining space.
- No alternate screen buffer — output stays inline, preserving scroll history.
- Terminal width is read via `useStdout()` to size the status bar.

**Streaming line buffer:** Dockerode streams may deliver chunks that split mid-line or mid-word. A line buffer accumulates incoming data and only flushes complete lines (split on `\n`) to the `<Static>` item list. The last partial line is held in the buffer until more data arrives or the stream ends (at which point any remaining content is flushed as the final line). This ensures each `<Static>` item is a complete line with a stable identity.

```typescript
// In src/line-buffer.ts (NOT in ui/ — also imported by sandbox.ts's runClaude)
class LineBuffer {
  private partial = ''

  push(chunk: string): string[] {
    this.partial += chunk
    const parts = this.partial.split('\n')
    this.partial = parts.pop()!  // last element is incomplete line (or '')
    return parts  // complete lines ready for <Static>
  }

  flush(): string[] {
    if (this.partial) {
      const last = this.partial
      this.partial = ''
      return [last]
    }
    return []
  }
}
```

**App.tsx state:**

```typescript
interface AppState {
  step: string            // current step name
  iteration: number       // current iteration
  maxIterations: number
  model: string
  startTime: number       // Date.now() at loop start
  logFile: string         // session log path
  logLines: string[]      // accumulated complete lines for <Static>
                          // Note: grows unbounded for the session. Ink's <Static> renders each
                          // item once and removes it from the React tree, so rendering cost is O(1),
                          // but the array stays in memory. For typical sessions (~1000 lines) this is
                          // fine. For very long sessions, consider capping to last N lines if needed.
  done: boolean           // true when loop finishes
  error: string | null    // error message if loop fails
}
```

**Behavioral change from Go:** The Go version writes all logging/status to stderr and Claude output to stdout. The Ink version renders everything to stdout (Ink owns the terminal). Users who pipe `cook` output will see Ink's rendered output instead of raw Claude text. This is an intentional tradeoff for the TUI — raw output mode could be added later as `cook --raw` if needed.

The agent loop communicates with the Ink app via an EventEmitter pattern (not direct state mutation in callbacks):

```typescript
// loop.ts exports an EventEmitter
const loopEvents = new EventEmitter()

// App.tsx subscribes to loop events and exits Ink when done/error
const { exit } = useApp()

useEffect(() => {
  loopEvents.on('logFile', (logFile: string) => setState(s => ({ ...s, logFile })))
  loopEvents.on('step', ({ step, iteration }) => setState(s => ({ ...s, step, iteration })))
  loopEvents.on('line', (line: string) => setState(s => ({ ...s, logLines: [...s.logLines, line] })))
  loopEvents.on('done', () => setState(s => ({ ...s, done: true })))
  loopEvents.on('error', (err: string) => setState(s => ({ ...s, error: err })))
  return () => { loopEvents.removeAllListeners() }
}, [])

// Exit the Ink app when the loop finishes or errors — this resolves waitUntilExit().
// Without this, the process hangs after agentLoop completes because Ink never unmounts.
useEffect(() => {
  if (state.done || state.error) exit()
}, [state.done, state.error])

// Elapsed time timer — updates every second for the status bar
const [elapsed, setElapsed] = useState(0)
useEffect(() => {
  const timer = setInterval(() => {
    setElapsed(Math.floor((Date.now() - state.startTime) / 1000))
  }, 1000)
  return () => clearInterval(timer)
}, [state.startTime])
```

This avoids the scoping issue where `state` was referenced inside the `onChunk` callback without being in scope.

**App.tsx render logic:**

```tsx
// Full render — <Static> for scrolling log output, error display, and fixed StatusBar at bottom
return (
  <Box flexDirection="column" height="100%">
    {/* Completed log lines — rendered once each, then removed from React tree */}
    <Static items={state.logLines}>
      {(line, index) => <Text key={index}>{line}</Text>}
    </Static>

    {/* Error display — shown when the loop fails */}
    {state.error && (
      <Box marginTop={1}>
        <Text color="red" bold>Error: {state.error}</Text>
      </Box>
    )}

    {/* Fixed status bar at the bottom */}
    <StatusBar
      step={state.step}
      iteration={state.iteration}
      maxIterations={state.maxIterations}
      model={state.model}
      elapsed={elapsed}
      logFile={state.logFile}
      done={state.done}
    />
  </Box>
)
```

**StatusBar.tsx:**

```tsx
function StatusBar({ step, iteration, maxIterations, model, elapsed, logFile, done }: StatusBarProps) {
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m${s}s` : `${s}s`
  }

  const status = done
    ? 'done'
    : `${step} ${iteration}/${maxIterations}`

  const bar = `${status} | ${model} | ${formatElapsed(elapsed)} | ${logFile}`

  return (
    <Box borderStyle="single" width={width}>
      <Text>{bar}</Text>
    </Box>
  )
}
```

### Template System

**Go (current):**
```
Step: **{{.Step}}** | Iteration: {{.Iteration}}/{{.MaxIterations}}
{{if .LastMessage}}### Previous Output
{{.LastMessage}}{{end}}
```

**TypeScript (new):**
```
Step: **${step}** | Iteration: ${iteration}/${maxIterations}
${lastMessage ? '### Previous Output\n' + lastMessage : ''}
```

**Template expression constraint:** Because `renderTemplate` escapes all backticks globally (so markdown code fences don't break the outer template literal), template expressions inside `${...}` must use single/double quotes, not backticks. Nested template literals would be destroyed by the escape pass. This is documented in the default template and the error message.

**Implementation:** COOK.md is read as a string. At render time, backticks in the content are escaped (so markdown code fences don't break the template literal), then it's evaluated as a JS template literal using `new Function()`:

```typescript
// Cache the compiled template function — Go parses the template once at loop start.
// Without caching, `new Function()` is called 3 times per iteration (work, review, gate).
let cachedTemplateSrc: string | null = null
let cachedTemplateFn: Function | null = null

function renderTemplate(cookMD: string, ctx: LoopContext): string {
  // Escape backticks so markdown code fences (```) don't terminate the template literal.
  // Dollar signs NOT followed by { are escaped so $BASH_VAR in code blocks stays literal.
  const escaped = cookMD
    .replace(/`/g, '\\`')
    .replace(/\$(?!\{)/g, '\\$')

  try {
    // Reuse compiled function if the template source hasn't changed
    let fn: Function
    if (cachedTemplateSrc === escaped && cachedTemplateFn) {
      fn = cachedTemplateFn
    } else {
      fn = new Function(
        ...Object.keys(ctx),
        `return \`${escaped}\``
      )
      cachedTemplateSrc = escaped
      cachedTemplateFn = fn
    }
    return fn(...Object.values(ctx))
  } catch (err) {
    throw new Error(
      `Template error in COOK.md: ${err instanceof SyntaxError ? err.message : err}\n` +
      `Hint: Backticks and bare $ are escaped automatically.\n` +
      `For a literal \${...} in output, use \\\${...} in COOK.md.`
    )
  }
}
```

**Why this works:**
- Markdown code fences (`` ``` ``) contain backticks → escaped to `` \` `` so they don't terminate the outer template literal
- `$BASH_VAR` in code blocks → `$` not followed by `{` is escaped to `\$`, stays literal
- `${step}`, `${lastMessage ? '...' : ''}` → `$` IS followed by `{`, not escaped, evaluated as template expressions ✓
- For literal `${...}` in output, use `\${...}` in COOK.md (same convention as JS template literals)

**Safety:** Unlike Go's `text/template` (which is genuinely sandboxed and can only interpolate values / run simple control flow), `new Function()` can execute arbitrary JavaScript — e.g., `${require('child_process').execSync('rm -rf /')}` in COOK.md would execute. This is acceptable because COOK.md is a user-controlled project file — the user can already run arbitrary code via their project. Context values (like `lastMessage`) are passed as function arguments, so injected content in Claude output cannot execute as template expressions.

### Docker Sandbox (dockerode)

Maps 1:1 from the Go Docker SDK:

| Go (current) | dockerode (new) |
|---|---|
| `client.NewClientWithOpts()` | `new Docker()` |
| `cli.ImageInspectWithRaw()` | `docker.getImage(name).inspect()` |
| `cli.ImageBuild()` | `docker.buildImage(tarStream, opts)` |
| `cli.ContainerCreate()` | `docker.createContainer(opts)` |
| `cli.ContainerStart()` | `container.start()` |
| `cli.ContainerRemove()` | `container.remove({ force: true })` |
| `cli.ContainerExecCreate()` + `ExecAttach()` | `container.exec(opts)` + `exec.start()` |
| `cli.CopyToContainer()` | `container.putArchive(tarStream, opts)` |

#### Tar Archive Helpers

Used by `buildImage` and `copyFileToContainer` to create in-memory tar archives (replaces Go's `archive/tar`):

```typescript
import { pack } from 'tar-stream'
import { PassThrough, Readable } from 'stream'

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
    chunks.push(chunk)
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

// Simplified exec helper for setup commands (runs as specified user, no custom env/workdir)
// Checks exit codes — critical for iptables setup where silent failure is a security gap.
async function containerExec(container: Docker.Container, user: string, cmd: string[]): Promise<void> {
  const exec = await container.exec({
    Cmd: cmd,
    User: user,
    AttachStdout: true,
    AttachStderr: true,
  })
  const stream = await exec.start({ hijack: true, stdin: false })
  // Drain data so 'end' fires — without this, the stream stays paused and never emits 'end'
  stream.resume()
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  stream.destroy()

  // Check exit code — Go checks all exec exit codes. Without this, iptables failures
  // are silently swallowed and the container runs without network restrictions.
  const inspect = await exec.inspect()
  if (inspect.ExitCode !== 0) {
    throw new Error(`Setup command exited ${inspect.ExitCode}: ${cmd.join(' ')}`)
  }
}
```

#### Base Dockerfile

The base image Dockerfile is a string constant in `sandbox.ts` (not an external file):

```typescript
const BASE_DOCKERFILE = `FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
`

const BASE_IMAGE_NAME = 'cook-sandbox'

async function ensureBaseImage(docker: Docker): Promise<void> {
  const exists = await imageExists(docker, BASE_IMAGE_NAME)
  if (exists) return
  logStep('Building sandbox image (first run)...')
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false)
}
```

#### Project-Specific Dockerfile & SHA256 Content Hashing

When `.cook.Dockerfile` exists, cook builds a project-specific image tagged with a content hash so changes automatically trigger rebuilds:

```typescript
import { createHash } from 'crypto'

function getProjectImageTag(projectRoot: string): { imageName: string, dockerfile: string } | null {
  const dockerfilePath = path.join(projectRoot, '.cook.Dockerfile')
  let data: Buffer
  try {
    data = fs.readFileSync(dockerfilePath)
  } catch {
    return null  // no project Dockerfile
  }
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12)
  const projectName = path.basename(projectRoot)
  return {
    imageName: `cook-project-${projectName}:${hash}`,
    dockerfile: data.toString(),
  }
}
```

The image name follows the pattern `cook-project-{basename}:{hash12}` — same as the Go version. On each run, if the hash differs from any existing `cook-project-{basename}:*` image, a new image is built. This means editing `.cook.Dockerfile` triggers an automatic rebuild without running `cook rebuild`.

#### Image Build (Verbose vs Silent)

```typescript
async function buildImage(docker: Docker, imageName: string, dockerfile: string, verbose: boolean): Promise<void> {
  // Create in-memory tar with the Dockerfile
  const tarStream = createTarWithDockerfile(dockerfile)

  const stream = await docker.buildImage(tarStream, {
    t: imageName,
    rm: true,
  })

  if (verbose) {
    // Stream build output to stderr so the user sees progress
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve(), (event) => {
        if (event.stream) process.stderr.write(event.stream)
      })
    })
  } else {
    // Silently consume the stream (required to complete the build)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve())
    })
  }

  logOK(`Image ${imageName} built`)
}
```

- Base image (`cook-sandbox`): built silently (`verbose: false`)
- Project-specific images: built with visible output (`verbose: true`) — matches Go behavior from commit `9b58894`

#### Container Naming & Labels

```typescript
const containerName = `cook-${process.pid}`

const container = await docker.createContainer({
  name: containerName,
  Image: imageName,
  Labels: {
    'cook.project': projectRoot,
  },
  // ...
})
```

Containers are named `cook-{pid}` (PID of the Node.js process). The `cook.project` label stores the absolute project root path — used for stale container cleanup.

#### Stale Container Cleanup

Before starting a new container, remove any leftover containers from previous runs of the same project:

```typescript
async function cleanupStaleContainers(docker: Docker, projectRoot: string): Promise<void> {
  const containers = await docker.listContainers({ all: true })
  for (const info of containers) {
    if (info.Labels['cook.project'] !== projectRoot) continue
    for (const name of info.Names) {
      if (name.startsWith('/cook-')) {
        const container = docker.getContainer(info.Id)
        await container.remove({ force: true }).catch(() => {})  // ignore errors
      }
    }
  }
}
```

Filters on both the `cook.project` label (same project) AND the `/cook-` name prefix. This prevents accumulating orphaned containers from crashes or Ctrl+C during cleanup.

#### User/Group Creation in Container

After starting the container, create a matching user so file permissions align with the host:

```typescript
const uid = process.getuid!().toString()
const gid = process.getgid!().toString()
const userSpec = `${uid}:${gid}`

// Create group and user inside container (suppress errors for UID/GID collisions)
const setupCmd = [
  `groupadd -g ${gid} -o cookgroup 2>/dev/null || true`,
  `useradd -m -s /bin/bash -u ${uid} -g ${gid} -o cook 2>/dev/null || true`,
].join('; ')

await containerExec(container, 'root', ['bash', '-c', setupCmd])
```

The `-o` flag allows non-unique UID/GID (handles collisions with existing container users like `node`). The `2>/dev/null || true` ensures the command succeeds even if the user/group already exists.

#### Auth File Copying

Copy Claude credentials into the container so Claude can authenticate inside the sandbox:

```typescript
import os from 'os'

async function copyAuthFiles(container: Docker.Container, userSpec: string): Promise<void> {
  await containerExec(container, 'root', ['mkdir', '-p', '/home/cook/.claude'])

  const home = os.homedir()

  // Copy auth files — skip silently if they don't exist
  await copyFileToContainer(container, path.join(home, '.claude.json'), '/home/cook/.claude.json')
  await copyFileToContainer(container, path.join(home, '.claude', '.credentials.json'), '/home/cook/.claude/.credentials.json')

  // Fix ownership of the entire home directory
  await containerExec(container, 'root', ['chown', '-R', userSpec, '/home/cook'])
}
```

`copyFileToContainer` reads the file and creates a tar archive to send via `container.putArchive()`. If the host file doesn't exist, it returns silently (same as Go):

```typescript
async function copyFileToContainer(container: Docker.Container, hostPath: string, containerPath: string): Promise<void> {
  let data: Buffer
  try {
    data = fs.readFileSync(hostPath)
  } catch {
    return  // file doesn't exist, skip silently
  }
  const dir = path.dirname(containerPath)
  const filename = path.basename(containerPath)
  const tarStream = createTarWithFile(filename, data)
  await container.putArchive(tarStream, { path: dir })
}
```

#### Git Config for Container Environment

Read git config from the host, with fallbacks:

```typescript
import { execSync } from 'child_process'

function gitConfig(key: string, fallback: string): string {
  try {
    const out = execSync(`git config ${key}`, { encoding: 'utf8' }).trim()
    return out || fallback
  } catch {
    return fallback
  }
}
```

Used when building the container environment:

```typescript
const gitName = gitConfig('user.name', 'cook')
const gitEmail = gitConfig('user.email', 'cook@localhost')

const env = [
  `GIT_AUTHOR_NAME=${gitName}`,
  `GIT_AUTHOR_EMAIL=${gitEmail}`,
  `GIT_COMMITTER_NAME=${gitName}`,
  `GIT_COMMITTER_EMAIL=${gitEmail}`,
]

// Pass through user-configured env vars from .cook.config.json
for (const varName of config.env) {
  const val = process.env[varName]
  if (val !== undefined) {
    env.push(`${varName}=${val}`)
  }
}
```

#### Container Exec (General Helper)

Throws on non-zero exit, but attaches stdout to the error object so callers can inspect partial output from failed commands:

```typescript
async function containerExecWithEnv(
  container: Docker.Container,
  userSpec: string,
  env: string[],
  cmd: string[],
  workingDir: string,
): Promise<{ stdout: string, stderr: string }> {
  const exec = await container.exec({
    Cmd: cmd,
    User: userSpec,
    Env: env,
    WorkingDir: workingDir,
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await exec.start({ hijack: true, stdin: false })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  container.modem.demuxStream(stream, stdout, stderr)

  const [stdoutBuf, stderrBuf] = await Promise.all([
    streamToBuffer(stdout),
    streamToBuffer(stderr),
  ])

  const inspect = await exec.inspect()
  const result = { stdout: stdoutBuf.toString(), stderr: stderrBuf.toString() }

  if (inspect.ExitCode !== 0) {
    const err = new Error(`Command exited ${inspect.ExitCode}: ${result.stderr}`) as Error & { stdout: string }
    err.stdout = result.stdout  // attach stdout to error for partial output inspection
    throw err
  }

  return result
}
```

#### Network Restriction (iptables)

Same iptables script as Go, always includes `api.anthropic.com`:

```typescript
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
```

#### Streaming Claude Output

The key UX improvement. Instead of buffering the entire exec output:

```typescript
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
  const exec = await container.exec({
    Cmd: ['claude', '--model', model, '--dangerously-skip-permissions', '--print', prompt],
    Env: [...env, 'HOME=/home/cook'],
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

  // Drain stdout — buffer into complete lines and stream to UI
  stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    for (const line of lineBuffer.push(text)) {
      onLine(line)
    }
  })

  // Drain stderr — must be consumed to prevent deadlock (Go's stdcopy.StdCopy drains both)
  const stderrChunks: Buffer[] = []
  stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk)
  })

  // Handle both stream end (normal) and stream error (Docker disconnect, etc.)
  // Without the error handler, if the stream errors, 'end' never fires and the promise hangs forever.
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })

  // Flush any remaining partial line
  for (const line of lineBuffer.flush()) {
    onLine(line)
  }

  // Check exit code — Go checks inspect.ExitCode and returns error on non-zero
  const inspect = await exec.inspect()
  if (inspect.ExitCode !== 0) {
    const stderrText = Buffer.concat(stderrChunks).toString()
    const err = new Error(`Claude exited ${inspect.ExitCode}: ${stderrText}`) as Error & { stdout: string }
    err.stdout = output  // attach partial output for inspection
    throw err
  }

  return output
}
```

The `onLine` callback emits complete lines to the UI via `loopEvents.emit('line', line)`, ensuring `<Static>` items always have stable, complete content.

#### startSandbox() — Full Lifecycle

Putting it all together, the complete sandbox startup sequence:

```typescript
async function startSandbox(docker: Docker, projectRoot: string, config: CookConfig): Promise<Sandbox> {
  // 0. Verify Docker daemon is running (new Docker() succeeds even when daemon is down)
  try {
    await docker.ping()
  } catch {
    console.error('Error: Docker daemon is not running. Start Docker and try again.')
    process.exit(1)
  }

  // 1. Cleanup stale containers FIRST — frees resources before potentially building images.
  // Go does cleanup before image building (step 2 in Go's startSandbox).
  await cleanupStaleContainers(docker, projectRoot)

  // 2. Ensure base image exists
  await ensureBaseImage(docker)

  // 3. Check for project-specific Dockerfile, build if needed
  const projImage = getProjectImageTag(projectRoot)
  let imageName = BASE_IMAGE_NAME
  if (projImage) {
    const exists = await imageExists(docker, projImage.imageName)
    if (!exists) {
      await buildImage(docker, projImage.imageName, projImage.dockerfile, true)  // verbose
    }
    imageName = projImage.imageName
  }

  // 4. Determine user/group (renumbered from step 4 onward after reordering)
  const uid = process.getuid!().toString()
  const gid = process.getgid!().toString()
  const userSpec = `${uid}:${gid}`

  // 5. Build environment variables
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

  // 6. Create and start container
  // Note: Go sets env vars on container.Config.Env (container-level). We set them per-exec instead.
  // This is deliberate — it allows different execs (setup as root vs Claude as user) to have different
  // env vars. The GIT_*/passthrough env vars are only needed for the Claude exec, not for root setup commands.
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

  // Start the container — if start fails, remove the created container to avoid leaking it.
  // Go explicitly removes the container on ContainerStart() failure.
  try {
    await container.start()
  } catch (err) {
    await container.remove({ force: true }).catch(() => {})
    throw err
  }

  // 7. Create user/group inside container
  const setupCmd = `groupadd -g ${gid} -o cookgroup 2>/dev/null || true; useradd -m -s /bin/bash -u ${uid} -g ${gid} -o cook 2>/dev/null || true`
  await containerExec(container, 'root', ['bash', '-c', setupCmd])

  // 8. Copy auth files
  await copyAuthFiles(container, userSpec)

  // 9. Apply network restrictions if configured
  if (config.network.mode === 'restricted') {
    const script = generateIptablesScript(config.network.allowedHosts)
    await containerExec(container, 'root', ['sh', '-c', script])
    const allHosts = ['api.anthropic.com', ...config.network.allowedHosts]
    logOK(`Network restricted to: ${allHosts.join(', ')}`)
  }

  logOK(`Sandbox started (container: ${containerName})`)

  return new Sandbox(docker, container, userSpec, env, projectRoot)
}
```

### Colored Logging Helpers

Go has `logPhase` (blue double-line box), `logStep` (cyan arrow), `logOK` (green checkmark), `logWarn` (yellow), `logErr` (red X). These are used for non-TUI output: init/rebuild commands, startup summary, error reporting. Define matching helpers using ANSI escape codes:

```typescript
// src/log.ts (alongside session log functions)
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
// Go uses \033[0;34m which resets attributes before setting blue (the 0; prefix).
// Using just \x1b[34m would inherit any prior bold state, producing bold+blue instead of plain blue.
const BLUE = '\x1b[0;34m'

// Matches Go's logPhase: blue double-line box around the message
// Note: Go's logPhase renders as non-bold blue because \033[0;34m resets bold.
// We use BLUE (which includes the reset prefix) to match.
const logPhase = (msg: string) => {
  console.error(`\n${BLUE}══════════════════════════════════════${RESET}`)
  console.error(`${BLUE}  ${msg}${RESET}`)
  console.error(`${BLUE}══════════════════════════════════════${RESET}\n`)
}
const logStep  = (msg: string) => console.error(`${CYAN}▸ ${msg}${RESET}`)
const logOK    = (msg: string) => console.error(`${GREEN}✓ ${msg}${RESET}`)
const logWarn  = (msg: string) => console.error(`${YELLOW}⚠ ${msg}${RESET}`)
const logErr   = (msg: string) => console.error(`${RED}✗ ${msg}${RESET}`)
```

Use these in `cmdInit`, `cmdRebuild`, `runLoop` startup summary, and error paths to match Go's formatted output.

### Default Prompts

Ported verbatim from the Go version (`main.go` lines 49–57):

```typescript
const DEFAULT_REVIEW_PROMPT = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const DEFAULT_GATE_PROMPT = `Based on the review, respond with exactly DONE or ITERATE
on its own line, followed by a brief reason.

DONE if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`
```

These are used as defaults when the user doesn't provide `--review` or `--gate` arguments.

### Session Logging

Identical to Go — write to `.cook/logs/YYYY-MM-DD-HHMMSS.md` with `## [step iteration] timestamp` headers. The log directory is created with `{ recursive: true }` on every call (not just during `cook init`), ensuring it exists even if the user didn't run `cook init`:

```typescript
// Local time formatting — Go's time.Now().Format() uses local time, not UTC.
// Using toISOString() would produce UTC timestamps that mismatch the user's wall-clock time.
function localTimestamp(fmt: 'file' | 'log'): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return fmt === 'file' ? `${date}-${time}` : `${date} ${time.replace(/(..)(..)(..)/, '$1:$2:$3')}`
}

function createSessionLog(projectRoot: string): string {
  const logDir = path.join(projectRoot, '.cook', 'logs')
  fs.mkdirSync(logDir, { recursive: true })  // always ensure dir exists
  const ts = localTimestamp('file')
  // Format: 2026-03-01-172616 (local time, matching Go behavior)
  const logPath = path.join(logDir, `${ts}.md`)
  fs.writeFileSync(logPath, '')  // create file immediately
  return logPath
}

function appendToLog(logFile: string, step: string, iteration: number, output: string): void {
  const timestamp = localTimestamp('log')
  fs.appendFileSync(logFile, `## [${step} ${iteration}] ${timestamp}\n\n${output}\n\n---\n\n`)
}
```

### Gate Verdict Parsing

Same logic, same keywords:

```typescript
const DONE_KEYWORDS = ['DONE', 'PASS', 'COMPLETE', 'APPROVE', 'ACCEPT']
const ITERATE_KEYWORDS = ['ITERATE', 'REVISE', 'RETRY']

function parseGateVerdict(output: string): 'DONE' | 'ITERATE' {
  for (const line of output.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (DONE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'DONE'
    if (ITERATE_KEYWORDS.some(kw => upper.startsWith(kw))) return 'ITERATE'
  }
  return 'ITERATE'
}
```

### Agent Loop

Same structure as Go. Uses EventEmitter to communicate with the Ink UI (avoids the stale closure / scope issue from rev 1):

```typescript
async function agentLoop(
  sandbox: Sandbox,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter,
): Promise<void> {
  const logFile = createSessionLog(config.projectRoot)
  events.emit('logFile', logFile)

  let lastMessage = ''

  for (let i = 1; i <= config.maxIterations; i++) {
    const steps = [
      { name: 'work', prompt: config.workPrompt },
      { name: 'review', prompt: config.reviewPrompt },
      { name: 'gate', prompt: config.gatePrompt },
    ]

    for (const step of steps) {
      events.emit('step', { step: step.name, iteration: i })

      let output: string
      try {
        const prompt = renderTemplate(cookMD, {
          step: step.name,
          prompt: step.prompt,
          lastMessage,
          iteration: i,
          maxIterations: config.maxIterations,
          logFile,
        })

        output = await sandbox.runClaude(config.model, prompt, (line) => {
          events.emit('line', line)
        })
      } catch (err) {
        events.emit('error', `${step.name} step failed (iteration ${i}): ${err}`)
        return
      }

      lastMessage = output
      // Warn and continue on log write failure (matches Go behavior: logWarn, not fatal)
      try {
        appendToLog(logFile, step.name, i, output)
      } catch (err) {
        console.error(`Warning: failed to write session log: ${err}`)
      }
    }

    const verdict = parseGateVerdict(lastMessage)
    if (verdict === 'DONE') {
      logOK('Gate: DONE — loop complete')
      events.emit('done')
      return
    }
    if (i < config.maxIterations) {
      logWarn(`Gate: ITERATE — continuing to iteration ${i + 1}`)
    }
  }
  logWarn(`Gate: max iterations (${config.maxIterations}) reached — stopping`)
  events.emit('done')
}
```

### CLI Entry Point

Uses Node.js `process.argv` parsing (no framework needed — the CLI is simple):

```typescript
#!/usr/bin/env node
// cli.ts

function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    console.error('Error: not inside a git repository. Run cook from within a git repo.')
    process.exit(1)
  }
}

function usage(): void {
  // Format matches Go's usage output (main.go:75-93): bold intro, bold section headers, aligned examples
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
  -h, --help                      Show this help`)
  process.exit(1)
}

const args = process.argv.slice(2)
const command = args[0]

// Wrap dispatch in async main so that errors from async commands (cmdRebuild, runLoop)
// are caught cleanly instead of becoming unhandled promise rejections.
async function main() {
  switch (command) {
    case 'init':    cmdInit(findProjectRoot()); break
    case 'rebuild': await cmdRebuild(); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break  // no args → show usage (matches Go behavior)
    default:        await runLoop(args); break
  }
}
main().catch(err => { logErr(String(err)); process.exit(1) })
```

**`findProjectRoot()`** requires a git repo — exits with a clear error message if not in one (same as Go's `git rev-parse --show-toplevel`).

**`usage()`** is shown when no args are provided (matches Go behavior where running bare `cook` shows usage).

**Startup configuration summary:** Before starting the agent loop, print config to stderr (matches Go behavior):

```typescript
async function runLoop(args: string[]): Promise<void> {
  const projectRoot = findProjectRoot()
  const parsed = parseArgs(args)

  // Validate work prompt — Go checks `if *work == ""` and shows usage
  if (!parsed.workPrompt) {
    usage()
  }

  const config = loadConfig(projectRoot)

  // Print startup summary to stderr — multi-line format matching Go (main.go:154-157)
  console.error(`${BOLD}cook${RESET} — agent loop`)  // "cook" bold, matches Go main.go:154
  console.error(`  Model:      ${parsed.model}`)
  console.error(`  Iterations: ${parsed.maxIterations}`)
  console.error(`  Project:    ${projectRoot}`)

  const docker = new Docker()
  // IMPORTANT: assign to module-level `sandbox` (declared near signal handlers), NOT a local `const`.
  // The signal handlers and cleanup() reference the module-level variable — using `const` here
  // would shadow it, leaving the module-level `sandbox` as null, so cleanup never runs.
  try {
    sandbox = await startSandbox(docker, projectRoot, config)
  } catch (err) {
    // Go: logErr("Sandbox failed: %v", err); os.Exit(1)
    // Catches Docker connection failures, image build errors, etc. and exits cleanly
    // instead of dumping an unhandled rejection stack trace.
    logErr(`Sandbox failed: ${err}`)
    process.exit(1)
  }

  // Normal exit cleanup uses try/finally — Go uses `defer sandbox.stopSandbox()`.
  // Signal handlers (SIGINT/SIGTERM) also call cleanup for interrupt cases.
  try {
    const cookMD = loadCookMD(projectRoot)
    const { unmount, waitUntilExit } = render(<App />, { exitOnCtrlC: false })
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
```

**Full arg parsing** with flag extraction, positional→step mapping, and the numeric last-arg edge case:

```typescript
interface ParsedArgs {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  maxIterations: number
  model: string
}

function parseArgs(args: string[]): ParsedArgs {
  // Flags that take a value (vs boolean flags which don't)
  const VALUE_FLAGS = new Set(['--work', '--review', '--gate', '--model', '--max-iterations'])

  const flags: Record<string, string> = {}
  const positional: string[] = []

  // Extract --flag=value and --flag value pairs
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
        flags[flag] = 'true'  // boolean flag
      }
    } else {
      positional.push(args[i])
    }
    i++
  }

  // Numeric last-arg edge case: if last positional is a number and there's >1, it's maxIterations
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

  // Map positional args → step prompts (same as Go: args[0]=work, args[1]=review, args[2]=gate)
  // Flags take precedence over positional args
  const workPrompt = flags['--work'] ?? prompts[0] ?? ''
  const reviewPrompt = flags['--review'] ?? prompts[1] ?? DEFAULT_REVIEW_PROMPT
  const gatePrompt = flags['--gate'] ?? prompts[2] ?? DEFAULT_GATE_PROMPT
  const model = flags['--model'] ?? 'opus'

  return { workPrompt, reviewPrompt, gatePrompt, maxIterations, model }
}
```

Example: `cook "do the thing" 5` → `workPrompt="do the thing"`, `maxIterations=5`, review/gate use defaults.
Example: `cook --work "task" --review "check it" --model sonnet --max-iterations 2` → flags override everything.

### Default COOK.md Template

```
# COOK.md

## Project Instructions

[Edit this section with your project's conventions, coding standards, etc.]

## Agent Loop

Step: **${step}** | Iteration: ${iteration}/${maxIterations}

### Task
${prompt}

${lastMessage ? '### Previous Output\n' + lastMessage : ''}

### History
Session log: ${logFile}
Read the session log for full context from previous steps.
```

### init Command

Same as Go — creates COOK.md (with new JS template syntax), `.cook.config.json`, `.cook.Dockerfile`, `.cook/logs/`. Skips files that already exist.

**Default file contents:**

```typescript
const DEFAULT_COOK_CONFIG_JSON = `{
  "network": {
    "mode": "default",
    "allowedHosts": []
  },
  "env": []
}
`

// Note: uses FROM cook-sandbox, the base image built by cook
const DEFAULT_COOK_DOCKERFILE = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`
```

```typescript
function cmdInit(projectRoot: string): void {
  // Use logPhase to match Go's cmdInit which calls logPhase("Initialize project for cook")
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
      // Wrap in try/catch — Go logs errors and continues if a file write fails (e.g. permission denied)
      try {
        fs.writeFileSync(fullPath, file.content)
        logOK(`${file.path} created`)
      } catch (err) {
        logErr(`Failed to create ${file.path}: ${err}`)
      }
    }
  }

  // Always ensure logs directory
  fs.mkdirSync(path.join(projectRoot, '.cook', 'logs'), { recursive: true })

  logOK('Project initialized for cook')
  logStep(`Edit COOK.md to customize the agent loop prompts`)
  logStep(`Edit .cook.config.json to configure network restrictions and env vars`)
  logStep(`Edit .cook.Dockerfile to add project-specific dependencies`)
}
```

### Sandbox Class

The `Sandbox` class wraps the container and provides a clean interface for the agent loop:

```typescript
class Sandbox {
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

  // Note: exec() helper removed — it was dead code (never called by the agent loop or any command).
  // containerExecWithEnv is available as a standalone function if needed in the future.

  async stop(): Promise<void> {
    await this.container.remove({ force: true }).catch(() => {})
    logOK('Sandbox stopped')  // matches Go's sandbox.go:219
  }
}
```

### rebuild Command

Same as Go — removes and rebuilds the `cook-sandbox` base image. Creates its own Docker client (matches Go which creates a separate client for rebuild):

```typescript
async function cmdRebuild(): Promise<void> {
  logPhase('Rebuild sandbox image')
  const docker = new Docker()  // separate client (Go creates a new one for rebuild)
  logStep('Removing existing cook-sandbox image...')
  try {
    await docker.getImage(BASE_IMAGE_NAME).remove({ force: true })
  } catch {
    // image doesn't exist, that's fine
  }
  logStep('Building cook-sandbox image...')
  await buildImage(docker, BASE_IMAGE_NAME, BASE_DOCKERFILE, false)  // silent, matches Go behavior
  logOK('Sandbox image rebuilt')
}
```

### Signal Handling

**Important:** Ink intercepts SIGINT by default to cleanly unmount its React tree. This conflicts with our custom `process.on('SIGINT')` handler, causing a race condition (double cleanup, missed cleanup, or unclean exit). To avoid this, pass `exitOnCtrlC: false` when rendering the Ink app and handle cleanup entirely in the custom handler:

```typescript
// When rendering the Ink app:
const { waitUntilExit } = render(<App />, { exitOnCtrlC: false })
```

```typescript
let sandbox: Sandbox | null = null
let inkInstance: { unmount: () => void } | null = null

async function cleanup() {
  if (inkInstance) {
    inkInstance.unmount()
    inkInstance = null
  }
  if (sandbox) {
    await sandbox.stop()  // container.remove({ force: true })
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
```

**Note on cleanup guarantees:** Node.js signal handlers are asynchronous. The `await cleanup()` will attempt to complete before `process.exit()`, but if the Docker API hangs, the process could stall. A timeout (e.g., 5 seconds) could be added as a safety net, but for v1 the simple approach matches Go's behavior where cleanup is also best-effort. The stale container cleanup on next run provides a safety net for cases where cleanup fails.

### Distribution

**package.json:**
```json
{
  "name": "@rjcorwin/cook",
  "version": "1.0.0",
  "type": "module",
  "bin": { "cook": "./dist/cli.js" },
  "engines": { "node": ">=20" },
  "files": ["dist"],
  "dependencies": {
    "dockerode": "^4.0.9",
    "ink": "^6.8.0",
    "react": "^19.0.0",
    "tar-stream": "^3.1.7"
  },
  "devDependencies": {
    "@types/dockerode": "^4.0.1",
    "@types/tar-stream": "^3.1.3",
    "@types/react": "^19.0.0",
    "typescript": "^5.8.0",
    "tsup": "^8.0.0"
  }
}
```

**Build:** `tsup src/cli.ts --format esm --dts` compiles TypeScript to `dist/cli.js`. By default tsup bundles all dependencies, but bundling Ink (Yoga WASM), React, and dockerode (native optional deps) will produce broken output. Use a tsup config to externalize all node_modules:

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  // Do NOT bundle node_modules — Ink (Yoga WASM), React, and dockerode
  // have build-time issues when bundled. Rely on installed node_modules.
  // NOTE: `noExternal: []` does NOT externalize packages (it's the default).
  // Must use `packages: 'external'` to tell tsup to treat all dependencies
  // as external imports resolved from node_modules at runtime.
  packages: 'external',
})
```

This means `dist/cli.js` imports from `node_modules` at runtime (standard for Node CLI tools distributed via npm).

**Install:** `npm install -g @rjcorwin/cook` or `npx @rjcorwin/cook`.

**update install.sh:** Replace Go build with `npm install -g @rjcorwin/cook`. Or remove install.sh entirely in favor of npm.

## Constraints

- **Docker required** — the sandbox model is core to cook
- **Node.js >= 20** — required by Ink v6
- **ESM only** — Ink has been ESM-only since v5; v6 requires Node >= 20 and React >= 19
- **Git repo required for `init` and loop** — `findProjectRoot()` uses `git rev-parse --show-toplevel` and exits with an error if not in a git repo. **Intentional improvement over Go:** `cook rebuild` does NOT require a git repo (it only rebuilds the base Docker image). In Go, `findProjectRoot()` is called unconditionally at the top of `main()`, so even `cook rebuild` fails outside a git repo — this was an unintentional restriction.
- **Flags accepted at any position** — Go's `flag.Parse()` stops at the first non-flag argument (standard Go behavior), so `cook "prompt" --model sonnet` treats `--model` as a positional arg. The TypeScript parser extracts flags from any position in the arg list, so `cook "prompt" --model sonnet` works as expected. This is more flexible than Go and is an intentional improvement.
- **COOK.md migration** — existing Go template syntax breaks. Users update `{{.Step}}` → `${step}`, `{{if .LastMessage}}` → `${lastMessage ? ... : ''}`, etc. This is a one-time manual change.

## Implementation Approach

### Step 1: Project scaffolding

Create the TypeScript project structure:
- `package.json` with dependencies (ink, react, dockerode, tar-stream)
- `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "jsx": "react-jsx",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "outDir": "dist",
      "rootDir": "src",
      "declaration": true,
      "verbatimModuleSyntax": true
    },
    "include": ["src"]
  }
  ```
  Key settings: `"jsx": "react-jsx"` (not `"react"` — Ink uses the automatic JSX runtime), `"module": "NodeNext"` for ESM, `"verbatimModuleSyntax": true` (ESM best practice).
- `tsup.config.ts` (single entry, ESM output)
- Directory structure (`src/`, `src/ui/`)

### Step 2: Config and template modules

Port `config.go` → `src/config.ts` and `template.go` → `src/template.ts`:

- `loadConfig()` reads `.cook.config.json` with malformed JSON warning. Uses deep merge for the `network` object so that partial configs (e.g. `{"network": {"mode": "restricted"}}` without `allowedHosts`) inherit missing fields from the defaults — matching Go's `json.Unmarshal` behavior where missing struct fields keep their zero values:
  ```typescript
  function loadConfig(projectRoot: string): CookConfig {
    const configPath = path.join(projectRoot, '.cook.config.json')
    const defaults: CookConfig = { network: { mode: 'default', allowedHosts: [] }, env: [] }
    let raw: string
    try {
      raw = fs.readFileSync(configPath, 'utf8')
    } catch {
      return defaults  // no config file, use defaults
    }
    try {
      const parsed = JSON.parse(raw)
      return {
        network: { ...defaults.network, ...parsed.network },
        env: parsed.env ?? defaults.env,
      }
    } catch (err) {
      logWarn(`Malformed .cook.config.json: ${err}`)
      return defaults
    }
  }
  ```
- `loadCookMD()` reads COOK.md or returns default:
  ```typescript
  function loadCookMD(projectRoot: string): string {
    try {
      return fs.readFileSync(path.join(projectRoot, 'COOK.md'), 'utf8')
    } catch {
      return DEFAULT_COOK_MD
    }
  }
  ```
- `renderTemplate()` evaluates COOK.md as a template literal with try/catch error handling (reports syntax errors with helpful messages)
- Default COOK.md constant with JS template literal syntax
- Default review and gate prompt constants (ported verbatim from Go)

### Step 3: Session logging

Port log functions from `loop.go` → `src/log.ts`:
- `createSessionLog()` — creates `.cook/logs/timestamp.md`, ensures directory exists with `{ recursive: true }` on every call
- `appendToLog()` — appends step output with markdown headers

### Step 4: Docker sandbox

Port `sandbox.go` → `src/sandbox.ts` using dockerode. This is the largest module. Key details:

**Image management:**
- `BASE_DOCKERFILE` constant: `FROM node:22-slim`, installs `@anthropic-ai/claude-code`, `git`, `iptables`
- `ensureBaseImage()` — check/build `cook-sandbox` image (silent build output)
- `getProjectImageTag()` — SHA256 hash first 12 chars of `.cook.Dockerfile` content → `cook-project-{basename}:{hash12}`
- `buildImage()` — builds with verbose output for project images, silent for base image

**Container lifecycle:**
- `cleanupStaleContainers()` — filter on `cook.project` label + `/cook-` name prefix, force-remove
- Container named `cook-{pid}`, labeled `cook.project={projectRoot}`
- Bind-mount project root into container at same path
- `CAP_ADD: NET_ADMIN` only when network restriction is configured

**Container setup (after start):**
- `groupadd -g {gid} -o cookgroup` + `useradd -m -s /bin/bash -u {uid} -g {gid} -o cook` (with `2>/dev/null || true`)
- Copy `~/.claude.json` → `/home/cook/.claude.json` (skip silently if missing)
- Copy `~/.claude/.credentials.json` → `/home/cook/.claude/.credentials.json` (skip silently if missing)
- `chown -R {uid}:{gid} /home/cook`
- Apply iptables rules if network restricted (always includes `api.anthropic.com`)

**Environment variables:**
- Always set: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` (from `git config` with `"cook"`/`"cook@localhost"` fallbacks)
- Passthrough: each var in `config.env` looked up via `process.env`, silently skipped if not set

**Exec helpers:**
- `containerExecWithEnv()` — returns `{ stdout, stderr }` on success, throws on non-zero exit (with stdout attached to error for partial output inspection)
- `runClaude()` — streaming exec with `LineBuffer` that buffers chunks into complete lines before emitting to UI
- `copyFileToContainer()` — read file, create tar, `putArchive()`, skip silently on ENOENT

**Cleanup:**
- `stopSandbox()` — `container.remove({ force: true })`
- `rebuildBaseImage()` — remove + rebuild `cook-sandbox`

### Step 5: Gate verdict parsing

Port from `loop.go` → `src/loop.ts`:
- `parseGateVerdict()` with same keywords and logic

### Step 6: Ink TUI components

Build the UI layer:
- `src/ui/App.tsx` — root component with state, flexbox layout (content + status bar), EventEmitter subscription
- `src/ui/StatusBar.tsx` — step, iteration, model, elapsed time, and **log file path** (e.g., `.cook/logs/2026-03-01-172616.md`). The log path is shown to replace Go's `"Follow along: tail -f ..."` message — users can still `tail -f` the log from another terminal while watching the Ink TUI
- `src/ui/LogStream.tsx` — `<Static>` component for streaming Claude output (receives complete lines from LineBuffer)
- `src/line-buffer.ts` — `LineBuffer` class, shared by `sandbox.ts` (runClaude) and `ui/LogStream.tsx`. Lives in its own module to avoid circular dependency between UI and core layers

### Step 7: Agent loop

Port `agentLoop()` from `loop.go` → `src/loop.ts`:
- Same work→review→gate structure
- Calls `renderTemplate()`, `sandbox.runClaude()`, `appendToLog()`
- Emits events via EventEmitter (`step`, `line`, `done`, `error`) — no direct state mutation
- Parses gate verdict, breaks or continues

### Step 8: CLI entry point

Port `main.go` → `src/cli.ts`:
- `findProjectRoot()` — `git rev-parse --show-toplevel`, exits with error if not in a git repo
- Arg parsing (positional + flags), including the numeric-last-arg-as-maxIterations edge case
- `cook init` / `cook rebuild` / `cook help` commands
- Default command: start sandbox, render Ink app, run agent loop
- Signal handling for cleanup (async, with stale cleanup as safety net)

### Step 9: Build and test

- `tsup` build to produce `dist/cli.js`
- Manual test: `cook init`, edit COOK.md, `cook "create a hello world script" 2`
- Verify: sandbox starts, Claude output streams in real-time (line-buffered, no garbled partial lines), status bar updates, session log captures output, gate parsing works, cleanup on Ctrl+C
- Test project-specific Dockerfile: modify `.cook.Dockerfile`, verify automatic rebuild on next run
- Test error cases: bad COOK.md template syntax (should show helpful error), missing git repo, missing Docker

### Step 10: Package and publish

- Set `bin` field in package.json
- Add shebang (`#!/usr/bin/env node`) to cli.ts
- `npm publish` as `@rjcorwin/cook`
- Update README with npm install instructions
- Update or remove install.sh

### Step 11: Remove Go code

- Remove `cook/` directory (Go source + go.mod + go.sum)
- Update README to remove Go prerequisites
- The Go version lives in git history

## Architecture Notes for Future Features

The architecture supports the features listed in TODO.md without requiring structural changes:

- **Custom sub-commands (`COOK-{command}.md`)**: The template loading in `template.ts` can be extended to look for `COOK-{command}.md` files. The CLI dispatch in `cli.ts` would route unknown commands to this path.
- **Configurable gate keywords**: The `DONE_KEYWORDS` and `ITERATE_KEYWORDS` arrays can be made configurable via `.cook.config.json`.
- **Unique sandbox IDs / parallel instances**: Already partially addressed — containers are named `cook-{pid}`, so multiple cook processes can run concurrently. The main gap is log file naming (currently timestamp-based, which could collide at 1-second granularity).
- **Verbose mode**: A `--verbose` flag can be threaded through to control build output, exec output, and debug logging.

## Migration Guide

### Breaking Change: stdout/stderr

The Go version writes all status/logging to stderr and Claude output to stdout, so `cook "prompt" > output.txt` captures raw Claude text. The Ink version renders everything (TUI, status bar, Claude output) to stdout. Users who pipe or redirect stdout will get Ink escape codes instead of raw text. A `cook --raw` flag for pipe-friendly output is planned as future work.

### COOK.md Template Syntax

Users with existing COOK.md files need to update template syntax:

| Go syntax | JS syntax |
|---|---|
| `{{.Step}}` | `${step}` |
| `{{.Prompt}}` | `${prompt}` |
| `{{.LastMessage}}` | `${lastMessage}` |
| `{{.Iteration}}` | `${iteration}` |
| `{{.MaxIterations}}` | `${maxIterations}` |
| `{{.LogFile}}` | `${logFile}` |
| `{{if .LastMessage}}...{{end}}` | `${lastMessage ? '...' + lastMessage : ''}` (use quotes, not backticks, inside expressions) |

**Quick migration one-liner:**
```bash
sed -i \
  -e 's/{{\.Step}}/${step}/g' \
  -e 's/{{\.Prompt}}/${prompt}/g' \
  -e 's/{{\.LastMessage}}/${lastMessage}/g' \
  -e 's/{{\.Iteration}}/${iteration}/g' \
  -e 's/{{\.MaxIterations}}/${maxIterations}/g' \
  -e 's/{{\.LogFile}}/${logFile}/g' \
  COOK.md
```

Note: `{{if .LastMessage}}...{{end}}` blocks must be manually converted to `${lastMessage ? '...' : ''}` ternary expressions — the sed one-liner doesn't handle these.

## Alternatives Considered

### Keep Go, add TUI with bubbletea/lipgloss

**Rejected.** The Go TUI ecosystem (bubbletea/lipgloss) is excellent, but the template syntax change to JS template literals is a core goal. Keeping Go for the runtime while switching to JS template syntax creates a mismatch — users would need to know Go templates for extending cook but JS for COOK.md. Going all-TypeScript is more coherent.

### Use blessed-contrib or terminal-kit instead of Ink

**Rejected.** Ink is the de facto standard for rich Node.js CLIs (used by Cloudflare Wrangler, Gatsby, Prisma). Its React component model is well-understood, and `<Static>` solves the streaming output problem elegantly. blessed-contrib is unmaintained.

### Use commander.js or yargs for CLI parsing

**Rejected for now.** cook's CLI is simple enough that manual `process.argv` parsing works. Adding a framework adds a dependency for minimal gain. Can revisit if the CLI grows more complex.

### Use Bun instead of Node.js

**Rejected.** Ink requires Node.js (Yoga WASM + React rendering). Bun compatibility is unverified and not worth the risk for a v1 rewrite.

### Handlebars or Mustache instead of template literals

**Rejected.** Template literals are built into JavaScript — no dependency, no learning curve, more expressive (JS expressions, not just interpolation). The whole point of the rewrite is to use a more familiar template system.
