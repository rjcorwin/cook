# Plan: `cook shell` — Interactive Sandbox Shell (Revised)

**Status:** Draft
**Author:** AI
**Created:** 2026-03-27
**Revision:** 003 (incorporates plan-review-004, 005, 006)

## Summary

Add a `cook shell` subcommand that starts the Docker sandbox container (reusing existing infrastructure) and attaches an interactive terminal session. Implemented as a separate `src/shell.ts` module with a `Sandbox.shell()` method to keep container details encapsulated.

## Motivation

Cook's Docker sandbox setup is substantial — image building, user creation, auth file copying, network restrictions, project mounting — but it's only accessible through the agent loop. Users working in Docker-configured environments have no way to just "get in" without manually reconstructing the container setup. `cook shell` makes the sandbox a first-class interactive tool.

## Goals
- `cook shell` opens an interactive bash session inside the project's Docker sandbox
- `cook shell <command...>` runs a specific command in the sandbox (interactive if TTY available)
- Reuses existing sandbox infrastructure (images, user setup, auth, network)
- Clean container lifecycle: start on entry, remove on exit
- Clear errors for missing Docker CLI, missing `.cook/` config, container collisions

## Non-Goals
- `cook shell claude` (launching agent TUI in sandbox) — future enhancement
- Persistent/long-lived shell containers
- Programmatic TTY management via dockerode (we spawn `docker exec` instead)

## Technical Design

### New module: `src/shell.ts`

Separate module to keep cli.ts focused on routing. Contains `cmdShell(args: string[])` which orchestrates the shell session. This follows the pattern of sandbox.ts being a separate domain module.

### `Sandbox.shell()` method

Add a `shell(args: string[])` method to the `Sandbox` class in `src/sandbox.ts`. This keeps container ID, user spec, and env encapsulated — the CLI layer never sees them.

```typescript
import { spawn } from 'child_process'

// Added to Sandbox class
async shell(args: string[]): Promise<number> {
  const execArgs = ['exec']

  if (process.stdin.isTTY) {
    execArgs.push('-it')
  } else {
    execArgs.push('-i')
  }

  execArgs.push('-w', this.projectRoot)
  execArgs.push('-u', this.userSpec)

  for (const env of this.env) {
    execArgs.push('-e', env)
  }
  execArgs.push('-e', 'HOME=/home/cook')
  execArgs.push(this.container.id)

  if (args.length > 0) {
    execArgs.push(...args)
  } else {
    execArgs.push('bash')
  }

  const child = spawn('docker', execArgs, { stdio: 'inherit' })

  return new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}
```

Note: Uses async `spawn` + promise, NOT `spawnSync`. `spawnSync` would block the Node.js event loop for the entire shell session, preventing cleanup handlers and signal forwarding from working.

### `cmdShell` in `src/shell.ts`

```typescript
export async function cmdShell(args: string[]): Promise<void> {
  // 1. Parse own flags (--unrestricted, --help) BEFORE any Docker work
  //    Remaining args after flag extraction are the command to run in the shell.
  // 2. If --help, print shell-specific help and exit (no Docker needed)
  // 3. Validate docker CLI is on PATH (clear error if not)
  // 4. Find project root, load config
  // 5. Guard: .cook/ directory must exist (suggest `cook init`)
  // 6. Guard: check for existing cook container (refuse if running)
  // 7. Start sandbox with verbose=true, agents=[config.agent],
  //    network per docker.json unless --unrestricted
  // 8. Print network notice if restricted:
  //    "Network restricted per .cook/docker.json. Use --unrestricted for full access."
  // 9. Call sandbox.shell(remainingArgs)
  // 10. Cleanup container on exit
  // 11. Propagate exit code
}
```

### Flag parsing

`cmdShell` handles its own flags before touching Docker:
- `--unrestricted` — override network to unrestricted
- `--help` / `-h` — print shell-specific usage and exit immediately

Everything else is passed through as the shell command. Parsing order: extract known flags first, remainder becomes the command args. Example:
- `cook shell --unrestricted ls -la` → flags: `{unrestricted: true}`, command: `['ls', '-la']`
- `cook shell --help` → print help, exit (no container started)
- `cook shell bash -c "echo hi"` → flags: `{}`, command: `['bash', '-c', 'echo hi']`

### CLI routing in `src/cli.ts`

Add `shell` case to the command switch:

```typescript
case 'shell': {
  const { cmdShell } = await import('./shell.js')
  await cmdShell(args.slice(1))
  break
}
```

### Precondition checks

**Docker CLI on PATH**: Before spawning `docker exec`, validate the `docker` binary exists. Use the existing `hasCommandOnPath('docker')` helper from cli.ts (export it, or move to a shared util). Error: `"docker CLI not found on PATH. Install Docker and try again."`

**`.cook/` directory exists**: Check for `.cook/config.json`. If missing, error with: `"Project not initialized for cook. Run 'cook init' first."`

**Container collision**: Before calling `startSandbox` (which runs `cleanupStaleContainers`), check if a cook container is already running for this project. If so, warn and refuse: `"A cook container is already running for this project. Stop it first or use 'docker exec' directly."` This prevents killing an in-progress agent loop.

Implementation: use dockerode `docker.listContainers({ filters: { label: ['cook.project=<projectRoot>'], status: ['running'] } })` to check for running containers only.

