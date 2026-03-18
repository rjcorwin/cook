# Devlog 001 — Test Harness Implementation

**Date:** 2026-03-17
**Plan:** plans/h5p-test-harness/plan.md

## What Was Done

Implemented all 13 steps of the test harness plan:

1. Installed Vitest 3.2.4 as a dev dependency.
2. Created `vitest.config.ts` at the project root with `environment: 'node'` and `include: ['src/**/*.test.ts']`.
3. Added `"test": "vitest run"` to `package.json` scripts.
4. Added the optional `poolFactory?` field to `ExecutionContext` in `src/executor.ts`. This required also importing `RunnerPool` from `./runner.js`, which was not previously imported in `executor.ts` (it was only used via `ReturnType<typeof createRunnerPool>`).
5. Replaced 7 `createRunnerPool(...)` call sites with `(ctx.poolFactory ?? createRunnerPool)(...)` — 4 primary executor paths plus 3 resolver paths (`resolvePick`, `resolveMerge`, `resolveCompare`).
6. Created `src/testing/test-runner.ts` with `TestRunner`, `makeTestPool`, and `testPoolFactory`. Exported `parseRalphVerdict` from `executor.ts`.
7. Wrote `src/parser.test.ts` — 16 tests covering all parser paths.
8. Wrote `src/loop.test.ts` — 17 tests split between `parseGateVerdict` (pure, 12 tests) and `agentLoop` (5 tests using temp dirs).
9. Wrote `src/executor.test.ts` — 10 tests: 5 for `parseRalphVerdict` directly, 5 integration tests using `execute()` with mocked Ink.
10. Wrote `src/race.test.ts` — 15 tests covering `parseJudgeVerdict`, `buildJudgePrompt`, and `sessionId`.
11. Wrote `src/template.test.ts` — 5 tests covering `renderTemplate` and `loadCookMD`.

Final result: 63 tests across 5 test files, all passing. Build also passes with no TypeScript errors.

## Tricky Parts

**`RunnerPool` import in `executor.ts`:** The `poolFactory?` field type references `RunnerPool`, but `executor.ts` did not import it — it only used `ReturnType<typeof createRunnerPool>` for the `executeBranchForComposition` parameter type. Adding the explicit import was required.

**`vi.mock('ink', ...)` placement:** Vitest hoists `vi.mock()` calls regardless of where they appear in the file, but to be explicit and correct, it was placed at the top level before any other imports. The mock returns `{ render: () => ({ unmount: () => {}, waitUntilExit: async () => {} }) }`, which prevents Ink from writing to stdout/stderr or hanging in a non-TTY environment.

**`APPROVE` in `parseRalphVerdict`:** The plan described `parseRalphVerdict('APPROVE') → 'DONE' (DONE-family keyword)`, but `APPROVE` is not in `RALPH_DONE_KEYWORDS` (`['DONE', 'COMPLETE', 'FINISHED']`). The function returns `'DONE'` via the fail-safe default (no keyword matched), not via keyword matching. The test assertion is correct but the comment "DONE-family keyword" in the plan is inaccurate. The test was written to document actual behavior.

**`executeRalph` pool sharing:** `executeRalph` creates one pool for the ralph gate calls. Each inner `execute(work, ctx)` call creates a new pool via `ctx.poolFactory`. Both the outer pool and each inner work pool call `testPoolFactory`'s returned factory, which always returns the same `TestRunner` instance. Since `RunnerPool.get()` caches runners per sandbox mode, the queue-consuming behavior of `TestRunner` interleaves correctly: work calls and ralph gate calls consume from the shared queue in order.

**Template cache isolation:** `renderTemplate` uses module-level cache variables. Since Vitest runs tests within a file sequentially (not in parallel workers per test), the cache does not cause cross-contamination between tests in `template.test.ts`.

**`sessionId` collision test:** The plan notes this test is probabilistic. Two calls to `sessionId()` within the same second have a `1/1296` chance of returning the same value (4-char base36 random suffix). This is acceptable for a test suite.

## Decisions Made

**No `test.sequential` in executor tests:** The plan suggested using `test.sequential` to avoid `loopEvents` singleton cross-talk. In practice, Vitest runs all tests within a single file sequentially by default (not concurrently), so the `loopEvents` EventEmitter did not cause interference. The tests were written with `it()` rather than `test.sequential()`.

**Empty string as `cookMD` in loop tests:** The loop tests pass `''` as `cookMD` to `agentLoop`. `renderTemplate('', ctx)` returns `''`, which is a valid (empty) prompt. This avoids depending on `DEFAULT_COOK_MD` in loop tests and keeps them self-contained.

**`DEFAULT_COOK_MD` used in executor tests:** Since `DEFAULT_COOK_MD` is exported from `template.ts`, it was used as `cookMD` in `makeCtx` per the plan's recommendation.

**`parseRalphVerdict('APPROVE')` test comment updated:** The test comment reflects actual behavior (fail-safe default) rather than the plan's description (DONE-family keyword).

## Deviations from the Plan

- The plan listed line numbers for the `createRunnerPool` call sites (102, 189, 307, 451, 711, 789, 911). These shifted slightly from the plan's reference numbers due to the earlier addition of the `RunnerPool` import line. All 7 sites were correctly updated.
- `test.sequential` was not used in `executor.test.ts` (see decision above).
- The `poolFactory` type in `src/testing/test-runner.ts` uses `unknown` for `_config` and `_runAgents` parameters per the plan's template; the `ExecutionContext.poolFactory` field uses the concrete types (`CookConfig`, `AgentName[]`). These are compatible since the factory is only assigned — never called with the unknown-typed parameters.
