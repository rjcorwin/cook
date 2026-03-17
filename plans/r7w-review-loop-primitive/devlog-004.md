# Devlog: Iteration 5 — Fix resolver worktree leaks and merge template context

**Date:** 2026-03-17
**Implementing:** Fixes from code-review-004.md (medium issues)

## What Was Done

Fixed the 2 medium issues identified in code-review-004:

1. **Worktree leak across all three resolver error paths** — Added cleanup calls (`removeWorktree` + `cleanupSessionDir`) to every error/early-return path in `resolvePick`, `resolveMerge`, and `resolveCompare`:
   - `resolvePick`: agent error path (line ~694) and null-verdict path (line ~707) now call `cleanupWorktrees`
   - `resolveMerge`: merge loop error path (line ~788) now cleans up all branch worktrees plus the merge worktree
   - `resolveCompare`: agent error path (line ~877) now cleans up all branch worktrees

2. **Merge resolver `LoopConfig` missing template context** — Added `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses` from `ctx` to `mergeLoopConfig`, matching the pattern used in all other `LoopConfig` constructions.

## Tricky Parts

- The merge resolver error path needed to clean up N+1 worktrees (N branch worktrees + 1 merge worktree), each wrapped in try/catch for best-effort cleanup.

## Decisions Made

- Used `cleanupWorktrees` (which prompts the user) for pick error paths, since the user may want to inspect branches manually. Used direct `removeWorktree` calls (no prompt) for merge error paths, since the merge failed and there's no useful state to preserve.

## Deviations from Plan

- None — these were bug fixes from code review, not plan changes.

## Next Steps

- None — all high and medium issues from reviews are now resolved.
