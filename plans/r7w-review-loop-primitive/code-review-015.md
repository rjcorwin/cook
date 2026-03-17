# Code Review: Align Implementation to SPEC.md (Review 15)

**Reviewer:** AI (fresh session, independent review)
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Full independent code review of the implementation against plan.md after 14 prior review cycles. The implementation is solid: `parser.ts` produces a recursive AST from all spec grammar forms (work, repeat, review, ralph, composition with vs/vN, resolvers, second-level composition), `executor.ts` walks it with proper resource cleanup, and `agentLoop` handles the work/review/gate/iterate loop with structured `LoopResult`. All 4 prior high issues and 11 prior medium issues are confirmed resolved in the code. No new high or medium issues found. 9 low-severity items remain from prior reviews plus 2 new observations.

## What Works Well

- **Parser grammar coverage is complete and correct** — Left-to-right token scanning handles all plan.md grammar forms: implicit review via positional duck-typing (parser.ts:144-182), explicit `review`/`ralph`/`repeat` keywords, `xN`/`vN` patterns, `vs` branch splitting (parser.ts:386-498), resolver dispatch with criteria, and second-level composition. Validation errors are descriptive (e.g., parser.ts:136, 201, 259, 363).

- **All 4 prior high issues verified resolved in code:**
  1. SIGINT worktree cleanup — `registerCleanup` at executor.ts:60-63, composition cleanup at executor.ts:452-461, cli.ts SIGINT/SIGTERM handlers at lines 41-48
  2. Compare + second-level composition guard — parser.ts:314, parser.ts:458
  3. Template cache corruption — `paramKey` check at template.ts:44,48 ensures recompilation on key-set mismatch
  4. Missed `structuredClone` — parser.ts:292 (vN branches), parser.ts:332 (second-level pipeline), parser.ts:476 (second-level vs)

- **All 11 prior medium issues verified resolved in code:**
  1. Unknown tokens error (parser.ts:363)
  2. Ralph pool hoisted above loop (executor.ts:306)
  3. Redundant fallback removed from loop.ts (single source in cli.ts:188-191)
  4. structuredClone at parser.ts:332
  5. `unregister()` deferred to after pool+commits (executor.ts:499)
  6. `parseRalphVerdict` defaults to DONE (executor.ts:374)
  7. Resolver error paths clean up worktrees (resolvePick:716-724, resolveMerge:816-825, resolveCompare:918-924)
  8. Merge resolver passes all 4 template context fields (executor.ts:806-809)
  9. Ralph inner loop convergence check (executor.ts:322-324, executor.ts:648-651)
  10. Review loop context loss fixed via `initialLastMessage` (loop.ts:22,60; executor.ts:226,608)
  11. Partial worktree creation failure cleanup (executor.ts:410-426)

- **Executor recursion is clean** — `execute()` at executor.ts:72-85 is a simple switch that dispatches to type-specific handlers. Each handler follows a consistent pattern: setup → execute → cleanup. Resource management uses `registerCleanup`/`unregister` + `try/finally` consistently.

- **Config resolution chain is correct** — cli.ts:179-205 handles iterate→work and ralph→gate fallbacks at resolution time (not runtime). All 5 step types shown in banner. `loadConfig` in config.ts:66-103 parses all 5 steps with proper defaults.

- **agentLoop is well-factored** — Work/iterate step switching at loop.ts:65-66, full template context including all 4 extra fields at loop.ts:86-97, structured `LoopResult` with verdict/iterations/lastMessage/logFile.

- **Resolver implementations are complete** — Pick reuses buildJudgePrompt/parseJudgeVerdict from race.ts. Merge creates a synthesis worktree with MERGE_CONTEXT.md and runs agentLoop. Compare generates a structured comparison document and offers interactive branch selection. All three handle error and conflict paths properly.

## Issues

### High

(None)

### Medium

(None — all 11 prior mediums confirmed resolved)

### Low

- [ ] **Compound review iteration 1 uses work step config** (executor.ts:203-215, loop.ts:65): When `review` wraps a compound inner node, iteration 1 in `agentLoop` selects `workStepName = 'work'` using the work step's agent/model. Only matters when the user explicitly configures different agents for work vs iterate steps.

- [ ] **Dead ralph fallback** (executor.ts:303, 654): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` in cli.ts:186-204, which guarantees `agent` is set. The ternary fallback to `ctx.stepConfig.gate` is unreachable dead code.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` silently drops `pick` via the catch-all at line 357, then errors on `"criteria"` as an unknown token. Should error directly: "pick/merge/compare requires a preceding vN or vs."

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:545-683): Reimplements work/review/repeat/ralph dispatch for composition branches to use per-branch emitters instead of the global `loopEvents`. Changes to top-level executor logic must be mirrored here.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink `App` per call. Inside `executeRepeat`, this produces N mount/unmount cycles. The TUI flashes on each pass.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): The compound inner node path exits via return inside a try/finally at line 238-243, making the simple-path code at line 250 look unreachable on first read. A guard clause pattern would clarify: `if (node.inner.type !== 'work') { ... return }`.

- [ ] **`resolveCompare` error path auto-cleans without notice** (executor.ts:918-924): On compare agent failure, worktrees are forcefully removed without showing branch names for manual inspection. Compare with `resolvePick` (executor.ts:718-720), which shows `git diff` commands.

- [ ] **No TypeScript compilation verified**: None of the 15 review cycles have run `tsc`. Types like `Function` (template.ts:37,47) and non-null assertions (executor.ts:974) are not validated. A `tsc --noEmit` pass would catch latent type errors.

- [ ] **`applyAndCleanup` merge failure doesn't show worktree paths** (executor.ts:981-984): On `git merge` failure, returns without calling `cleanupWorktrees` and doesn't log worktree locations. User would need `git worktree list` to find them.

- [ ] **`RaceApp` maxIterations hardcoded to 3** (executor.ts:441): The TUI progress display always shows `/3` regardless of actual `maxIterations` on branch review nodes. Cosmetic only — doesn't affect execution.

- [ ] **Ralph doesn't distinguish inner step failure from non-convergence** (executor.ts:310-325, loop.ts:105-108): When `agentLoop` catches a step error, it returns `{ verdict: 'ITERATE' }`. Ralph only stops early on `MAX_ITERATIONS`, so a repeated step failure would cause ralph to run its gate on stale `lastMessage` each iteration until `maxTasks` is exhausted. Bounded but wasteful.

## Questions

None.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

All 4 prior high and 11 prior medium issues across 14 review cycles are confirmed resolved in the current code. The 11 low-severity items (9 carried, 2 new) are genuine but non-blocking — all fall into categories of UX polish, dead code, code duplication, and cosmetic display issues. None affect correctness or data safety. Suitable for follow-up work.
