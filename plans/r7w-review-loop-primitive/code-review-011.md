# Code Review: Align Implementation to SPEC.md (Review 11)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Fresh independent review of the complete implementation after 10 prior review cycles. The overall implementation is solid — the unified parser produces a correct recursive AST, the executor pattern-matches cleanly on node types, and the 4 high + 10 medium issues found across prior reviews are all confirmed resolved. One new medium issue found: `resolveMerge` unconditionally deletes all worktrees and branches even when `git merge` into the main branch fails with a conflict, destroying the user's access to generated work. Nine low-severity items carried from prior reviews.

## What Works Well

- **Parser grammar is clean and correct** — Left-to-right token scanning with bottom-up tree construction handles all spec grammar forms: implicit review via positional prompts, explicit `review`/`ralph`/`repeat`/`race` keywords, `vs` branch splitting, resolver dispatch, and second-level composition. Validation errors are specific and helpful (parser.ts:129, 136, 202, 260, 363).

- **Executor recursion is well-structured** — The `execute()` switch at executor.ts:72-85 cleanly dispatches to per-type handlers. Context threading via spread (`{ ...ctx, repeatPass: pass }`) keeps state propagation explicit without hidden mutation.

- **All 4 prior high issues confirmed resolved:**
  1. SIGINT worktree cleanup — `registerCleanup` at executor.ts:60-63, cleanup at executor.ts:444-453
  2. Compare + second-level composition guard — parser.ts:314, 458
  3. Template cache corruption — `paramKey` cache key at template.ts:44-48
  4. Missed `structuredClone` — parser.ts:292, 332, 476

- **All 10 prior medium issues confirmed resolved:**
  1. Unknown tokens → descriptive error (parser.ts:363)
  2. Ralph pool per iteration → single pool hoisted (executor.ts:306)
  3. Redundant fallback logic removed from loop.ts
  4. Missed `structuredClone` at parser.ts:332
  5. SIGINT cleanup window → `unregister()` moved after pool shutdown (executor.ts:491)
  6. `parseRalphVerdict` fail-safe → defaults to DONE (executor.ts:374)
  7. Worktree leak on resolver error paths → all three resolvers clean up
  8. Merge resolver missing template context → executor.ts:798-801
  9. Ralph inner loop convergence check → executor.ts:322-324, 640-641
  10. Review loop context loss → `initialLastMessage` at loop.ts:22, 60; executor.ts:226, 600

- **Config resolution chain is correct** — cli.ts:179-205 handles iterate→work and ralph→gate fallbacks at config resolution time, so all step configs are fully populated before reaching the executor.

- **`agentLoop` is clean and well-factored** — loop.ts handles work/iterate step switching (line 65-66), template rendering with full context (lines 86-97), gate verdict parsing, and returns a structured `LoopResult` the executor can inspect.

## Issues

### High

(None)

### Medium

- [ ] **`resolveMerge` deletes all branches after merge conflict into main** (executor.ts:838-851): When the `git merge "${mergeBranch}" --no-edit` fails (e.g., conflict), the catch block at line 841 logs a warning and prints `cd ${projectRoot} && git status`. Execution then falls through to lines 847-851 which unconditionally call `removeWorktree` for all original run branches AND the merge synthesis branch, and delete the session directory. The user's repo is left in a conflicted merge state, but the branch being merged and all source branches are deleted — making it impossible to inspect them, retry, or abort cleanly. Compare with `applyAndCleanup` (line 965-968) which correctly returns early on merge failure, preserving worktrees for inspection. Fix: either return early after merge failure (like `applyAndCleanup` does) or call `git merge --abort` before cleanup. The same pattern exists in `resolveCompare` (lines 935-943) where user-picked merge failure also leads to branch deletion.

### Low

- [ ] **Compound review iteration 1 uses work step config for iterate prompt** (executor.ts:203, 219): When `review` wraps a compound inner node, `agentLoop` receives the iterate prompt as `config.workPrompt`. On iteration 1, `agentLoop` selects `workStepName = 'work'` (loop.ts:65), using the work step's agent/model config rather than iterate's. Only matters when work and iterate are configured with different agents.

- [ ] **Dead ralph fallback in executor** (executor.ts:303, 646): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` (cli.ts:186-204), making the `ctx.stepConfig.gate` fallback unreachable.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` then errors on `"criteria"` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs."

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:536-676): Reimplements work/review/repeat/ralph dispatch for composition branches. Changes to executor logic must be mirrored in both locations.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the else block returns within lines 237-243, making the "simple case" code at lines 250-291 appear unreachable on first read. A guard clause would be clearer.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:904-910): On compare agent error, worktrees are silently removed without showing branch names for manual inspection.

- [ ] **No TypeScript compilation verified** — None of the 11 review cycles ran `tsc`. Type errors (e.g., `Function` type at template.ts:37, 47) could surface at build time.

- [ ] **`applyAndCleanup` merge failure skips cleanup** (executor.ts:965-968): When `git merge` fails, the function returns without calling `cleanupWorktrees` and doesn't show worktree paths for manual resolution.

## Questions

None.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see medium issue above)

The `resolveMerge` branch deletion after merge conflict is a data-loss risk — a 3-line fix (return early after the catch block, matching `applyAndCleanup`'s pattern) would resolve it. All prior high and medium issues remain resolved.
