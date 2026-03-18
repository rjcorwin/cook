# Code Review: Align Implementation to SPEC.md (Review 6)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/config.ts, src/template.ts, src/loop.ts, src/cli.ts, src/race.ts (full implementation against plan.md)

## Summary

Fresh independent review of the complete implementation after 5 prior review/fix cycles. The parser correctly implements the full spec grammar — work, xN/repeat, vN/race, review, ralph, vs, resolvers, and second-level composition. The recursive executor cleanly pattern-matches on AST node types and threads context (lastMessage, repeat/ralph counters) through the tree. All 4 prior high issues and 8 prior medium issues are confirmed resolved. One new medium issue found: ralph does not enforce the planned safety check when the inner review loop fails to converge (MAX_ITERATIONS). Seven low issues remain, one new.

## What Works Well

- **Parser grammar coverage is complete**: All spec forms parse correctly — bare work, implicit review via positional prompts, explicit `review` keyword, `xN`/`repeat N`, `vN`/`race N`, `vs` branches, `ralph`, `pick`/`merge`/`compare` resolvers, second-level composition. Unknown tokens throw descriptive errors (parser.ts:363).
- **AST design is clean**: Five node types (`work`, `repeat`, `review`, `ralph`, `composition`) with recursive `inner` fields. `structuredClone` used consistently for branch copies (parser.ts:292, 332, 476).
- **Executor dispatches correctly**: `execute()` (executor.ts:72-85) is a clean switch on node type. Each handler manages its own pool lifecycle with `registerCleanup`/`unregister`.
- **Template cache fix confirmed in place**: Cache key includes `paramKey` (Object.keys join) so different context shapes cause recompilation (template.ts:44-48).
- **SIGINT cleanup lifecycle correct**: `unregister()` at executor.ts:484 is placed after pool shutdown and commits, keeping the cleanup handler active throughout the critical section.
- **Ralph fail-safe default to DONE** (executor.ts:367-368): Ambiguous gate output stops rather than loops unboundedly.
- **Compare + second-level composition guard**: Parser blocks second-level composition when resolver is `compare` (parser.ts:314, 457-458).
- **Config correctly extended**: `StepName` includes `iterate` and `ralph` (config.ts:8). `loadConfig` parses both with proper fallback chain. `resolveStepSelection` in cli.ts:179-205 handles iterate→work and ralph→gate fallbacks.
- **LoopConfig passes full context**: All `LoopConfig` constructions (executor.ts:218-230, 262-274, 585-596, 777-788) include `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`.
- **Resolver error path cleanup confirmed**: All three resolvers clean up worktrees on every error/early-return path (resolvePick:694-701/707-713, resolveMerge:793-803, resolveCompare:888-896).
- **Usage docs updated** (cli.ts:58-97): All new commands and flags documented.
- **Banner includes iterate/ralph** (cli.ts:411-412).

## Issues

### High

(None)

### Medium

- [ ] **Ralph does not check inner loop verdict before running gate** (executor.ts:309-348, 622-654). The plan (Implementation Steps, Step 5, Ralph node) and research.md (Q10) both specify: "If inner loop hit max iterations without DONE → stop ralph with warning." The implementation always runs the ralph gate after inner execution regardless of `result.verdict`. When the inner review loop returns `MAX_ITERATIONS`, ralph should stop with a warning rather than delegating the convergence decision to the gate agent. The research explicitly states: "If the inner loop can't converge, blindly advancing is dangerous." Fix: after `execute(node.inner, ...)`, check `if (result.verdict === 'MAX_ITERATIONS') { logWarn(...); return result }`. Same pattern needed in `executeBranchForComposition` ralph case (lines 622-654).

### Low

- [ ] **Bare resolver keywords without composition silently consumed** (parser.ts:356-359): `cook "work" pick` discards `pick` with no error. An error like "pick/merge/compare requires a preceding vN or vs" would be clearer. Carried from code-review-004.

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:530-662): Reimplements work/review/repeat/ralph dispatch for composition branches with per-branch emitter and shared pool. Future changes to executor logic must be mirrored in both locations. Carried from code-review-001.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles with visible flicker. Carried from code-review-001.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the code returns from inside a `try/finally` block (lines 237-242), making the "simple case" code at lines 249-291 appear unreachable on first read. Logic is correct but structure is non-obvious. Carried from code-review-002.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:888-896): Unlike `resolvePick` which prompts before cleanup, `resolveCompare` silently removes worktrees on error. The branch work succeeded (only the comparison agent failed), so users might want to inspect branches. Carried from code-review-005.

- [ ] **No TypeScript compilation verified**: None of the six implementation/fix cycles ran `tsc`. Carried from code-review-001.

- [ ] **`applyAndCleanup` merge failure doesn't mention worktrees** (executor.ts:949-955): When `git merge` fails (e.g., conflict), the function logs `git status` but doesn't tell the user about the worktree branch names or paths. The worktrees remain on disk with no guidance on cleanup. The user needs to know which branches exist and where the worktrees are.

## Verification of Prior Fixes

All 4 high issues from prior reviews confirmed resolved:
1. **SIGINT worktree cleanup** (code-review-001) — `registerCleanup` at executor.ts:437-446 stops all pools, removes all worktrees, cleans session dir
2. **Compare + second-level composition guard** (code-review-001) — parser.ts:314, 457-458
3. **Template cache corruption** (code-review-002) — template.ts:44-48 `paramKey` check
4. **Ralph fail-safe** (code-review-002) — executor.ts:367-368 defaults to DONE

All 8 medium issues from prior reviews confirmed resolved:
1. Unknown tokens error (code-review-001) → parser.ts:363
2. Ralph pool per iteration (code-review-001) → single pool hoisted at executor.ts:305
3. Redundant fallback logic (code-review-001) → removed from loop.ts
4. Missed `structuredClone` (code-review-002) → parser.ts:332
5. SIGINT cleanup window (code-review-002) → `unregister()` moved to executor.ts:484
6. `parseRalphVerdict` fail-open (code-review-002) → defaults to DONE at executor.ts:368
7. Worktree leak on resolver error paths (code-review-004) → all three resolvers now clean up
8. Merge resolver missing template context (code-review-004) → executor.ts:784-787

## Questions

None.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see medium issue above)

The ralph inner-loop convergence check is a planned safety feature with an explicit rationale in the research ("blindly advancing is dangerous"). It's a straightforward 3-line fix in two locations. Once addressed, the implementation is ready for human review.
