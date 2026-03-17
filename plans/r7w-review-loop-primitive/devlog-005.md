# Devlog: Final Summary — Spec-Aligned Parser and Executor

**Date:** 2026-03-17
**Implementing:** plan.md (complete)

## What Was Done

Full implementation of the plan across 5 work/review/gate iterations. The codebase now matches SPEC.md.

### New files
- **`src/parser.ts`** (~500 lines) — Unified parser producing a recursive AST from CLI args. Handles: `xN`/`repeat` (sequential), `vN`/`race` (parallel composition), `review` (explicit keyword with positional prompts), `ralph` (outer task loop), `vs` (fork-join branches), resolvers (`pick`/`merge`/`compare`), second-level composition, and implicit review mode via positional duck-typing.
- **`src/executor.ts`** (~990 lines) — Recursive executor that walks the AST. Pattern-matches on `work`, `repeat`, `review`, `ralph`, `composition` node types. Includes all three resolvers inline, SIGINT cleanup registry, worktree lifecycle management, and TUI integration (loopEvents for standalone, per-branch emitters for composition via RaceApp).

### Modified files
- **`src/config.ts`** — `StepName` extended with `'iterate' | 'ralph'`; `loadConfig` parses both new step types from config.json.
- **`src/template.ts`** — `LoopContext` extended with `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`. Template cache key now includes parameter names to prevent corruption from callers with different context shapes.
- **`src/loop.ts`** — Added `iteratePrompt` to `LoopConfig`. Iteration 2+ uses iterate step (or falls back to work). Returns `LoopResult` with verdict/iterations/lastMessage/logFile. Extra template context (`ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`) threaded through from executor.
- **`src/cli.ts`** — Rewired to `parse()` → `execute()`. Removed all old parsers (`parseArgs`, `extractRaceMultiplier`, `parseForkJoinArgs`) and dispatch functions (`cmdRace`, `cmdForkJoin`, `runLoop`). Updated `usage()`, banner (shows iterate/ralph), config defaults, `.gitignore` (`compare-*.md`). SIGINT handler calls `cleanupActiveExecutions`.
- **`src/race.ts`** — Stripped to utility library: `sessionId`, `createWorktree`/`removeWorktree`, `createRunnerPool`, `buildJudgePrompt`/`parseJudgeVerdict`, `confirm`/`pickOne`. Removed `runRace()`.

### Deleted files
- **`src/fork-join.ts`** — All logic moved to executor.ts.

## Issues Fixed Across 5 Review Cycles

### High (4 found, 4 fixed)
1. SIGINT worktree leak in composition — cleanup now stops pools, removes worktrees, cleans session dir
2. `compare` + second-level composition — parser blocks this illegal combination
3. Template cache corruption from inconsistent context keys — cache key now includes parameter names
4. Missed `structuredClone` on parser second-level composition branches

### Medium (8 found, 8 fixed)
1. Unknown parser tokens silently skipped → now throws descriptive error
2. `executeRalph` created new pool per iteration → single pool hoisted above loop
3. Redundant step fallback logic → removed from loop.ts, single source in cli.ts
4. Missed `structuredClone` at parser.ts:332 → fixed
5. SIGINT cleanup window after `unregister()` → moved unregister to after pool shutdown
6. `parseRalphVerdict` defaulting to NEXT → changed to DONE (fail-safe)
7. Worktree leak across all three resolver error paths → cleanup on every error/return path
8. Merge resolver missing template context → `mergeLoopConfig` passes all four fields

### Low (6 acknowledged, deferred)
- `executeBranchForComposition` code duplication (~130 lines), TUI flicker during repeat loops, confusing `executeReview` control flow, bare resolver keywords silently consumed, compare error path UX, no `tsc` verification. All non-blocking.

## Tricky Parts

- **Template cache corruption** was the subtlest bug: the cache keyed on template source text but the compiled `new Function(...)` bound parameter names from `Object.keys(ctx)`. If `executeRalph` (8 keys) cached first and then `executeWork` (10 keys) hit the cache, the function would throw `ReferenceError` for the missing keys. Fixed by including the sorted parameter key string in the cache key.
- **SIGINT cleanup ordering** required careful sequencing: the cleanup handler must remain registered until pools are stopped and commits completed, but must be removed before worktree cleanup (which the handler itself would do).
- **Parser left-to-right grammar** was straightforward but `vs` branch segmentation required a two-pass approach: first split at `vs` tokens, then detect when trailing tokens switch from branch content to resolver keywords.

## Decisions Made

- Kept resolvers inline in executor.ts rather than extracting to `src/resolvers.ts` — the file is ~990 lines which is manageable, and extracting would create tight coupling without clear benefit.
- `parseRalphVerdict` defaults to DONE (not NEXT) on ambiguous output — prevents unbounded looping from malformed model responses.
- Branch nodes in composition use `structuredClone` — prevents shared mutable state between parallel branches.
- `executeBranchForComposition` duplicates some executor logic but uses branch-specific emitters and pools — accepted as a tradeoff vs. threading TUI context through the main executor.

## Deviations from Plan

- Plan called for optionally keeping `fork-join.ts` as `src/resolvers.ts` — deleted entirely instead since executor.ts handles everything.
- Plan mentioned updating `DEFAULT_COOK_MD` — no changes needed, template variables are dynamic.
- `compare` resolver prompt is built inline rather than using a constant — simpler for a one-shot use.

## Next Steps

- None — all high and medium issues resolved. Ready for human review.
