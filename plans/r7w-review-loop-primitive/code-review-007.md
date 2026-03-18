# Code Review: Align Implementation to SPEC.md (Review 7)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/config.ts, src/template.ts, src/loop.ts, src/cli.ts, src/race.ts (full implementation against plan.md)

## Summary

Fresh independent review of the complete implementation after 6 prior review/fix cycles and the ralph convergence check fix from code-review-006. The implementation correctly matches the plan across all files. The parser handles the full spec grammar, the recursive executor cleanly dispatches on AST node types, and all safety mechanisms are in place. All 4 high and 9 medium issues identified across 6 prior reviews are confirmed resolved. No new high or medium issues found. Seven low issues remain from prior reviews, all non-blocking.

## What Works Well

- **Parser grammar coverage is complete** (parser.ts:127-367): All spec forms parse correctly — bare work, implicit review via positional prompts, explicit `review` keyword, `xN`/`repeat N`, `vN`/`race N`, `vs` branches, `ralph`, `pick`/`merge`/`compare` resolvers, second-level composition. Unknown tokens throw descriptive errors (parser.ts:363).
- **AST design is clean**: Five node types with recursive `inner` fields. `structuredClone` used at all three branch-copy sites (parser.ts:292, 332, 476).
- **Executor dispatch is exhaustive** (executor.ts:72-85): Clean switch on node type, each handler manages its own pool lifecycle via `registerCleanup`/`unregister`.
- **Ralph convergence check confirmed** (executor.ts:321-324, 638-641): Both `executeRalph` and the composition ralph case check `result.verdict === 'MAX_ITERATIONS'` after inner loop execution and return early with a warning. Matches plan Step 5 and research Q10 rationale.
- **Ralph fail-safe defaults to DONE** (executor.ts:373-374): Ambiguous gate output stops rather than loops unboundedly.
- **Template cache keyed on parameter names** (template.ts:44-48): `paramKey` prevents corruption from callers with different context shapes.
- **SIGINT cleanup lifecycle correct**: `unregister()` at executor.ts:490 is placed after pool shutdown and commits, keeping the cleanup handler active throughout the critical section.
- **Compare + second-level composition guard**: Parser blocks at both sites (parser.ts:314, 457-458).
- **All LoopConfig constructions pass full context**: `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses` included at executor.ts:218-230, 262-274, 591-603, 789-799.
- **Resolver error path cleanup confirmed**: All three resolvers clean up worktrees on every error/early-return path (resolvePick:707-713/723, resolveMerge:810-814, resolveCompare:904-908).
- **Config correctly extended** (config.ts:8): `StepName` includes `iterate` and `ralph`. `loadConfig` parses both. `resolveStepSelection` in cli.ts:179-205 handles iterate→work and ralph→gate fallbacks.
- **Usage and banner updated** (cli.ts:58-97, 403-412): All new commands, flags, iterate/ralph shown.
- **loop.ts returns LoopResult** (loop.ts:28-33): verdict/iterations/lastMessage/logFile propagated to executor for ralph convergence decision.

## Issues

### High

(None)

### Medium

(None — the ralph convergence check from code-review-006 is confirmed fixed at both locations)

### Low

- [ ] **Bare resolver keywords without composition silently consumed** (parser.ts:356-359): `cook "work" pick` discards `pick` with no error. An error like "pick/merge/compare requires a preceding vN or vs" would be clearer. Carried from code-review-004.

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:536-674): Reimplements work/review/repeat/ralph dispatch for composition branches with per-branch emitter and shared pool. Future changes to executor logic must be mirrored in both locations. Carried from code-review-001.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles with visible flicker. Carried from code-review-001.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the code returns from inside the `if` block (line 237), making the "simple case" code at lines 249-291 appear unreachable on first read. Logic is correct but structure is non-obvious. Carried from code-review-002.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:904-908): Unlike `resolvePick` which prompts before cleanup, `resolveCompare` silently removes worktrees on error. Additionally, when the user picks a branch and the merge fails (lines 933-941), worktrees are still cleaned up, leaving no branches to reference for conflict resolution. Carried from code-review-005.

- [ ] **No TypeScript compilation verified**: None of the seven implementation/fix cycles ran `tsc`. Carried from code-review-001.

- [ ] **`applyAndCleanup` merge failure doesn't mention worktrees** (executor.ts:963-966): When `git merge` fails, the function logs `git status` but doesn't tell the user about the worktree branch names or paths. Carried from code-review-006.

## Verification of Prior Fixes

All 4 high issues from prior reviews confirmed resolved:
1. **SIGINT worktree cleanup** (code-review-001) — `registerCleanup` at executor.ts:443-452 stops all pools, removes all worktrees, cleans session dir
2. **Compare + second-level composition guard** (code-review-001) — parser.ts:314, 457-458
3. **Template cache corruption** (code-review-002) — template.ts:44-48 `paramKey` check
4. **Ralph fail-safe** (code-review-002) — executor.ts:373-374 defaults to DONE

All 9 medium issues from prior reviews confirmed resolved:
1. Unknown tokens error (code-review-001) → parser.ts:363
2. Ralph pool per iteration (code-review-001) → single pool hoisted at executor.ts:305
3. Redundant fallback logic (code-review-001) → removed from loop.ts
4. Missed `structuredClone` (code-review-002) → parser.ts:332
5. SIGINT cleanup window (code-review-002) → `unregister()` moved to executor.ts:490
6. `parseRalphVerdict` fail-open (code-review-002) → defaults to DONE at executor.ts:374
7. Worktree leak on resolver error paths (code-review-004) → all three resolvers clean up
8. Merge resolver missing template context (code-review-004) → executor.ts:796-799
9. Ralph inner loop convergence check (code-review-006) → executor.ts:321-324, 638-641

## Questions

None.

## Recommendation

[x] Ready for human review
[ ] Needs revision

All high and medium issues across 7 review cycles are resolved. The 7 low issues are non-blocking and suitable for follow-up work.
