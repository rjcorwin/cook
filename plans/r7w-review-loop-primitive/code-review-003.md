# Code Review: Fixes from Code Review 002

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** Implementation after devlog-003 fixes (parser.ts, executor.ts, template.ts, loop.ts, cli.ts, config.ts, race.ts)

## Summary

The fixes from code-review-002 have been applied correctly. The template cache corruption is resolved with a dual fix (consistent keys + cache key includes parameter names). The `structuredClone` gap is closed. The SIGINT cleanup window is sealed. The ralph fail-safe change is sound. `fork-join.ts` has been properly deleted. Two medium issues remain: worktree leaks in error paths of the pick resolver, and missing template context in the merge resolver's loop config.

## What Works Well

- **Template cache defense-in-depth**: Fixing the root cause (consistent 10-key context everywhere) AND adding parameter-name-aware cache keys is solid engineering. Either fix alone would suffice; together they prevent regression.
- **Parser validation**: Unknown tokens now throw with a clear error message listing valid keywords. The `compare` + second-level composition guard is present in both pipeline and `vs` paths.
- **Ralph fail-safe**: Defaulting to DONE with a warning log on ambiguous output is the right call. Inner gate defaulting to ITERATE (keep trying) vs. outer ralph defaulting to DONE (stop) is correct asymmetry.
- **Cleanup lifecycle**: The `unregister()` in `executeComposition` now happens after pool shutdown and commits (line 484), closing the SIGINT window.
- **Clean deletion of `fork-join.ts`**: No residual imports anywhere in `src/`.

## Issues

### High

(None)

### Medium

- [ ] **Worktree leak on pick failure or ambiguous verdict** (`executor.ts:694-711`): `resolvePick` has two early-return paths that skip worktree cleanup. When the pick agent throws (line 700) or returns no clear verdict (line 711), the function returns `{ lastMessage: '' }` without calling `cleanupWorktrees()` or `removeWorktree()`. The cleanup handler was already unregistered at line 484 before the resolver was invoked, so the SIGINT handler won't catch this either. Worktrees and branches accumulate in `.cook/race/` until manually removed. Fix: add cleanup calls before the early returns, or restructure so the cleanup handler stays active through resolution.

- [ ] **Merge resolver `LoopConfig` missing template context** (`executor.ts:775-782`): The `mergeLoopConfig` object omits `ralphIteration`, `maxRalph`, `repeatPass`, and `maxRepeatPasses`. When `agentLoop` builds the `LoopContext` (loop.ts:91-94), these fields will be `undefined`. If the user's COOK.md template references `${repeatPass}` unconditionally, the rendered prompt will contain the literal string "undefined". Fix: pass `ctx.ralphIteration`, `ctx.maxRalph`, `ctx.repeatPass`, `ctx.maxRepeatPasses` through the merge loop config.

### Low

- [ ] **`executeBranchForComposition` code duplication** (`executor.ts:530-662`): ~130 lines duplicating top-level executor dispatch for work, review, repeat, and ralph within a composition branch. Deferred from prior reviews. Risk is maintenance divergence — any change to the top-level executor logic must be mirrored here.

- [ ] **TUI flicker during repeat** (`executor.ts:106-115`): `executeWork` mounts and unmounts the TUI on every call. Inside `executeRepeat`, this means N mount/unmount cycles. Deferred from prior reviews.

- [ ] **`executeReview` confusing control flow** (`executor.ts:185-291`): The if/else where the else branch returns makes lines 249-291 appear to be dead code on first read. The logic is correct but the structure is non-obvious. Deferred from prior reviews.

- [ ] **`resolveCompare` no cleanup instructions when user declines** (`executor.ts:914-916`): When the user enters blank at the "Apply a run?" prompt, worktrees are preserved (by design for comparison) but no cleanup command is suggested. Adding a hint like `git worktree remove <path>` would help users clean up later.

## Questions

- Is the merge resolver intentionally designed to run without ralph/repeat context? If merge is always a standalone synthesis step, the missing context fields may be acceptable (the template variables would just be unused). But if users write COOK.md templates that unconditionally reference these variables, it would produce broken prompts.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

The two medium issues are real but non-blocking for merge — worktree leaks are annoying but not data-loss risks, and the merge template context issue only manifests if COOK.md uses repeat/ralph variables unconditionally. Both are straightforward fixes that could be addressed in a follow-up.
