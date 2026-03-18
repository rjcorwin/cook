# Code Review: Align Implementation to SPEC.md (Review 016)

**Reviewer:** AI (independent deep review against SPEC.md and plan.md)
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/template.ts, src/config.ts, src/race.ts, src/cli.ts

## Summary

Fresh review reading every file against SPEC.md and plan.md from scratch, after code-review-015 confirmed zero High/Medium issues. This pass found two new Medium issues missed by all prior cycles — a spec compliance gap in the compound-inner review path, and a silent `--work` flag drop — plus three new Low issues. All 4 prior Highs and 11 prior Mediums remain resolved. The code is well-structured and the grammar coverage is complete; the new findings are behavioral edge cases, not architectural problems.

## What Works Well

- **Grammar coverage is complete and correct.** Parser handles all spec forms: implicit review via positional duck-typing, explicit `review`/`ralph`/`repeat`/`xN`/`vN`, `vs` branch splitting, resolver dispatch, and second-level composition. `x1`/`v1` are no-ops. `compare` cannot be followed by second-level composition. All edge cases from SPEC.md examples trace correctly through the parser.

- **AST nesting matches spec semantics.** `cook "work" review x3` → `Repeat(ReviewLoop(Work), 3)`. `cook "work" x3 review` → `ReviewLoop(Repeat(Work, 3))`. `cook "work" x3 review x3` → `Repeat(ReviewLoop(Repeat(Work, 3)), 3)`. All verified by tracing parsePipeline token-by-token.

- **Resource cleanup is rigorous.** SIGINT/SIGTERM handlers in cli.ts:41-48 call `cleanupActiveExecutions`. The `registerCleanup`/`unregister` pattern in executor.ts is consistent across work, review, ralph, and composition handlers. Partial worktree creation failure cleans up already-created worktrees (executor.ts:420-425). `unregister()` is deferred until after pools are stopped and commits are done (executor.ts:499).

- **Template cache correctly invalidates on key-set change.** template.ts:44,48 checks both source equality and `paramKey` (the ordered list of context keys). If different execution contexts provide different subsets of optional fields, recompilation is triggered. No cache corruption.

- **Ralph fail-safe defaults correctly.** `parseRalphVerdict` (executor.ts:368-376) defaults to `DONE` when no NEXT/DONE verdict is found, preventing runaway loops. Matches research Q10.

- **Config resolution chain is complete.** cli.ts:179-205 resolves all 5 step types with correct fallbacks: `iterate` falls back to `work`, `ralph` falls back to `gate`. All five steps shown in the main execution banner.

## Issues

### High

(None — all 4 prior high issues confirmed resolved)

### Medium

- [ ] **Compound inner path runs a spurious work step before first review** (executor.ts:203, executeBranchForComposition:596): When a `review` node wraps a non-`work` inner node (e.g., `Repeat`), `agentLoop` is invoked with `workPrompt = node.iteratePrompt ?? 'Continue working on the task based on the review feedback.'`. On iteration 1, `agentLoop` executes the work step with this iterate-style prompt — before any review has occurred. The spec for `cook "work" x3 review` says the flow is `work → work → work → review → gate`. The implementation inserts an extra agent call: `work × 3 → [spurious work] → review → gate`. The agent receives "Continue working based on review feedback" with no prior review context, which is semantically wrong and wastes an agent call. The same bug exists in both `executeReview` (executor.ts:199-247) and `executeBranchForComposition` (executor.ts:588-621). The fix requires either: (a) a way to tell `agentLoop` to skip iteration 1's work step and go directly to review, or (b) restructuring so the first review pass receives `initialLastMessage` and begins at the review step.

- [ ] **`--work` flag silently ignored when a positional work prompt is provided** (parser.ts:127-137, 371-381): `parsedFlags.work` is consulted only when `positional.length === 0` (line 377). When a positional work prompt exists, `parsePipeline` always uses `tokens[0]`, ignoring `parsedFlags.work`. This is inconsistent: `--review` and `--gate` correctly override their positional equivalents (parser.ts:165-167, 232-234). A user running `cook "original prompt" review --work "override"` will see "original prompt" used silently, never the override. Either `--work` should override the positional (consistent with `--review`/`--gate`), or the help text should clarify that `--work` is only for flag-only invocations.

### Low

- [ ] **`cook doctor` loses CLI flags when no positional work prompt is provided** (cli.ts:303-310): `cmdDoctor` feeds args through `parse()` to extract flags. If `args` contains only flags (e.g., `cook doctor --agent codex`), `parse()` throws "Work prompt is required" and the catch block falls back to `{ showRequest: true }`, discarding all flags. `resolveAgentPlan` then uses config defaults, so `cook doctor --agent codex` shows claude diagnostics rather than codex. Fix: parse flags with `separateFlags` directly rather than routing through the full `parse()`.

- [ ] **`parseGateVerdict` over-broad keyword matching** (loop.ts:37-46): `DONE_KEYWORDS` includes `'APPROVE'` and `'ACCEPT'`; `ITERATE_KEYWORDS` includes `'REVISE'` and `'RETRY'`. A gate response that begins a line with "Approved — the implementation looks solid" or "Accept these findings as complete" would trigger a DONE verdict even if the gate author intended a structured response, not the exact DONE/ITERATE the spec requires. The spec says: "respond with exactly DONE or ITERATE on its own line." The matching should require the entire trimmed line (or first word) to be exactly the keyword, not that the line `startsWith` a keyword from a broadened set.

- [ ] **`cmdDoctor` omits Iterate and Ralph from step output** (cli.ts:313-316): The doctor banner prints Work/Review/Gate but not Iterate or Ralph. The main execution banner (cli.ts:408-412) shows all five. Inconsistency means `cook doctor` can't be used to verify iterate/ralph configuration.

- [ ] **`which ${agent}` uses interpolated shell string** (cli.ts:349): `execSync(\`which ${agent}\`)` uses a template string. Although `parseAgent` constrains `agent` to one of three known values making injection impossible in practice, using `execFileSync` or `execSync('which claude')` with a safe static string is a cleaner pattern. Low severity because the value is validated, but worth eliminating the pattern.

- [ ] **`executeBranchForComposition` ralph path doesn't log gate output** (executor.ts:669): The composition-branch ralph path passes `() => {}` as the line callback when running the ralph gate agent (vs. the top-level `executeRalph` at line 344 which logs via `console.error`). Ralph gate output is silently discarded in composition branches, making debugging harder when a composition branch's ralph loop doesn't converge as expected.

- [ ] **`applyAndCleanup` on merge failure leaves worktrees without logging paths** (executor.ts:981-984): When `git merge` fails, the function returns without cleaning up worktrees and without logging their locations. Users must run `git worktree list` to find them. Compare with `resolvePick` (executor.ts:718-720) which explicitly logs `git diff HEAD...${branchName}` commands.

## Questions

- For the compound inner path (Medium #1): the cleanest fix seems to be adding a `skipWork: boolean` option to `LoopConfig` that causes `agentLoop` to start at the review step on iteration 1. Is that the preferred approach, or should `executeReview` be restructured to handle the compound case outside of `agentLoop`?

- For `--work` override behavior (Medium #2): should `--work` override the positional, or should it be documented as flag-only? The current behavior of `--review`/`--gate` overriding positionals suggests the former.

## Recommendation

[ ] Ready for human review
[x] Needs revision (Medium issues above)

Two new Medium issues require fixes before this is ready: the spurious work call in the compound-inner review path (spec violation), and the silent `--work` flag drop (inconsistent with `--review`/`--gate`). The five Low items are non-blocking quality improvements.
