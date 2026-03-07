# Research: Simplify Native Runner — Drop Docker Requirement, Trust Agent Sandboxes

**Requester:** rjcorwin
**Date:** 2026-03-07

## Requirements

### Original Request
Cook currently requires Docker for all runs — every agent invocation happens inside a Docker container. This is heavyweight and unnecessary for agents that have their own OS-level sandboxes (Claude's Seatbelt/Landlock, Codex's workspace sandbox). We want to add native (non-Docker) execution as the default, but without the complexity of managing agent configs. Cook should just spawn the agent and let the user manage their own agent sandbox settings.

### Context
The current codebase (`main`) has a single execution path: `Sandbox` class in `sandbox.ts` which runs everything in Docker. The `loop.ts` module calls `sandbox.runAgent()` and `cli.ts` creates the sandbox via `startSandbox()`.

A prior plan (`n5x-native-sandbox-mode`) explored this space but introduced significant complexity:
- `CLAUDE_CONFIG_DIR` temp directory isolation with copied credentials and custom `settings.json`
- `.cook/agents/` directory with per-agent config files (`claude.json`, `codex.toml`, `opencode.json`)
- A custom TOML parser (`toml.ts`, 94 lines) just to read codex config
- Per-agent permission/flag resolution logic
- `DEFAULT_CLAUDE_PERMISSIONS` constants duplicated across files

**This plan takes a simpler approach**: cook orchestrates the loop, agents sandbox themselves. No agent config management by cook.

### Open Questions
- Should `NativeRunner` pass any sandbox/permission flags? **No.** Just the minimum for cook's workflow: model selection, print/pipe mode, stdin prompt. Users configure their own agent sandbox settings.
- What about `--dangerously-skip-permissions` for Claude? **Only in `sandbox: "none"` mode** (BareRunner), where the user explicitly opts out of all isolation.
- Should OpenCode be blocked from native mode? **Yes.** OpenCode has no OS-level sandbox — its permissions are advisory, not enforced. Using it natively creates a false sense of security.
- What happens to `cook init`? **Simplified.** Generates `.cook/config.json`, `.cook/Dockerfile`, `.cook/.gitignore`, and `COOK.md`. No `.cook/agents/` directory.
- Should `cook doctor` check for agent CLIs in native mode? **Yes.** It needs to verify the agent binary is available when not using Docker.

## System Architecture

### Related Components

**Current flow (Docker-only):**
```
cli.ts → startSandbox() → Sandbox.runAgent() → Docker exec
loop.ts → sandbox.runAgent()
config.ts → CookConfig (network, env, animation, agent, steps)
```

**Proposed flow (runner abstraction):**
```
cli.ts → RunnerPool.get(mode) → runner.runAgent() → native spawn / Docker exec
loop.ts → pool.get(mode).runAgent()

Runner types:
  NativeRunner — spawns agent directly, no sandbox flags, no config isolation
  DockerSandbox — existing Docker path, renamed from Sandbox
  BareRunner — spawns agent with full-bypass flags (--dangerously-skip-permissions etc.)
```

### Data Flow

1. CLI parses `--sandbox` flag (default: `"agent"`) and creates `RunnerPool` with factory
2. `loop.ts` calls `pool.get(sandboxMode)` to get a runner for each step
3. Runner spawns the agent with appropriate args:
   - **NativeRunner**: `claude --model <model> -p` (stdin prompt), `codex exec --model <model> -` (stdin prompt)
   - **DockerSandbox**: existing Docker exec path unchanged
   - **BareRunner**: `claude --dangerously-skip-permissions --model <model> -p`, `codex exec --dangerously-bypass-approvals-and-sandbox --model <model> -`
4. Agent uses its own sandbox config (user's `~/.claude/settings.json`, `~/.codex/config.toml`, etc.)

### Constraints
- Must not break Docker mode — it stays as `--sandbox docker`
- Docker dependency (`dockerode`) becomes optional at runtime (only imported when Docker mode is used)
- `config.ts` needs a `sandbox` field but network/docker config should be separated
- Per-step sandbox overrides are desirable (e.g., work in Docker, review natively)
- The `Sandbox` interface in `loop.ts` must be generalized to an `AgentRunner` interface

## Prior Art

### n5x-native-sandbox-mode (PR #4)
Full implementation with agent config management. Good ideas to keep:
- Runner interface + pool pattern
- `--sandbox` CLI flag with agent/docker/none modes
- `agent-utils.ts` shared utilities (spawnAgent, gracefulShutdown, buildEnv)
- Mode-aware `cook doctor`
- Per-step sandbox overrides
- OpenCode rejection in agent mode

Ideas to **drop**:
- `CLAUDE_CONFIG_DIR` temp directory isolation
- `.cook/agents/` config files
- `toml.ts` parser
- `DEFAULT_CLAUDE_PERMISSIONS` and per-agent permission constants
- Codex flag resolution from `.cook/agents/codex.toml`

### Current main branch
Docker-only. `Sandbox` class with `runAgent()` and `stop()`. Config in `.cook.config.json` with network settings baked into `CookConfig`.
