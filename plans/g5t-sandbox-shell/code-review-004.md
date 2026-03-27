# Code Review: `cook shell` Post-Fix (Correctness)

**Reviewer:** AI (Review 4 -- Post-Fix)
**Date:** 2026-03-27
**Reviewing:** src/shell.ts, src/util.ts, src/sandbox.ts, src/cli.ts

## Summary

All four medium issues raised across reviews 1-3 have been addressed correctly. `findProjectRoot` is deduplicated, `hasCookContainer` now checks the `/cook-` name prefix, `sandbox.stop()` is wrapped in its own try/catch inside the finally block, and `-i`/`-t` are passed as separate arguments. No regressions or new bugs were introduced by the fixes.

## Fixes Verified

- [x] **findProjectRoot moved to util.ts** -- A single `export function findProjectRoot()` exists in `src/util.ts` (line 70). Both `cli.ts` (line 13) and `shell.ts` (line 6) import it from `./util.js`. No duplicate definition remains anywhere in `src/`. The function is identical in behavior to the two previous copies (git rev-parse with cwd fallback). Correct.

- [x] **hasCookContainer name prefix filter** -- `hasCookContainer` (sandbox.ts line 149) now uses `containers.some(info => info.Names.some(name => name.startsWith('/cook-')))`, which matches the same filter used by `cleanupStaleContainers` (sandbox.ts line 131). The comment on line 148 ("Match cleanupStaleContainers: also require the /cook- name prefix") documents the intent. The `listContainers` call still omits `all: true`, meaning it only checks running containers (not stopped ones), which is the correct semantic for detecting an active session. Correct.

- [x] **sandbox.stop() try/catch** -- In `shell.ts` lines 128-132, the finally block now wraps `sandbox.stop()` in its own try/catch with an empty catch and a comment explaining why. This prevents a stop() failure (e.g., Docker daemon unreachable) from masking the original shell error. The outer try/finally still ensures stop() is always attempted. Correct.

- [x] **-i -t split** -- `sandbox.ts` line 372 now uses `execArgs.push('-i', '-t')` when `process.stdin.isTTY` is true, and line 374 pushes only `-i` otherwise. The combined `-it` single argument from the original code has been replaced. Correct.

## Remaining Issues

### High

(none)

### Medium

(none -- all four medium issues from prior reviews are resolved)

### Low

- [ ] **`cleanupStaleContainers` still force-removes running containers** (sandbox.ts line 133). `cleanupStaleContainers` uses `docker.listContainers({ all: true })` and calls `container.remove({ force: true })` on anything matching the label and name prefix, including running containers. The `hasCookContainer` guard in `cmdShell` prevents the common case, and the comment on lines 428-431 of `startSandbox` now documents this intentional behavior. However, non-shell callers of `startSandbox` (e.g., the main agent loop in `executor.js`) do not call `hasCookContainer` first, meaning a `cook "work"` invocation will force-kill a running `cook shell` container without warning. This is pre-existing behavior, not a regression.

- [ ] **`process.exit(1)` in `startSandbox` on Docker ping failure** (sandbox.ts line 425). This bypasses finally blocks in callers. Review 3 suggested throwing instead. Still present, still pre-existing.

- [ ] **`logOK('Sandbox stopped')` runs even on failed stop** (sandbox.ts line 416). `Sandbox.stop()` catches the `container.remove` error but unconditionally logs success on line 416. In the shell path this is now hidden by the outer try/catch in `shell.ts` line 130 (stop errors are swallowed), but in the agent loop path `stop()` is called directly and the misleading log message would appear. Pre-existing, not a regression.

- [ ] **Variable shadowing in env loop** (sandbox.ts line 380). `for (const env of this.env)` shadows the conceptual "env" namespace. Not a bug, just readability. Carried forward from review 2.

## Regression Check

No regressions found. The fixes are minimal and targeted:
- The `findProjectRoot` extraction only changed import paths; the function body is unchanged.
- The `hasCookContainer` change added a filter condition (strictly more selective), which cannot produce false positives where the old code would not have.
- The try/catch around `stop()` only adds error suppression; the happy path is unchanged.
- The `-i`/`-t` split is semantically equivalent to the Docker CLI's combined short-flag parsing.

## Recommendation

[x] Ready for human review
[ ] Needs revision
