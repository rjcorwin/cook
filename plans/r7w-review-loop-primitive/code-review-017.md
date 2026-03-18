# Code Review: Align Implementation to SPEC.md (Review 017)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/template.ts, src/config.ts, src/race.ts, src/cli.ts

## Summary

Both Medium issues from code-review-016 are confirmed resolved. The compound-inner review path now sets `skipFirstWork: true` in both `executeReview` (executor.ts:227) and `executeBranchForComposition` (executor.ts:610), so `agentLoop` correctly begins at the review step rather than running a spurious iterate-style work call. The `--work` flag now overrides the positional work prompt via `parsedFlags.work ?? tokens[0]` (parser.ts:139), consistent with how `--review` and `--gate` behave. The five Low issues from code-review-016 are still open and are carried forward below. No new High or Medium issues were found in this pass.

## What Works Well

- **Both Medium issues from 016 are fixed.** `skipFirstWork: true` is correctly set when `node.inner.type !== 'work'` in both the top-level `executeReview` path and the `executeBranchForComposition` review case. `agentLoop` (loop.ts:70-79) skips the work step on iteration 1 when `skipFirstWork` is set, so `cook "work" x3 review` now produces `work × 3 → review → gate` with no extra agent call. `--work` flag override now works symmetrically with `--review` and `--gate`.

- **`skipFirstWork` implementation is semantically correct.** In the compound path, `initialLastMessage` is set from the inner result and `workPrompt` is set to the iterate prompt. On iteration 1, the steps array is `[review, gate]` and `initialLastMessage` seeds `lastMessage` for the review step. Iteration 2+ use the iterate prompt for the work step. The flow matches the spec intent.

- **All prior High issues remain resolved.** The four High issues found in earlier cycles (missing iterate step, missing ralph, `xN` semantics, resolver renames) are fully implemented and intact.

## Issues

### High

(None)

### Medium

(None — both 016 Mediums confirmed resolved)

### Low

- [ ] **`cook doctor` loses CLI flags when no positional work prompt is provided** (cli.ts:303-310): When `args` contains only flags (e.g., `cook doctor --agent codex`), `parse()` throws "Work prompt is required" and the catch falls back to `{ showRequest: true }`, discarding all flags. `resolveAgentPlan` then uses config defaults, so `cook doctor --agent codex` shows claude diagnostics rather than codex. Fix: extract flags using `separateFlags` directly instead of routing through the full `parse()`.

- [ ] **`cook doctor` omits Iterate and Ralph from step output** (cli.ts:313-316): The doctor printout shows Default/Work/Review/Gate but not Iterate or Ralph. The main execution banner (cli.ts:408-412) shows all five. Inconsistency means `cook doctor` cannot verify iterate/ralph configuration.

- [ ] **`parseGateVerdict` over-broad keyword matching** (loop.ts:39-46): `DONE_KEYWORDS` includes `'APPROVE'` and `'ACCEPT'`; `ITERATE_KEYWORDS` includes `'REVISE'` and `'RETRY'`. A gate response starting a sentence with "Approved — the implementation looks solid" would trigger DONE. The spec says the gate should respond with exactly DONE or ITERATE on its own line. Matching should check that the entire trimmed line (or first whitespace-delimited word) equals the keyword exactly.

- [ ] **`executeBranchForComposition` ralph path silently discards gate output** (executor.ts:671): The ralph gate agent call passes `() => {}` as the line callback, dropping all output. The top-level `executeRalph` (executor.ts:344) logs via `console.error`. Missing gate output makes it harder to debug composition branches where ralph doesn't converge.

- [ ] **`applyAndCleanup` on merge failure leaves worktrees without logging paths** (executor.ts:981-984): When `git merge` fails, the function returns without logging worktree locations. Compare with `resolvePick` (executor.ts:718-720) which explicitly prints `git diff HEAD...${branchName}` for each run so the user knows where to look.

## Questions

(None — the two questions from 016 are resolved by the implementation choices made.)

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

Both Mediums from code-review-016 are resolved and no new High or Medium issues were found. The five remaining Low items are non-blocking quality improvements that can be addressed in a follow-on pass or left for the human reviewer to prioritize.
