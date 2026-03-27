# Research: `cook shell` — Interactive Sandbox Shell

**Requester:** rj
**Date:** 2026-03-27

## Requirements

### Original Request
Add a subcommand to cook that opens an interactive terminal session inside the Docker sandbox container — no agent loop, no prompt, just a shell. Especially useful when the project is configured for Docker sandbox mode, as a quick way to drop into the sandboxed environment for debugging, exploration, or interactive agent sessions.

### Context
Cook already has full Docker sandbox lifecycle management (`sandbox.ts`): building images, creating containers, setting up users, copying auth files, applying network restrictions, and mounting the project. But this infrastructure is only accessible through the agent loop execution path. There's no way to just "get in" to the sandbox interactively.

### Open Questions
- Should the command be `cook shell`, `cook sandbox`, or something else?
- Should network restrictions apply by default in shell mode, or should it be unrestricted?
- Should it launch `bash` by default, or allow specifying a command?
- Should it also support launching an agent TUI inside the container (e.g. `cook shell claude` to open claude's interactive TUI in the sandbox)?

## System Architecture

### Related Components

**`src/sandbox.ts`** — The core Docker sandbox module. Key functions:
- `startSandbox()` — Full container lifecycle: Docker ping, cleanup stale containers, build images, create container, start it, setup user, copy auth, apply network restrictions. Returns a `Sandbox` instance.
- `ensureBaseImage()` / `buildImage()` — Image management
- `containerExec()` — Non-interactive exec in container
- `copyAuthFiles()` — Copies Claude/Codex/OpenCode credentials into container
- `generateIptablesScript()` — Network restriction rules

**`src/cli.ts`** — Command routing via `switch(command)` on first arg. Current subcommands: `init`, `rebuild`, `doctor`. Everything else falls through to the AST parser/executor.

**`src/config.ts`** — Loads `.cook/config.json` with agent, sandbox, env, network settings.

**`src/runner.ts`** — `RunnerPool` manages `AgentRunner` instances. The `Sandbox` class implements `AgentRunner`.

### Data Flow

Current Docker sandbox flow:
1. CLI parses args → resolves config/agent plan
2. Executor needs a runner → RunnerPool lazily creates a `Sandbox`
3. `startSandbox()` → Docker container running `sleep infinity`
4. `Sandbox.runAgent()` → `containerExec()` with agent CLI command
5. Agent output streamed back via dockerode demux

For `cook shell`, the flow would be:
1. CLI detects `shell` subcommand
2. Start sandbox container (reuse `startSandbox` or similar)
3. Instead of running agent via exec, attach interactive TTY
4. User interacts directly with bash inside container
5. On exit, clean up container

### Constraints

**Interactive TTY**: The current `containerExec` function is non-interactive (no TTY, no stdin). An interactive shell requires:
- TTY allocation
- stdin forwarding
- Proper signal handling (Ctrl-C, window resize)
- Raw mode on the host terminal

**dockerode vs docker CLI**: Two approaches for interactive sessions:
1. **dockerode attach/exec with TTY** — Programmatic but complex (TTY resize events, raw mode management)
2. **`docker exec -it` via `child_process.spawn`** — Simple, battle-tested, inherits TTY naturally via `stdio: 'inherit'`

**Container naming**: Current containers use `cook-<hash>` naming. A shell container could conflict with a running agent container for the same project.

## Prior Art

- **`docker exec -it <container> bash`** — The standard way to get an interactive shell in a container
- **VS Code Dev Containers** — Opens a full IDE inside a container; similar concept of "get into the sandbox"
- **`devcontainer exec`** — CLI equivalent of the above
- **Terraform/Pulumi shell** — Some IaC tools offer `shell` subcommands to enter managed environments

## Design Considerations

### Approach: Spawn `docker exec -it`

The simplest and most robust approach is to:
1. Use existing `startSandbox` logic to ensure the container is running (or start a new one)
2. Shell out to `docker exec -it <container> bash` via `child_process.spawn` with `stdio: 'inherit'`
3. This naturally handles TTY, signals, window resize, etc.

This avoids reimplementing TTY management in Node.js/dockerode and gives users the exact same experience as running `docker exec -it` manually.

### Container Lifecycle

Options:
- **Ephemeral**: Start a new container, shell in, remove on exit. Clean but slow (image build + container start each time).
- **Persistent**: Reuse the project's container if already running, start one if not, leave it running on shell exit. Fast for repeated use.
- **Hybrid**: Start if needed, clean up on exit. Same as current `startSandbox` behavior.

Recommendation: **Hybrid** — mirrors current behavior. Start container, shell in, remove on exit (like the agent loop does).

### Command Variants

```sh
cook shell                    # Interactive bash in sandbox
cook shell <command>          # Run a specific command in sandbox
cook shell claude             # Launch claude TUI in sandbox (stretch goal)
```

### Network Policy

For an interactive shell, defaulting to unrestricted networking makes more sense — users may want to `apt install`, `npm install`, `curl`, etc. But should still respect config if explicitly set.
