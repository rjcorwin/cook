# Plan: `cook shell` — Interactive Sandbox Shell

**Status:** Draft
**Author:** AI
**Created:** 2026-03-27

## Summary

Add a `cook shell` subcommand that starts the Docker sandbox container (reusing existing infrastructure) and attaches an interactive terminal session. This gives users a quick way to drop into the sandboxed environment for debugging, exploration, or running agent TUIs interactively.

## Motivation

Cook's Docker sandbox setup is substantial — image building, user creation, auth file copying, network restrictions, project mounting — but it's only accessible through the agent loop. Users working in Docker-configured environments have no way to just "get in" without manually reconstructing the container setup. `cook shell` makes the sandbox a first-class interactive tool.

## Goals
- `cook shell` opens an interactive bash session inside the project's Docker sandbox
- `cook shell <command...>` runs a specific command in the sandbox (interactive if TTY available)
- Reuses existing sandbox infrastructure (images, user setup, auth, network)
- Clean container lifecycle: start on entry, remove on exit
- Clear error if Docker is not available or not configured

## Non-Goals
- `cook shell claude` (launching agent TUI in sandbox) — future enhancement, not this PR
- Persistent/long-lived shell containers — keep it simple with ephemeral lifecycle
- Modifying the existing `Sandbox` class or `startSandbox` API

## Technical Design

### CLI Routing

Add `shell` to the command switch in `src/cli.ts`:

```typescript
case 'shell': await cmdShell(args.slice(1)); break
```

### `cmdShell` Implementation

New function in `src/cli.ts` (or a new `src/shell.ts` if it gets large, but it should be ~60-80 lines so inline is fine):

```typescript
async function cmdShell(args: string[]): Promise<void> {
  const projectRoot = findProjectRoot()
  const config = loadConfig(projectRoot)

  // Docker is required regardless of config.sandbox setting
  const Docker = (await import('dockerode')).default
  const docker = new Docker()

  try {
    await docker.ping()
  } catch {
    logErr('Docker daemon is not running. Start Docker and try again.')
    process.exit(1)
  }

  // Determine which agents might be used (for network rules + auth)
  const agents: AgentName[] = [config.agent]

  // Load docker config for network settings
  const dockerConfig = loadDockerConfig(projectRoot)

  logStep('Starting sandbox...')
  const sandbox = await startSandbox(docker, projectRoot, config.env, dockerConfig, agents)

  try {
    // Get container ID from sandbox
    const containerId = sandbox.containerId

    // Build docker exec command
    const execArgs = ['exec']

    // Allocate TTY only if stdin is a TTY
    if (process.stdin.isTTY) {
      execArgs.push('-it')
    } else {
      execArgs.push('-i')
    }

    // Set environment
    execArgs.push('-w', projectRoot)
    execArgs.push('-u', sandbox.userSpec)

    // Pass through env vars
    for (const env of sandbox.containerEnv) {
      execArgs.push('-e', env)
    }
    execArgs.push('-e', 'HOME=/home/cook')

    execArgs.push(containerId)

    // Command: user-specified or default to bash
    if (args.length > 0) {
      execArgs.push(...args)
    } else {
      execArgs.push('bash')
    }

    // Spawn docker exec with inherited stdio for full interactive support
    const { spawn } = await import('child_process')
    const child = spawn('docker', execArgs, {
      stdio: 'inherit',
    })

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0))
    })

    process.exitCode = exitCode
  } finally {
    await sandbox.stop()
  }
}
```

### Exposing Sandbox Internals

The `Sandbox` class currently encapsulates `container`, `userSpec`, and `containerEnv` as private fields. We need to expose just enough for the shell command to construct a `docker exec` invocation:

```typescript
// In Sandbox class, add public getters:
get containerId(): string { return this.container.id }
// userSpec and containerEnv are already constructor params — make them accessible
```

Minimal change: make `container`, `userSpec`, and `containerEnv` fields `readonly` instead of `private`, or add three getter properties.

### `loadDockerConfig` Export

The `loadDockerConfig` function (or equivalent) in `config.ts` needs to be accessible from the shell command. Check if it's already exported; if not, export it. The `startSandbox` function already takes a `DockerConfig` parameter, so the caller needs to be able to load it.

### Network Policy

For shell mode, default to **unrestricted** networking. The shell is for interactive exploration — users will likely want to install packages, curl endpoints, etc. This means either:
- Pass a `DockerConfig` with `network.mode: 'unrestricted'` to `startSandbox`
- Or add a flag `--restricted` to opt into network restrictions

Recommendation: Override to unrestricted by default, add `--restricted` flag.

### Error Handling

- No Docker daemon → clear error message + exit
- `docker` CLI not on PATH → clear error (needed for `docker exec` spawn)
- Container start fails → error from `startSandbox` propagates naturally
- Shell exits with non-zero → propagate exit code

## Implementation Approach

### Step 1: Expose Sandbox internals
- Add public getters to `Sandbox` class in `src/sandbox.ts` for `containerId`, `userSpec`, `containerEnv`
- Ensure `loadDockerConfig` (or its equivalent) is exported from `src/config.ts`

### Step 2: Add `cmdShell` to CLI
- Add the `shell` case to the command switch in `src/cli.ts`
- Implement `cmdShell` function as described above
- Handle the `--restricted` flag for opting into network restrictions

### Step 3: Update usage text
- Add `cook shell` to the usage/help output in `src/cli.ts`

### Step 4: Test manually
- `cook shell` → interactive bash in sandbox
- `cook shell ls -la` → runs command and exits
- `cook shell` with no Docker → clear error
- Exit code propagation

## Alternatives Considered

### dockerode programmatic TTY attach
Could use dockerode's `exec` with `Tty: true` and pipe stdin/stdout/stderr manually. Rejected because: requires manual raw mode management, SIGWINCH handling for terminal resize, and careful stream cleanup. `docker exec -it` handles all of this for free.

### Reuse existing container if running
Could detect an already-running cook container and attach to it. Rejected for v1: adds complexity around shared state, and the ephemeral model is simpler and matches the agent loop behavior. Can revisit if startup time becomes an issue.
