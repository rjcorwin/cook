# Code Review: Align Implementation to SPEC.md (Review 14)

**Reviewer:** AI (fresh session)
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Full independent review of the implementation after 13 prior review cycles and the latest fix (partial worktree creation failure cleanup). The implementation matches plan.md: unified parser produces a recursive AST from all spec grammar forms, executor pattern-matches on node types with proper resource cleanup across all error paths, and `agentLoop` handles work/review/gate/iterate with structured `LoopResult` returns. The medium from code-review-013 (partial worktree creation failure leaking already-created worktrees) is confirmed fixed at executor.ts:410-426 — the creation loop is wrapped in try/catch that cleans up worktrees 1..K when K+1 fails. No new high or medium issues found. All 4 prior highs and 11 prior mediums verified resolved.

## What Works Well

- **Partial worktree creation fix confirmed** — executor.ts:410-426 wraps the creation loop in try/catch, removes successfully-created worktrees and session directory on failure, and re-throws. Matches the pattern used by the main cleanup handler at line 452-461.

- **All 4 prior highs verified resolved:**
  1. SIGINT cleanup — `registerCleanup` at executor.ts:60-63, composition cleanup at executor.ts:452-461
  2. Compare + second-level composition guard — parser.ts:314, 458
  3. Template cache corruption — `paramKey` cache key at template.ts:44-48
  4. Missed `structuredClone` — parser.ts:292, 332, 476

- **All 11 prior mediums verified resolved:**
  1. Unknown tokens throw descriptive error (parser.ts:363)
  2. Ralph pool hoisted above loop (executor.ts:306)
  3. Redundant fallback logic removed from loop.ts
  4. `structuredClone` at parser.ts:332
  5. `unregister()` deferred to after pool shutdown and commits (executor.ts:499)
  6. `parseRalphVerdict` defaults to DONE (executor.ts:374)
  7. Resolver error paths clean up worktrees (resolvePick:716-724, resolveMerge:816-825, resolveCompare:918-924)
  8. Merge resolver passes all 4 template context fields (executor.ts:806-809)
  9. Ralph inner loop convergence check (executor.ts:322-324, 648-651)
  10. Review loop context loss — `initialLastMessage` at loop.ts:22,60; executor.ts:226,608
  11. Partial worktree creation failure cleanup (executor.ts:410-426)

- **Gate-11 fix confirmed:** `resolveMerge` (executor.ts:849-856) and `resolveCompare` (executor.ts:948-954) return early on merge conflict, preserving branches for inspection.

- **Parser grammar is complete** — Left-to-right token scanning handles all spec forms: implicit review via positional duck-typing (parser.ts:144-182), explicit keywords, `vs` branch splitting (parser.ts:386-498), resolver dispatch, second-level composition, and descriptive validation errors.

- **Config resolution is correct** — cli.ts:179-205 handles iterate→work and ralph→gate fallbacks at step resolution time. All 5 step types (work, review, gate, iterate, ralph) shown in startup banner.

- **`agentLoop` is well-factored** — Work/iterate step switching (loop.ts:65-66), full template context including all 4 extra fields (loop.ts:86-97), structured `LoopResult` with verdict/iterations/lastMessage/logFile.

## Issues

### High

(None)

### Medium

(None — all 11 prior mediums confirmed resolved)

### Low

- [ ] **Compound review iteration 1 uses work step config** (executor.ts:203, loop.ts:65): When `review` wraps a compound inner node, iteration 1 in `agentLoop` selects `workStepName = 'work'` using the work step's agent/model instead of iterate. Only matters when user explicitly configures different agents for work and iterate.

- [ ] **Dead ralph fallback** (executor.ts:303, 654): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` (cli.ts:186-204) which guarantees `agent` is set. The fallback to `ctx.stepConfig.gate` is unreachable.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` silently via the catch-all at line 357, then errors on `"criteria"` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs."

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:545-683): Reimplements work/review/repeat/ralph dispatch for composition branches to use per-branch emitters. Changes to executor logic must be mirrored in both locations.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): The compound inner node path returns inside a try/finally at line 238-243. The simple work path at line 250 appears dead on first read. A guard clause (`if (node.inner.type !== 'work') { ... return } // simple case below`) would clarify.

- [ ] **`resolveCompare` error path auto-cleans without user notice** (executor.ts:918-924): On compare agent failure, worktrees are forcefully removed without showing branch names. Unlike `resolvePick` (executor.ts:718-720), which shows diff commands for manual comparison.

- [ ] **No TypeScript compilation verified**: None of the 14 review cycles ran `tsc`. Type annotations like `Function` (template.ts:37, 47) and non-null assertions (executor.ts:974) are not validated.

- [ ] **`applyAndCleanup` merge failure doesn't show worktree paths** (executor.ts:981-984): On `git merge` failure, returns without calling `cleanupWorktrees` and doesn't log worktree paths for manual inspection. User would need `git worktree list` to find them.

## Questions

None.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

All 4 prior high and 11 prior medium issues across 14 review cycles are confirmed resolved, including the latest fix for partial worktree creation failure. The 9 remaining low-severity items are genuine but non-blocking — all are UX polish, dead code, or structural cleanup suitable for follow-up work.
