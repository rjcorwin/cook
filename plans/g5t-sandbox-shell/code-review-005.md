# Code Review: `cook shell` Post-Fix (Architecture)

**Reviewer:** AI (Review 5 -- Post-Fix)
**Date:** 2026-03-27
**Reviewing:** src/shell.ts, src/util.ts, src/sandbox.ts, src/cli.ts, src/runner.ts

## Summary

The architecture is clean after the fixes. The `findProjectRoot` duplication flagged in Review 2 has been resolved -- it now lives exclusively in `util.ts` and both `cli.ts` and `shell.ts` import it from there. The `util.ts` module is focused and contains only the two shared helpers (`hasCommandOnPath` and `findProjectRoot`) plus their private support functions. No dead code remains in `cli.ts` beyond an intentional breadcrumb comment. Imports are tight across all files. The module structure (shell.ts for orchestration, sandbox.ts for container encapsulation, util.ts for shared helpers, cli.ts for routing) is sound and each module has a clear single responsibility.

## Fixes Verified
- [x] `findProjectRoot` extraction clean -- single definition in `util.ts:70-76`, imported by both `cli.ts:13` and `shell.ts:6`, no duplicate definition anywhere
- [x] No dead code or duplication -- `hasCommandOnPath` and all its helpers (`stripSurroundingQuotes`, `isRunnableFile`, `commandCandidates`) exist only in `util.ts`
- [x] `hasCookContainer` now includes the `/cook-` name prefix filter (sandbox.ts:149), matching `cleanupStaleContainers` -- addresses the asymmetry flagged in Review 2

## Remaining Issues

### High
- (none)

### Medium
- [ ] **`startSandbox` calls `process.exit(1)` on Docker ping failure** (sandbox.ts:425). This hard exit bypasses the graceful `process.exitCode` pattern used in `shell.ts` and `cmdDoctor`. If `cmdShell` calls `startSandbox` and the daemon is down, the `finally` block (shell.ts:127-132) that calls `sandbox.stop()` never runs. In this specific case that is harmless (no container was created), but the pattern inconsistency means any future caller of `startSandbox` cannot catch and handle the error. Consider having `startSandbox` throw instead, and letting `cmdShell`/`execute` handle the exit. This was noted in Review 2's "Questions" section and has not been addressed yet.

### Low
- [ ] **Breadcrumb comment in cli.ts:235 is fine but could be removed.** The line `// hasCommandOnPath and helpers have been moved to src/util.ts` is a helpful note during transition but adds no value long-term -- the import on line 13 makes the location self-evident. Minor cleanup when convenient.
- [ ] **Loop variable `env` shadows class field in `Sandbox.shell()`** (sandbox.ts:380). `for (const env of this.env)` works correctly but reduces readability. Renaming to `envEntry` or `envVar` would be a trivial improvement. Flagged in Review 2, not yet addressed.
- [ ] **`util.ts` imports `execSync` for a single call in `findProjectRoot`.** This is fine and proportionate. Just noting that if `findProjectRoot` ever grows more complex (monorepo detection, `.cook/` fallback), it may warrant its own module. No action needed now.

## Module Structure Assessment

| Module | Responsibility | Clean? |
|---|---|---|
| `util.ts` | Shared pure helpers (PATH check, project root) | Yes -- 76 lines, two exports, no side effects |
| `shell.ts` | `cook shell` command orchestration | Yes -- 134 lines, single export, clear linear flow |
| `sandbox.ts` | Docker container lifecycle + agent execution | Yes -- `Sandbox` class encapsulates all container state; `shell()` method fits naturally |
| `cli.ts` | Top-level routing and config resolution | Yes -- no leftover shell logic, clean dynamic import for `shell.ts` |
| `runner.ts` | Interface + pool abstraction | Yes -- unchanged, `Sandbox` implements `AgentRunner` correctly |

Import graph is acyclic: `cli.ts` -> `shell.ts` -> `sandbox.ts`, and both `cli.ts` and `shell.ts` -> `util.ts`. No circular dependencies.

## Recommendation
[x] Ready for human review
[ ] Needs revision
