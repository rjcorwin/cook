# Devlog: `cook shell` Implementation

**Date:** 2026-03-27
**Implementing:** plan-003.md

## What Was Done

- **Created `src/util.ts`**: Moved `hasCommandOnPath` and its helpers (`stripSurroundingQuotes`, `isRunnableFile`, `commandCandidates`) out of `cli.ts` into a shared utility module. This avoids the dependency-direction concern of importing from the CLI entry point.

- **Updated `src/sandbox.ts`**:
  - Added `spawn` to the existing `child_process` import (alongside `execSync`)
  - Added `hasCookContainer(docker, projectRoot)` — checks for running containers with the `cook.project` label via `docker.listContainers` with label filter (does not use `all: true`, so only running containers are returned)
  - Added `shell(args: string[])` async method to `Sandbox` class — spawns `docker exec` with `stdio: 'inherit'`, returns exit code via promise. Maps null exit codes to `128 + signal` when possible, falls back to 1.
  - Added optional `verbose?: boolean` parameter to `ensureBaseImage` and `startSandbox`, propagated to `buildImage`
  - Added comment on `cleanupStaleContainers` call explaining that removing stopped containers after the collision check is intentional (prevents name collisions)
  - Added comment on `shell()` explaining the host-path-equals-container-path assumption for `docker exec -w`

- **Created `src/shell.ts`**:
  - `cmdShell(args: string[])` orchestrates the full shell flow
  - Parses `--unrestricted`, `--help`/`-h` flags, and supports `--` separator (args after `--` are always passthrough)
  - Precondition checks: docker CLI on PATH, `.cook/config.json` exists, no running cook container
  - Starts sandbox with `verbose: true` and `agents: [config.agent]`
  - Prints network restriction notice when restricted
  - Cleanup via `sandbox.stop()` in `finally` block
  - Propagates exit code via `process.exitCode`

- **Updated `src/cli.ts`**:
  - Added `case 'shell'` with dynamic import of `shell.ts`
  - Added shell lines to usage text
  - Replaced local `hasCommandOnPath` and helpers with import from `src/util.ts`

## Tricky Parts

- **`--` separator**: Without it, `cook shell env --unrestricted` would consume `--unrestricted` as a cook flag instead of passing it to the container. The flag parser stops consuming flags after `--`, following Unix convention.

- **Signal-to-exit-code mapping**: The `close` event can have a null exit code when the process is killed by a signal. Mapping to `128 + signal_number` required a lookup table since Node.js provides signal names as strings, not numbers.

- **`hasCommandOnPath` relocation**: Moving to `src/util.ts` rather than exporting from `cli.ts` was important because `cli.ts` has top-level side effects (SIGINT/SIGTERM handlers, `process.argv` parsing) that would execute on import.

## Decisions Made

- Used `process.exitCode` instead of `process.exit()` to propagate the shell exit code, allowing the `finally` cleanup block and Node.js event loop to complete gracefully.
- The `--` separator is consumed and not forwarded — standard Unix behavior.
- `hasCookContainer` does not pass `status: ['running']` filter since `listContainers` without `all: true` already defaults to running-only. This is cleaner than the redundant filter mentioned in the plan.

## Deviations from Plan

- Created `src/util.ts` as the shared utility module rather than exporting `hasCommandOnPath` from `cli.ts`. The plan left this as "export or move to shared util" — moved it per reviewer recommendations.
- Added the signal-to-exit-code lookup table (`signalCodes`) rather than the plan's simpler `code ?? 1`, per reviewer note about mapping null exit codes to `128 + signal`.

## Next Steps

- Manual testing per plan section: interactive shell, command execution, `--unrestricted`, `--help`, error cases, exit code propagation, piped input

## Post-Review Fixes

Addressed four medium-severity issues identified across code-review-001, code-review-002, and code-review-003:

1. **Moved `findProjectRoot()` to `util.ts`** (reviews 1, 2, 3): Eliminated the duplicate definitions in `shell.ts` and `cli.ts`. Both now import from `util.ts`. The `execSync` import was kept in `cli.ts` since `hostClaudeLoggedIn()` still needs it.

2. **Added `/cook-` name prefix filter to `hasCookContainer`** (review 2): `cleanupStaleContainers` checks both the label and `name.startsWith('/cook-')`. `hasCookContainer` now does the same via `containers.some(info => info.Names.some(name => name.startsWith('/cook-')))` for consistency.

3. **Wrapped `sandbox.stop()` in try/catch in `shell.ts`** (review 3): The `finally` block now catches and ignores errors from `stop()` so they cannot mask the original shell error.

4. **Split `-it` into `-i`, `-t` as separate args in `Sandbox.shell()`** (review 1): Changed `execArgs.push('-it')` to `execArgs.push('-i', '-t')` for explicit programmatic usage.
