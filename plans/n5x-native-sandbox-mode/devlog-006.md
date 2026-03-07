# Devlog: Review 2 fixes (2 HIGHs, 4 MEDIUMs)

**Date:** 2026-03-07
**Implementing:** Fixes from session 2, review 2

## What Was Done

Resolved all 6 issues surfaced by review 2 (gate 2):

### HIGH

- **H1: TOML parser correctness** — Rewrote `src/toml.ts` from `parseTomlStrings` (top-level strings only) to `parseTOML` (handles `[table]` sections, booleans, integers, floats). The plan called for `smol-toml` as an external dependency, but npm registry was unreachable. The improved parser now correctly handles codex.toml's `[sandbox_workspace_write]` section and `network_access = false` boolean. Updated `native-runner.ts` to use `parseTOML` with explicit type checks on extracted values.

- **H2: OpenCode ARG_MAX in BareRunner** — `bare-runner.ts:44` was passing the full prompt as a CLI argument to `opencode`. Large multi-iteration prompts can exceed Linux's ~2MB ARG_MAX. Fixed by writing the prompt to a temp file and spawning via `sh -c 'exec opencode run -m "$1" "$(cat "$2")"'` with model and temp file path as positional shell parameters. Temp files tracked and cleaned up in `cleanup()`.

### MEDIUM

- **M1: Misleading SIGINT errors** — When Ctrl-C kills a running agent, `spawnAgent` rejects with "claude exited 143: ..." which propagated to `main().catch()` as a confusing error message. Added `shuttingDown` flag set by SIGINT/SIGTERM handlers; `main().catch()` now suppresses error output when shutting down intentionally.

- **M2: toml.ts status** — No longer dead code since H1 improved it rather than replacing with `smol-toml`. The improved parser is actively used by `resolveCodexFlags`.

- **M3: Exit handlers use SIGKILL** — `process.on('exit')` handlers in `NativeRunner` and `BareRunner` now send SIGKILL instead of SIGTERM. The `exit` event is synchronous — async operations (like the SIGTERM timeout in `cleanup()`) can't run, so SIGTERM would leave processes orphaned if they don't respond immediately. SIGKILL is the correct choice for this last-resort path.

- **M4: Doctor validates agent+sandbox combos** — `cmdDoctor` now checks for OpenCode + `sandbox: "agent"` combinations across all steps, reporting them as errors. Uses the same logic as `validateAgentSandboxCombos` but non-fatal (sets `allGood = false` instead of `process.exit(1)`).

## Tricky Parts

- **H1 deviation from plan:** `smol-toml` couldn't be installed due to network being unreachable. Rather than blocking on this, improved the custom parser to handle the specific cases the review flagged (table sections, booleans, integers). The parser is still not full TOML — it doesn't handle multiline strings, arrays, inline tables, or dotted keys — but it correctly handles everything in codex.toml.

- **H2 shell wrapper:** The temp file + `$(cat)` approach still has a theoretical ARG_MAX issue at the shell expansion level (when `sh` execs `opencode`), but it moves the limit from the Node/execve boundary to the shell expansion boundary. For prompts >2MB, this would still fail — but that requires OpenCode CLI to support stdin reading to truly fix.

## Decisions Made

- Kept `toml.ts` as improved custom parser instead of external dependency — matches the spirit of the plan's intent (correctness) if not the letter (specific library).
- Used shell wrapper with positional parameters for H2 to avoid shell injection while still using `$(cat)` for file content.

## Deviations from Plan

- Plan specified `smol-toml` dependency; implementation uses improved custom parser due to npm network unavailability.
