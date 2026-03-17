# Code Review: Align Implementation to SPEC.md (Review 12)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Fresh independent review of the complete implementation after 11 prior review cycles and the gate-11 fix. The implementation is solid and complete relative to plan.md. The unified parser correctly produces a recursive AST from all spec grammar forms, the executor cleanly pattern-matches on node types with proper resource cleanup, and `agentLoop` correctly handles the 4-step work/review/gate/iterate cycle. All 4 high and 10 medium issues found across prior reviews are confirmed resolved, including the most recent fix (resolver merge-failure early return in `resolveMerge` and `resolveCompare`). No new high or medium issues found. Nine low-severity items remain as non-blocking follow-ups.

## What Works Well

- **Parser grammar is complete and correct** — Left-to-right token scanning with bottom-up tree construction handles all spec grammar: implicit review via positional duck-typing (parser.ts:144-182), explicit `review`/`ralph`/`repeat`/`race` keywords, `vs` branch splitting (parser.ts:386-498), resolver dispatch, second-level composition, and validation errors with specific messages (parser.ts:129, 136, 202, 260, 363).

- **Executor recursion is clean** — The `execute()` dispatch (executor.ts:72-85) delegates to typed handlers. Context threading via spread (`{ ...ctx, repeatPass: pass }`) keeps state explicit. Resource cleanup uses `registerCleanup`/`unregister` consistently across all execution paths.

- **All 4 prior high issues confirmed resolved:**
  1. SIGINT worktree cleanup — `registerCleanup` at executor.ts:60-63, composition cleanup at executor.ts:444-453
  2. Compare + second-level composition guard — parser.ts:314, 458
  3. Template cache corruption — `paramKey` cache invalidation at template.ts:44-48
  4. Missed `structuredClone` — parser.ts:292, 332, 476

- **All 10 prior medium issues confirmed resolved:**
  1. Unknown tokens → descriptive error (parser.ts:363)
  2. Ralph pool per iteration → single pool hoisted (executor.ts:306)
  3. Redundant fallback logic removed from loop.ts
  4. Missed `structuredClone` at parser.ts:332
  5. SIGINT cleanup window → `unregister()` after pool shutdown and commits (executor.ts:491)
  6. `parseRalphVerdict` fail-safe → defaults to DONE with warning (executor.ts:374)
  7. Worktree leak on resolver error paths → all three resolvers clean up on error
  8. Merge resolver missing template context → executor.ts:798-801
  9. Ralph inner loop convergence check → executor.ts:322-324, 640-641
  10. Review loop context loss → `initialLastMessage` at loop.ts:22, 60; executor.ts:226, 600

- **Gate-11 fix confirmed:** `resolveMerge` (executor.ts:841-848) and `resolveCompare` (executor.ts:942-946) both return early on merge conflict, preserving all branches for user inspection. This matches the `applyAndCleanup` pattern at executor.ts:973-976.

- **Config resolution is correct** — cli.ts:179-205 handles iterate→work and ralph→gate fallbacks at resolution time, so step configs are fully populated before reaching the executor.

- **`agentLoop` is well-factored** — loop.ts handles work/iterate step switching (line 65-66), renders templates with full context including all 4 optional vars (lines 86-97), and returns structured `LoopResult` for executor inspection.

## Issues

### High

(None)

### Medium

(None — all 10 prior mediums confirmed resolved)

### Low

- [ ] **Compound review iteration 1 uses work step config for iterate prompt** (executor.ts:203, 219): When `review` wraps a compound inner node, the iterate prompt is passed as `config.workPrompt` to `agentLoop`. On iteration 1, `agentLoop` selects `workStepName = 'work'` (loop.ts:65), using the work step's agent/model config. Only matters when work and iterate use different agents.

- [ ] **Dead ralph fallback in executor** (executor.ts:303, 646): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` (cli.ts:186-204), making the gate fallback unreachable.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` then errors on `"criteria"` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs."

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:536-676): Reimplements work/review/repeat/ralph dispatch for composition branches to use per-branch emitters instead of the global `loopEvents`. Changes to executor logic must be mirrored in both locations.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the else block at line 198 returns within the try/finally, making the "simple case" code at lines 250-291 look potentially unreachable on first read. A guard clause with early return would clarify intent.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:908-914): On compare agent failure, worktrees are removed without showing branch names or asking the user, unlike the pick resolver which shows diff commands.

- [ ] **No TypeScript compilation verified** — None of the 12 review cycles ran `tsc`. Type annotations like `Function` (template.ts:37, 47) and non-null assertions (executor.ts:966) are not validated.

- [ ] **`applyAndCleanup` merge failure doesn't show worktree paths** (executor.ts:973-976): On `git merge` failure, the function returns without calling `cleanupWorktrees` and doesn't log worktree locations for manual resolution. The user sees `cd <root> && git status` but not which branches/worktrees to inspect.

## Questions

None.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

All high and medium issues across 12 review cycles are resolved. The 9 low items are genuine but non-blocking — they represent UX polish (error messages, control flow clarity), code hygiene (dead code, duplication), and verification gaps (no `tsc` run) that are suitable as follow-up work.