### Agents parameter

`startSandbox` requires an `agents: AgentName[]` parameter used for:
1. Credential warnings (which auth files to check/warn about)
2. Network allow-list generation (which API hosts to whitelist in iptables)

For shell mode, pass `[config.agent]` — the project's default agent. This ensures:
- Credential warnings are relevant to the configured agent
- Network rules allow the configured agent's API endpoints (so users can run the agent manually in the shell if they want)
- If `--unrestricted`, the agents list is irrelevant since iptables rules aren't applied

### Network policy

Respect the project's `docker.json` network config by default. Add `--unrestricted` flag that overrides `dockerConfig.network.mode` to `'unrestricted'` for the shell session.

- `cook shell` → network restrictions from docker.json apply (safe default)
- `cook shell --unrestricted` → no network restrictions (for installing packages, etc.)

**Discoverability**: When network is restricted, print on shell entry:
```
Network restricted per .cook/docker.json. Use --unrestricted for full access.
```
This prevents the "mysterious hang when apt-get fails" problem. Users immediately know why and how to fix it.

### Image build verbosity

Add an optional `verbose?: boolean` parameter to both `startSandbox` and `ensureBaseImage` (defaults to false for backward compat). Shell mode passes `verbose: true` so users see Docker build progress during what could be a multi-minute first-run build. The verbose flag propagates: `startSandbox(verbose)` → `ensureBaseImage(docker, verbose)` → `buildImage(docker, name, dockerfile, verbose)`.

### Signal handling

The global SIGINT handler in cli.ts calls `cleanupActiveExecutions()`. Shell mode should NOT register with that — `spawn` with `stdio: 'inherit'` naturally forwards signals to the child process. Since `cmdShell` doesn't call `execute()` or use the executor, no active executions are registered. Ctrl-C goes to the shell, not to cook's cleanup handler. This works naturally with no special handling needed.

### Usage text update

Add to the usage block in cli.ts:

```
  cook shell                          Open interactive shell in sandbox
  cook shell <command>                Run command in sandbox
  cook shell --unrestricted           Shell with unrestricted networking
```

## Implementation Approach

### Step 1: Container collision check utility
- Add `hasCookContainer(docker, projectRoot)` function to `src/sandbox.ts`
- Uses `docker.listContainers({ filters: { label: [...], status: ['running'] } })` to check for running containers with `cook.project` label matching projectRoot
- Note: this is distinct from `cleanupStaleContainers` which removes ALL containers (running or stopped). The collision check only looks for running ones.

### Step 2: `Sandbox.shell()` method
- Add `shell(args: string[])` method to `Sandbox` class in `src/sandbox.ts`
- Uses async `spawn` + promise (NOT `spawnSync`)
- All container details stay encapsulated
- Uses top-level `import { spawn } from 'child_process'` (already available in the module via `execSync`)

### Step 3: Verbose build option
- Add optional `verbose?: boolean` parameter to `startSandbox` and `ensureBaseImage`
- Propagate through to `buildImage`
- Defaults to false for backward compat

### Step 4: Export `hasCommandOnPath`
- Export the existing `hasCommandOnPath` function from `src/cli.ts` so `shell.ts` can use it
- Or move it to a shared util if that's cleaner

### Step 5: `src/shell.ts` module
- Implement `cmdShell` with all precondition checks
- Parse `--unrestricted` and `--help` flags before any Docker work
- Validate docker CLI, .cook/ dir, no collision
- Start sandbox with `verbose: true`, `agents: [config.agent]`
- Print network restriction notice if applicable
- Call `sandbox.shell()`, cleanup, propagate exit code

### Step 6: Wire up in `src/cli.ts`
- Add `case 'shell'` to command switch
- Add shell to usage text

### Step 7: Manual testing
- `cook shell` → interactive bash in sandbox
- `cook shell ls -la` → runs command and exits
- `cook shell --unrestricted` → no network restrictions
- `cook shell --help` → prints help, no Docker work
- `cook shell` with no Docker CLI → clear error
- `cook shell` without `cook init` → clear error
- `cook shell` while agent loop running → clear refusal with message
- `echo "ls" | cook shell` → non-interactive, pipes work
- Exit code propagation (exit 42 in shell → cook exits 42)
- First-run image build shows progress output

## Alternatives Considered

### dockerode programmatic TTY attach
Could use dockerode's `exec` with `Tty: true` and pipe stdin/stdout/stderr manually. Rejected: requires manual raw mode management, SIGWINCH handling for terminal resize, and careful stream cleanup. `docker exec -it` handles all of this for free.

### Expose Sandbox internals instead of shell method
Could add public getters for containerId/userSpec/containerEnv and let the CLI construct the docker exec command. Rejected: breaks encapsulation, duplicates container knowledge across modules.

### Default to unrestricted networking
Could ignore docker.json network config for shell mode. Rejected: silently overriding security config is surprising. Better to respect it and offer `--unrestricted` opt-in, with a printed notice so users know why network calls fail.

### Reuse existing container if running
Could detect an already-running cook container and attach to it. Rejected for v1: shared state risks, and refusing is safer. Can revisit later.

### `spawnSync` for shell execution
Could use synchronous spawn for simplicity. Rejected: blocks the Node.js event loop for the entire shell session, preventing cleanup handlers from running. Async `spawn` + promise is correct.
