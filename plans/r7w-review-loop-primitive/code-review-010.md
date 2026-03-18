# Code Review: Align Implementation to SPEC.md (Review 10)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Tenth review after the fix for code-review-009's medium issue (review loop context loss with compound inner nodes). The fix adds `initialLastMessage` to `LoopConfig` and threads it through both `executeReview` and `executeBranchForComposition`. Verified correct: `agentLoop` seeds `lastMessage` from `config.initialLastMessage` (loop.ts:60), `executeReview` passes `innerResult.lastMessage` for compound inner nodes (executor.ts:226), and `executeBranchForComposition` threads `ctx.lastMessage` after inner execution (executor.ts:589, 600). The simple work-node paths are unaffected since `initialLastMessage` is either undefined or empty. All 4 prior highs and 10 prior mediums are confirmed resolved. No new high or medium issues found. Eight carried low issues and one new low.

## What Works Well

- **`initialLastMessage` threading is correct** — The compound inner-node path in `executeReview` (executor.ts:199-232) executes the inner node, captures `innerResult.lastMessage`, and passes it as `initialLastMessage` to the review loop. `agentLoop` (loop.ts:60) seeds `lastMessage = config.initialLastMessage ?? ''`, so the review agent's first iteration sees the inner execution's output via `${lastMessage}` in COOK.md. The fix is minimal and correctly scoped: simple work-node review paths don't set `initialLastMessage`, defaulting to empty as before.

- **`executeBranchForComposition` mirrors the fix** (executor.ts:586-600) — The branch variant correctly mutates `ctx` with the inner result's `lastMessage` before building the `LoopConfig`, so `initialLastMessage: ctx.lastMessage` carries through.

- **All prior high issues confirmed resolved** (4/4):
  1. SIGINT worktree cleanup — `registerCleanup` at executor.ts:444-453
  2. Compare + second-level composition guard — parser.ts:314, 458
  3. Template cache corruption — `paramKey` at template.ts:44-48
  4. Missed `structuredClone` — parser.ts:292, 332, 476

- **All prior medium issues confirmed resolved** (10/10):
  1. Unknown tokens error — parser.ts:363
  2. Ralph pool per iteration — single pool at executor.ts:306
  3. Redundant fallback logic — removed from loop.ts
  4. Missed `structuredClone` at parser.ts:332
  5. SIGINT cleanup window — `unregister()` at executor.ts:491 (after pool shutdown + commits)
  6. `parseRalphVerdict` fail-open — defaults to DONE at executor.ts:374
  7. Worktree leak on resolver error paths — all three resolvers clean up
  8. Merge resolver missing template context — executor.ts:798-801
  9. Ralph inner loop convergence check — executor.ts:322-324, 640-641
  10. Review loop context loss — `initialLastMessage` at loop.ts:22, 60; executor.ts:226, 600

## Issues

### High

(None)

### Medium

(None)

### Low

- [ ] **Compound review iteration 1 uses work step config for iterate prompt** (executor.ts:203, 219): When `review` wraps a compound inner node, `agentLoop` receives the iterate prompt as `config.workPrompt` (executor.ts:219). On iteration 1, `agentLoop` selects `workStepName = 'work'` (loop.ts:65), using the work step's agent/model/sandbox config rather than iterate's. Only matters if work and iterate are configured with different agents/models, which is an edge case. The `executeBranchForComposition` review path (executor.ts:588, 592) has the same behavior.

- [ ] **Dead ralph fallback in executor** (executor.ts:303, 646): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` (cli.ts:186-204), making the gate fallback unreachable. The actual ralph→gate fallback happens at config resolution time (cli.ts:190-191). Carried from code-review-009.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` then errors on `criteria` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs." Carried from code-review-004.

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:536-676): Reimplements work/review/repeat/ralph dispatch for composition branches. Future changes to executor logic must be mirrored in both locations. Carried from code-review-001.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles. Carried from code-review-001.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the else block returns within lines 237-243, making the "simple case" code at lines 250-291 appear unreachable on first read. A guard clause (`if (node.inner.type !== 'work') { ... return }`) would be clearer. Carried from code-review-002.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:904-910): On compare error, worktrees are silently removed without showing branch names for manual inspection. Carried from code-review-005.

- [ ] **No TypeScript compilation verified** — None of the 10 review cycles ran `tsc`. Type errors (e.g., `Function` type in template.ts:37,47) could surface at build time. Carried from code-review-001.

- [ ] **`applyAndCleanup` merge failure skips cleanup** (executor.ts:965-968): When `git merge` fails, the function returns without calling `cleanupWorktrees` and doesn't show the user worktree paths for manual resolution. Carried from code-review-007.

## Questions

None.

## Recommendation

[x] Ready for human review
[ ] Needs revision

All high and medium issues across 10 review cycles are resolved. Nine low-severity items remain — all non-blocking and suitable for follow-up work.
