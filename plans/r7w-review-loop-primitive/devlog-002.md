# Devlog: Fix Code Review Issues (Iteration 2)

**Date:** 2026-03-17
**Implementing:** code-review-001.md fixes

## What Was Done

Fixed all 2 high, 3 medium, and 4 low issues identified in code-review-001.md.

### High

- **Composition worktrees leak on SIGINT** (`executor.ts`): Rewired `registerCleanup` in `executeComposition` to also call `pool.stopAll()` on each runner pool, `removeWorktree()` on each worktree, and `cleanupSessionDir()` for the session. Moved `pools` and `cookMDs` creation before the cleanup registration so they're in scope.

- **`compare` resolver allows second-level composition** (`parser.ts`): Added `resolver !== 'compare'` guard before the second-level composition check in both `parsePipeline` (the vN/race path) and the `vs` branch path. Now `cook "work" v3 compare v3 pick` will correctly stop at compare and error on the trailing tokens.

### Medium

- **Unknown tokens silently skipped** (`parser.ts`): Changed from `i++` skip to throwing an error with a descriptive message listing valid keywords/patterns.

- **`executeRalph` creates pool per iteration** (`executor.ts`): Hoisted `createRunnerPool` and `registerCleanup` above the ralph for-loop. A single pool is now reused across all ralph iterations, cleaned up in a `finally` block.

- **Redundant step fallback in `loop.ts`**: Removed the `iterate→work` and `ralph→gate` fallback logic from `loop.ts` lines 74-79 since `resolveStepSelection` in `cli.ts` already handles this. Single source of truth now.

### Low

- **Dead code `splitVsBranches`** (`parser.ts`): Removed the unused function entirely.

- **Branch nodes share references** (`parser.ts`): Changed `Array.from({ length: count }, () => current)` to use `structuredClone(current)` in all 4 occurrences (vN in pipeline, vN second-level in pipeline, vs branch path, vs second-level).

- **Banner omits iterate/ralph** (`cli.ts`): Added iterate and ralph step config lines to the startup banner.

- **Sequential cleanup** (`executor.ts`): Changed `cleanupActiveExecutions` from sequential `for..of` to `Promise.allSettled()` for parallel cleanup.

## Tricky Parts

- The `registerCleanup` for composition needed `pools` to be in scope, but `pools` was originally declared after the cleanup registration. Reordered the declarations so `cookMDs` and `pools` are created before `registerCleanup` while still being after worktree creation and TUI render.

## Decisions Made

- The `executeBranchForComposition` code duplication (medium #5 from review) was not addressed in this iteration. Refactoring it to share logic with the top-level executor would require threading the emitter through `ExecutionContext` or extracting shared helpers — a larger refactor that risks introducing regressions. Deferred to a follow-up.

- TUI flicker during repeat (medium #6) was not addressed. Lifting TUI lifecycle to the repeat level requires changes to the App component and how `loopEvents` is managed, which is a TUI architecture change beyond the scope of this fix pass.

## Deviations from Plan

- None — these are post-implementation fixes from code review, not plan deviations.

## Next Steps

- Run TypeScript type checking and build verification
- Re-review to confirm all high/medium issues are resolved
