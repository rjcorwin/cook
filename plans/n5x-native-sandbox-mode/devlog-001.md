# Devlog: Native Agent Sandbox as Default

**Date:** 2026-03-06
**Implementing:** plan.md

## What Was Done

- **Created `src/runner.ts`** — `AgentRunner` interface and `SandboxMode` type (`'agent' | 'docker' | 'none'`)
- **Renamed `Sandbox` → `DockerSandbox`** in `src/sandbox.ts`, implemented `AgentRunner`, renamed `stop()` → `cleanup()`. Updated `startSandbox()` to accept `DockerConfig` and pre-resolved env passthrough instead of `CookConfig`, separating Docker-specific concerns from the main config.
- **Created `src/runner-pool.ts`** — `RunnerPool` with lazy creation, cache-by-mode, and `cleanupAll()`.
- **Updated `src/loop.ts`** — `agentLoop()` now accepts `AgentRunner` instead of `Sandbox`.
- **Created `src/native-runner.ts`** — `NativeRunner` implementing `AgentRunner`:
  - Claude: creates temp `CLAUDE_CONFIG_DIR` with copied credentials and cook's settings
  - Codex: reads `.cook/agents/codex.toml` (simple regex extraction for sandbox_mode/approval_policy) and passes as CLI flags
  - OpenCode: throws (blocked from agent mode by validation)
  - Process lifecycle: stores `ChildProcess` refs, registers `process.on('exit')` handler for orphan cleanup
- **Created `src/bare-runner.ts`** — `BareRunner` implementing `AgentRunner`. No config isolation — uses `--dangerously-skip-permissions` and equivalent flags. OpenCode gets prompt as CLI arg (not stdin).
- **Updated `src/config.ts`** — Added `sandbox` field (default: `'agent'`), removed `network` from `CookConfig`. Config loading tries `.cook/config.json` first, falls back to `.cook.config.json`.
- **Updated `src/cli.ts`** — Comprehensive rewrite:
  - Added `--sandbox` CLI flag
  - `RunnerPool` factory creates correct runner per mode
  - `cook init` generates `.cook/` directory with `config.json`, `docker.json`, `Dockerfile`, `.gitignore`, and `agents/` (claude.json, codex.toml, opencode.json)
  - `cook doctor` is mode-aware: checks Docker in docker mode, checks agent CLIs on host in agent/none mode, warns about missing `.cook/agents/`
  - `cook rebuild` rejects non-docker modes with a message
  - Banner shows sandbox mode
  - Help text includes `--sandbox`
  - OpenCode + agent mode validated early with clear error
  - `DockerConfig` loaded separately from `loadDockerConfig()` only when `sandbox: "docker"`

## Tricky Parts

- **Dropped `smol-toml` dependency.** The plan called for adding smol-toml for Codex TOML parsing. In practice, we only need two scalar values (`sandbox_mode`, `approval_policy`). Simple regex extraction is sufficient and avoids a new dependency. If more complex TOML parsing is needed later, it can be added.
- **`startSandbox()` signature change.** The original function took `CookConfig` directly. Since `CookConfig` no longer has `network`, the function now accepts `DockerConfig` and a pre-resolved `env: string[]` array. The env passthrough resolution was pulled into `resolveEnvPassthrough()` in cli.ts and shared by all runners.
- **Dockerfile path lookup.** Updated `getProjectImageTag()` in sandbox.ts to check `.cook/Dockerfile` first, then fall back to `.cook.Dockerfile` for backward compatibility.
- **OpenCode prompt passing in BareRunner.** OpenCode uses `opencode run -m MODEL "prompt"` — prompt is a positional CLI argument, not stdin. This could hit `ARG_MAX` for very large prompts, but mirrors the Docker-mode invocation pattern.

## Decisions Made

- **No `smol-toml` dependency** — regex suffices for 2 keys (see above).
- **Config loading backward compat** — both `.cook/config.json` (new) and `.cook.config.json` (legacy) are checked. Network config also falls back to legacy path.
- **Single `RunnerPool` per run** — The pool lazily creates runners and caches by mode. In practice only one mode is used per run (no per-step sandbox overrides wired yet), but the pool is ready for it.
- **`gitConfig` helper duplicated** — Both `native-runner.ts` and `bare-runner.ts` have their own `gitConfig()` function rather than extracting to a shared module. Keeping it local is simpler for now; can be extracted if a third consumer appears.

## Deviations from Plan

- **Skipped `smol-toml` dependency** — simple regex used instead.
- **Per-step sandbox overrides not wired yet** — The `StepAgentConfig` type does not yet have a `sandbox` field, and `agentLoop` passes a single runner. The `RunnerPool` infrastructure supports it (steps would call `pool.get(stepMode)`), but it needs the loop to resolve per-step modes. This can be added in a follow-up.
- **`DockerConfig` defined in sandbox.ts, not config.ts** — the plan put it in config.ts, but since it's only consumed by `DockerSandbox` and loaded by `loadDockerConfig()` in cli.ts, co-locating the type with its consumer is cleaner.

## Next Steps

- Wire per-step `sandbox` override in `StepAgentConfig` and `agentLoop`
- Add Codex `--skip-git-repo-check` flag to NativeRunner (currently only in Docker mode)
- Consider extracting `gitConfig()` and `buildEnv()` to a shared utility
- End-to-end test: run `cook --sandbox agent "hello"` against a real project
