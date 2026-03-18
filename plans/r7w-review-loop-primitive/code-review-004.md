# Code Review: Align Implementation to SPEC.md (Final Review)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/config.ts, src/template.ts, src/loop.ts, src/cli.ts, src/race.ts (after devlog-003 fixes)

## Summary

The implementation is solid. Three prior review/fix cycles resolved all high-severity issues: SIGINT worktree cleanup, `compare` + second-level composition guard, template cache corruption, missing `structuredClone`, SIGINT cleanup window, and ralph fail-safe. The parser correctly implements the full spec grammar, the executor properly recurses through the AST, and the template system is now robust with parameter-aware cache keys. Two medium issues remain from code-review-003 (worktree leaks in resolver error paths, merge resolver missing template context). This review confirms those are still present and adds detail on the merge resolver's error path, which is worse than the pick case. No new high issues found.

## What Works Well

- **Parser grammar coverage**: All spec constructs work — `xN`/`repeat`, `review` (explicit and implicit via positional duck-typing), `ralph`, `vN`/`race`, `vs` branches, resolvers, second-level composition. Token scanning is clean left-to-right with clear keyword detection.
- **Recursive executor design**: The `execute()` → pattern-match-on-node-type approach is clean. Context threading (`lastMessage`, `repeatPass`, `ralphIteration`) through the tree is correct and consistent across all node handlers.
- **Template cache defense-in-depth**: Both root cause (consistent 10-key context in all `renderTemplate` calls) and defense (parameter-name-aware cache key) are in place. The `cachedParamKey` check at `template.ts:48` prevents the class of bug from recurring.
- **Cleanup lifecycle**: `unregister()` in `executeComposition` correctly happens after pool shutdown and commits (line 484), keeping the SIGINT handler active through the critical window.
- **Ralph fail-safe asymmetry**: Inner gate defaults to ITERATE (keep trying), outer ralph defaults to DONE (stop). This is the right asymmetry — bounded by default on the outer loop.
- **Parser validation**: Unknown tokens throw with a clear error listing valid keywords (line 363). `compare` + second-level composition is blocked in both pipeline and `vs` paths.
- **Config fallback chain**: `iterate` falls back to `work` config, `ralph` falls back to `gate` config — both in `cli.ts:resolveStepSelection` and in `executor.ts:302`. Consistent.
- **Clean module boundaries**: `race.ts` is now a utility library (worktree, runner, judge), `parser.ts` owns grammar, `executor.ts` owns orchestration, `loop.ts` owns the work→review→gate cycle. No circular dependencies.

## Issues

### High

(None)

### Medium

- [ ] **Worktree leak across all three resolver error paths** (`executor.ts:694-710, 787-791, 877-879`): After `unregister()` at line 484 removes the SIGINT cleanup handler, worktree cleanup depends entirely on the resolver. All three resolvers have error paths that return without cleaning up:
  - **pick** (lines 694-700, 705-710): Pick agent exception or null verdict → returns `{ lastMessage: '' }` with N orphaned worktrees.
  - **merge** (lines 787-791): `agentLoop` exception → returns without cleaning up N branch worktrees *plus* the merge worktree. This is worse than the pick case because N+1 worktrees leak.
  - **compare** (lines 877-879): Compare agent exception → returns without logging worktree locations, leaving user unable to find them for manual cleanup.

  **Suggested fix**: Either keep the SIGINT cleanup handler registered through resolution (move `unregister()` to after resolver returns), or add a `try/finally` around the resolver dispatch at lines 516-523 that calls cleanup on any error.

- [ ] **Merge resolver `LoopConfig` missing template context** (`executor.ts:775-782`): `mergeLoopConfig` omits `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`. When `agentLoop` builds the `LoopContext` (loop.ts:84-94), these fields are `undefined`. If the user's COOK.md template unconditionally references `${repeatPass}`, the rendered prompt will contain the literal string "undefined". This is the same issue identified in code-review-003.

### Low

- [ ] **Bare resolver keywords without composition context silently consumed** (`parser.ts:356-359`): `cook "work" pick` silently discards the `pick` token and returns `Work("work")`. The user intended a resolver but gets a bare work node with no error. If `pick` is followed by a criteria string, that string hits the "Unknown token" error (line 363), but bare `pick`/`merge`/`compare` alone is silently swallowed. An error like "pick/merge/compare requires a preceding vN or vs composition" would be clearer.

- [ ] **`executeBranchForComposition` code duplication** (`executor.ts:530-662`): ~130 lines reimplementing work, review, repeat, and ralph dispatch for composition branches. The difference is using a per-branch `emitter` instead of the global `loopEvents` and a shared `pool` instead of creating a new one. Any future change to the top-level executor logic must be mirrored here. Carried from prior reviews.

- [ ] **TUI flicker during repeat** (`executor.ts:106-115`): `executeWork` mounts/unmounts the TUI on every call. Inside `executeRepeat`, this produces N mount/unmount cycles. Carried from prior reviews.

- [ ] **`executeReview` confusing control flow** (`executor.ts:185-291`): The `if (node.inner.type !== 'work')` branch at line 194 returns from inside `try/finally`, making lines 249-291 appear unreachable on first read. The logic is correct (lines 249+ run when inner IS a work node) but the structure is non-obvious. Carried from prior reviews.

- [ ] **`resolveCompare` error path silent about worktree locations** (`executor.ts:877-879`): When the compare agent fails, the user gets "Compare failed" but no information about where the worktrees are. The success path (lines 891-893) logs worktree locations. Adding the same to the error path would help users debug and clean up manually.

- [ ] **No TypeScript compilation verified**: None of the three implementation/fix cycles ran `tsc` to verify the code compiles. Carried from code-review-001.

## Questions

- The merge resolver creates its own pool and TUI for the synthesis step. Should the merge synthesis use the same iterate/ralph template context as the branches, or is it intentionally context-free (since it's a standalone synthesis step)?

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

All high issues from prior reviews have been properly resolved. The two remaining medium issues (worktree leaks in resolver error paths, merge template context) are real but non-blocking — worktree leaks are a cleanup nuisance rather than a data-loss risk, and the merge template context only affects custom COOK.md templates that unconditionally use repeat/ralph variables. Both are straightforward follow-up fixes.
