# Plan: `cook shell` — Interactive Sandbox Shell (Revised)

**Status:** Draft
**Author:** AI
**Created:** 2026-03-27
**Revision:** 002 (incorporates plan-review-001, 002, 003)

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

  const { spawnSync } = await import('child_process')
  const result = spawnSync('docker', execArgs, { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }
  return result.status ?? 1
}
```

### `cmdShell` in `src/shell.ts`

```typescript
export async function cmdShell(args: string[]): Promise<void> {
  // 1. Parse --unrestricted flag from args
  // 2. Validate docker CLI is on PATH (clear error if not)
  // 3. Find project root, load config
  // 4. Guard: .cook/ directory must exist (suggest `cook init`)
  // 5. Guard: check for existing cook container (refuse if running)
  // 6. Start sandbox (verbose image build, network per config unless --unrestricted)
  // 7. Call sandbox.shell(remainingArgs)
  // 8. Cleanup container on exit
  // 9. Propagate exit code
}
```

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

**Docker CLI on PATH**: Before spawning `docker exec`, validate the `docker` binary exists. Use the existing `hasCommandOnPath('docker')` helper from cli.ts (may need to export it or move to a shared util). Error: `"docker CLI not found on PATH. Install Docker and try again."`

**`.cook/` directory exists**: Check for `.cook/config.json`. If missing, error with: `"Project not initialized for cook. Run 'cook init' first."`

**Container collision**: Before calling `startSandbox` (which runs `cleanupStaleContainers`), check if a cook container is already running for this project. If so, warn and refuse: `"A cook container is already running for this project. Stop it first or use 'docker exec' directly."` This prevents killing an in-progress agent loop.

Implementation: list containers with label `cook.project=<projectRoot>`, check if any are running.

### Network policy

Respect the project's `docker.json` network config by default. Add `--unrestricted` flag that overrides `dockerConfig.network.mode` to `'unrestricted'` for the shell session. This means:

- `cook shell` → network restrictions from docker.json apply (safe default)
- `cook shell --unrestricted` → no network restrictions (for installing packages, etc.)

### Image build verbosity

When `startSandbox` triggers a first-run base image build, it currently calls `buildImage` with `verbose: false`. For shell mode, we should build with `verbose: true` so users see progress during what could be a multi-minute build. This means either:
- Adding a `verbose` option to `startSandbox`
- Or having `cmdShell` call `ensureBaseImage` directly with verbose=true before calling `startSandbox`

Recommendation: Add an optional `verbose` parameter to `startSandbox` (defaults to false for backward compat).

### Signal handling

The global SIGINT handler in cli.ts calls `cleanupActiveExecutions()`. Shell mode should NOT register with that — the `spawn` with `stdio: 'inherit'` naturally forwards signals to the child process. Since `cmdShell` doesn't call `execute()` or use the executor, no active executions are registered. Ctrl-C goes to the shell, not to cook's cleanup handler. This works naturally with no special handling needed.

### Usage text update

Add to the usage block in cli.ts:

```
  cook shell                          Open interactive shell in sandbox
  cook shell <command>                Run command in sandbox
  cook shell --unrestricted           Shell with unrestricted networking
```

## Implementation Approach

### Step 1: Container collision check utility
- Add `hasRunningContainer(docker, projectRoot)` function to `src/sandbox.ts`
- Checks for running containers with `cook.project` label matching projectRoot

### Step 2: `Sandbox.shell()` method
- Add `shell(args: string[])` method to `Sandbox` class in `src/sandbox.ts`
- Spawns `docker exec` with `stdio: 'inherit'`, returns exit code
- All container details stay encapsulated

### Step 3: Verbose build option
- Add optional `verbose?: boolean` parameter to `startSandbox`
- Pass through to `ensureBaseImage` → `buildImage`

### Step 4: `src/shell.ts` module
- Implement `cmdShell` with all precondition checks
- Parse `--unrestricted` flag
- Validate docker CLI, .cook/ dir, no collision
- Start sandbox, call `sandbox.shell()`, cleanup, propagate exit code

### Step 5: Wire up in `src/cli.ts`
- Add `case 'shell'` to command switch
- Add shell to usage text
- Export `hasCommandOnPath` if needed (or move to shared util)

### Step 6: Manual testing
- `cook shell` → interactive bash in sandbox
- `cook shell ls -la` → runs command and exits
- `cook shell --unrestricted` → no network restrictions
- `cook shell` with no Docker CLI → clear error
- `cook shell` without `cook init` → clear error
- `cook shell` while agent loop running → clear refusal
- `echo "ls" | cook shell` → non-interactive, pipes work
- Exit code propagation (exit 42 in shell → cook exits 42)

## Alternatives Considered

### dockerode programmatic TTY attach
Could use dockerode's `exec` with `Tty: true` and pipe stdin/stdout/stderr manually. Rejected: requires manual raw mode management, SIGWINCH handling for terminal resize, and careful stream cleanup. `docker exec -it` handles all of this for free.

### Expose Sandbox internals instead of shell method
Could add public getters for containerId/userSpec/containerEnv and let the CLI construct the docker exec command. Rejected: breaks encapsulation, duplicates container knowledge across modules.

### Default to unrestricted networking
Could ignore docker.json network config for shell mode. Rejected: silently overriding security config is surprising. Better to respect it and offer `--unrestricted` opt-in.

### Reuse existing container if running
Could detect an already-running cook container and attach to it. Rejected for v1: shared state risks, and refusing is safer. Can revisit later.
