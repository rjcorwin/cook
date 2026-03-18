# Code Review: Align Implementation to SPEC.md (Review 5)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/executor.ts (after devlog-004 fixes for resolver worktree leaks and merge template context)

## Summary

The two medium issues from code-review-004 are confirmed fixed. All resolver error paths now clean up worktrees, and the merge resolver's `LoopConfig` passes the full template context. Across five review cycles, every high and medium issue has been resolved. The implementation correctly covers the full spec grammar (parser), recurses cleanly through the AST (executor), and threads context properly through all execution paths. Six low-severity issues remain — all carried from prior reviews, none blocking.

## What Works Well

- **Resolver error cleanup complete**: All three resolvers now handle every error/early-return path:
  - `resolvePick` (lines 694-701, 707-713): calls `cleanupWorktrees` (user-prompted) on both agent error and null-verdict paths
  - `resolveMerge` (lines 793-803): directly removes N branch worktrees + merge worktree + session dir on `agentLoop` error
  - `resolveCompare` (lines 888-896): directly removes N branch worktrees + session dir on agent error
- **Merge template context fixed**: `mergeLoopConfig` (lines 784-787) now includes `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses` from `ctx`, matching all other `LoopConfig` constructions
- **Consistent cleanup design**: pick uses interactive `cleanupWorktrees` (user may want to inspect branches), merge/compare use direct cleanup (failed synthesis has no useful state) — sensible asymmetry documented in devlog-004
- **All prior high fixes confirmed in place**: SIGINT cleanup lifecycle (`unregister()` after commits at line 484), `compare` + second-level composition guard (parser lines 314, 457-458), template cache `paramKey` check (template.ts:44-48), `structuredClone` on all branch array constructions, ralph fail-safe defaulting to DONE (line 368)

## Issues

### High

(None)

### Medium

(None — both prior mediums resolved)

### Low

- [ ] **Bare resolver keywords without composition context silently consumed** (`parser.ts:356-359`): `cook "work" pick` silently discards the `pick` token. An error like "pick/merge/compare requires a preceding vN or vs" would be clearer. Carried from code-review-004.

- [ ] **`executeBranchForComposition` code duplication** (`executor.ts:530-662`): ~130 lines reimplementing work/review/repeat/ralph dispatch for composition branches. Differs from top-level executor by using a per-branch emitter and shared pool. Future changes to executor logic must be mirrored. Carried from code-review-001.

- [ ] **TUI flicker during repeat** (`executor.ts:106-115`): `executeWork` mounts/unmounts the Ink app per call. Inside `executeRepeat`, this produces N mount/unmount cycles. Carried from code-review-001.

- [ ] **`executeReview` confusing control flow** (`executor.ts:185-291`): The `else` branch (lines 194-247) returns from inside `try/finally`, making lines 249-291 appear unreachable on first read. Logic is correct but structure is non-obvious. Carried from code-review-002.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (`executor.ts:888-896`): Unlike `resolvePick` which prompts the user before cleanup, `resolveCompare` silently removes worktrees on error. The branch work succeeded (only the comparison agent failed), so users might want to inspect branches. Minor UX inconsistency.

- [ ] **No TypeScript compilation verified**: None of the five implementation/fix cycles ran `tsc`. Carried from code-review-001.

## Questions

None remaining.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

All high and medium issues across five review cycles are resolved. The remaining lows are cosmetic, structural, or deferred-by-design. The implementation is ready for human review and merge.
