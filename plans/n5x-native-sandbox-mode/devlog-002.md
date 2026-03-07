# Devlog: Native Sandbox Mode — Iteration 2 Fixes

**Date:** 2026-03-06
**Implementing:** plan.md (fixes from code-review-001.md)

## What Was Done

Resolved all 5 HIGH and 9 MEDIUM issues from the first code review:

### HIGH fixes

- **H1-H2: Shell injection** — Replaced all `execSync(\`git config ${key}\`)` and `execSync(\`which ${cmd}\`)` calls with `spawnSync('git', ['config', key])` and `spawnSync('which', [cmd])`. Extracted shared `gitConfig()` and `whichSync()` into `src/agent-utils.ts`, eliminating code duplication across `native-runner.ts`, `bare-runner.ts`, `sandbox.ts`, and `cli.ts` (also fixes L1).

- **H3: OpenCode ARG_MAX** — Changed `BareRunner.agentCommand()` for OpenCode from passing the full prompt as a CLI argument (`opencode run -m model prompt`) to piping it via stdin (`opencode run -m model` with `pipeStdin: true`). All three agents now receive prompts via stdin consistently.

- **H4: DockerConfig.network.mode mismatch** — Changed type from `'restricted' | 'unrestricted'` to `'restricted' | 'bridge' | 'none'` to match plan. Updated all comparisons from `!== 'unrestricted'` to `=== 'restricted'`. Updated `loadDockerConfig()` to parse all three modes.

- **H5: TOML parsing** — Replaced fragile regex with a proper TOML string value parser (`src/toml.ts`) that handles double-quoted strings with escapes, single-quoted literal strings, bare values, inline comments, and table headers. Could not install `smol-toml` (no network access during this session) so wrote a minimal but correct parser for the 2 keys we need.

### MEDIUM fixes

- **M1: Listener leak** — Stored `process.on('exit')` handler references in both `NativeRunner` and `BareRunner`. `cleanup()` now calls `process.removeListener('exit', this.exitHandler)`.

- **M2: RunnerPool race condition** — Changed `RunnerPool` to cache `Promise<AgentRunner>` instead of `AgentRunner`. Concurrent `get()` calls for the same mode now share the same factory promise instead of invoking the factory twice.

- **M3: Per-step sandbox** — Added `sandbox?: SandboxMode` to `StepAgentConfig` in config.ts, `StepSelection` in cli.ts, and `LoopStepConfig` in loop.ts. `parseStepAgentConfig()` now parses the sandbox field.

- **M4: RunnerPool through agentLoop** — Changed `agentLoop()` signature to accept `RunnerPool` instead of `AgentRunner`. Each step resolves its sandbox mode (`stepConfig.sandbox ?? config.defaultSandbox`) and calls `pool.get(mode)` per step. Added `defaultSandbox` to `LoopConfig`.

- **M5: Cleanup waits for process exit** — `cleanup()` in both `NativeRunner` and `BareRunner` now sends SIGTERM, then waits for each process to emit 'close' with a 5-second timeout before falling back to SIGKILL. Only deletes temp config dir after all processes have exited.

- **M6: Silent credential failure** — `NativeRunner.setupClaudeConfigDir()` now calls `logWarn()` when `~/.claude/.credentials.json` is not found, instead of silently swallowing the error.

- **M7: Swallowed parse errors** — `resolveClaudeConfig()` now distinguishes ENOENT (file not found → use defaults) from JSON parse errors (throw with descriptive message). Same pattern for `resolveCodexFlags()`.

- **M8: Redundant env** — Extracted `buildEnv()` into `src/agent-utils.ts` as a shared function. Both `NativeRunner` and `BareRunner` use it via import. `buildEnv()` takes `envPassthrough` entries (already in `KEY=VALUE` format) and applies them after `process.env` spread + git config, which is correct since passthrough entries come from the config's env list, not from `process.env` re-reads.

- **M9: SIGINT hang risk** — Wrapped `await cleanup()` in try/finally in both SIGINT and SIGTERM handlers, ensuring `process.exit(1)` always runs even if cleanup throws.

### Additional fixes (LOW)

- **L2: hasFile wrapper** — Removed `hasFile()` wrapper around `fs.existsSync()`. All call sites use `fs.existsSync()` directly.
- **L1: Code duplication** — Created `src/agent-utils.ts` with shared `gitConfig()`, `whichSync()`, `buildEnv()`, and `spawnAgent()`. Eliminated duplicate implementations across runner files.
- All `execSync` usage in `cli.ts` replaced with `spawnSync` (including `findProjectRoot()`, `tryFindProjectRoot()`, `hostClaudeLoggedIn()`).
- `validateAgentSandboxCombos()` now validates per-step sandbox+agent combinations, not just the global sandbox mode.

## Tricky Parts

- **No network access** — Could not install `smol-toml` as planned. Wrote `src/toml.ts` with a minimal but correct TOML string value parser that handles the edge cases the review flagged (single quotes, escape sequences, inline comments). Only extracts top-level string values, which is all we need for `sandbox_mode` and `approval_policy`.

- **Process cleanup ordering** — The original `cleanup()` killed processes and immediately deleted temp dirs. Had to restructure to send SIGTERM → await close event (with SIGKILL timeout) → then delete temp dirs. This prevents the agent from losing its config mid-read.

- **RunnerPool Promise caching** — Changing from caching `AgentRunner` to caching `Promise<AgentRunner>` required updating `cleanupAll()` to `await` each promise (with try/catch for failed factory calls).

## Decisions Made

- **TOML parser vs dependency** — Wrote a local parser instead of using `smol-toml` due to no network access. The parser is ~50 lines, handles all TOML string value types the codex config uses, and avoids adding a dependency for extracting 2 keys. If `smol-toml` is preferred, it can be swapped in later by changing the import in `native-runner.ts`.

- **OpenCode stdin** — Changed OpenCode in BareRunner to pipe prompts via stdin instead of CLI args, matching the pattern of Claude and Codex. This avoids ARG_MAX limits and is consistent.

## Deviations from Plan

- **`smol-toml` → `src/toml.ts`** — Plan specified `smol-toml` as a dependency. Used a local parser instead due to no network access during the session. The local parser correctly handles the TOML subset we need.

## Next Steps

- Install `smol-toml` when network is available (optional — local parser works correctly)
- Version bump to 1.2.0 (L8 from review — breaking change in default behavior)
