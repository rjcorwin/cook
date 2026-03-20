# Code Review: Test Harness

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** executor.ts, testing/test-runner.ts, parser.test.ts, loop.test.ts, executor.test.ts, race.test.ts, template.test.ts, vitest.config.ts, package.json

## Summary

The implementation follows the plan faithfully. All 7 `createRunnerPool` call sites are replaced, the `poolFactory` seam is correctly typed in `ExecutionContext`, `vi.mock('ink', ...)` is at the top level of `executor.test.ts`, all imports use `.js` extensions, `parseRalphVerdict` is exported and tested directly, and no test path can reach a real LLM. One type-compatibility issue exists between `testPoolFactory`'s return type and `ExecutionContext.poolFactory` that TypeScript will accept in practice (assignability in one direction only), and one test assertion documents behavior that the plan's comment misdescribes — both are low severity. One plan-required test case (`parseRalphVerdict('APPROVE')` as DONE-family keyword) documents incorrect behavior relative to the plan's comment but the actual assertion is correct. The devlog accurately records all deviations.

## What Works Well

- All 7 `createRunnerPool` call sites are correctly replaced with `(ctx.poolFactory ?? createRunnerPool)(...)`. Verified at lines 105, 192, 310, 454, 714, 792, 914 of `executor.ts`.
- `vi.mock('ink', ...)` appears at lines 3–5 of `executor.test.ts`, before any imports, satisfying the top-level hoisting requirement.
- Every import of a local module in every test file uses the `.js` extension (`./parser.js`, `./loop.js`, `./executor.js`, `./race.js`, `./template.js`, `./testing/test-runner.js`), which is required for `moduleResolution: NodeNext`.
- `parseRalphVerdict` is exported from `executor.ts` (line 372: `export function parseRalphVerdict`) and has 5 direct unit tests in `executor.test.ts` that match the plan's specified cases exactly.
- The `testPoolFactory` return value is a function `() => RunnerPool`, and `ExecutionContext.poolFactory` expects `(worktreePath: string, config: CookConfig, runAgents: AgentName[]) => RunnerPool`. These are assignment-compatible in TypeScript: a function that ignores its parameters is assignable to a type that declares parameters, so `poolFactory: testPoolFactory(runner)` compiles without error.
- No test file imports a real runner implementation (`NativeRunner`, `DockerRunner`). The `ink` module is fully mocked in the one file that imports it transitively. No path through any test can reach a real LLM.
- `vitest.config.ts` matches the plan's specification exactly.
- `"test": "vitest run"` is present in `package.json` scripts.
- Temp directory lifecycle (`mkdtempSync` in `beforeEach`, `rmSync` in `afterEach`) is used correctly in all three test files that write to disk (`loop.test.ts`, `executor.test.ts`, `race.test.ts`, `template.test.ts`).
- The `makeCtx` helper in `executor.test.ts` centralizes context construction and matches the plan's specified field values.
- `RunnerPool` is now imported explicitly in `executor.ts` (line 15), which is required for the `poolFactory` field type annotation — the devlog correctly notes this was an addition.

## Issues

### High

- None.

### Medium

- [ ] **`testPoolFactory` return type uses `unknown` for `_config` and `_runAgents`; `ExecutionContext.poolFactory` uses concrete types.** The factory declared in `test-runner.ts` is `(_worktreePath: string, _config: unknown, _runAgents: unknown) => RunnerPool`. The field in `ExecutionContext` is `(worktreePath: string, config: CookConfig, runAgents: AgentName[]) => RunnerPool`. A function `(x: unknown) => R` is *not* assignable to `(x: CookConfig) => R` in TypeScript's strict function parameter checks — the direction of assignability is reversed for parameter types (contravariance). TypeScript would reject `poolFactory: testPoolFactory(runner)` at the call site because `unknown` is wider than `CookConfig`. This may be masked because `makeCtx` uses `...overrides` spread and `poolFactory` is optional, but any direct typed assignment `const ctx: ExecutionContext = { ..., poolFactory: testPoolFactory(runner) }` would fail. The devlog notes this and claims it is only assigned, never called with the unknown-typed parameters, but TypeScript checks structural compatibility at assignment, not call sites. **The implementation is likely passing a TypeScript build only because `makeCtx` constructs the object literal without an explicit annotation on the `poolFactory` field** (it relies on inference rather than checking against the declared type). Changing `testPoolFactory`'s signature to use the concrete types `CookConfig` and `AgentName[]` would make this unambiguously correct.

### Low

- [ ] **`parseRalphVerdict('APPROVE')` test comment says "DONE-family keyword" but `APPROVE` is not in `RALPH_DONE_KEYWORDS`.** `RALPH_DONE_KEYWORDS = ['DONE', 'COMPLETE', 'FINISHED']`. `APPROVE` does not match, so the function falls through to the fail-safe `return 'DONE'`. The assertion (`toBe('DONE')`) is correct; the comment is misleading. The devlog acknowledges this. The test could be renamed to `'returns DONE for "APPROVE" via fail-safe default (not a DONE keyword)'` to be accurate, but this is a comment-only issue.
- [ ] **`sessionId` uniqueness test is probabilistic.** Two calls in the same second have a `1/1296` chance of collision, which would cause a spurious test failure. The plan acknowledges this; the risk is low but it is a flaky test pattern. A `vi.spyOn(Math, 'random')` approach would eliminate the flakiness entirely if this ever becomes a problem.
- [ ] **`loop.test.ts` passes `''` as `cookMD` and `''` as `projectRoot` in `makeLoopConfig` default.** The `projectRoot: ''` default in `makeLoopConfig` is overridden in every actual test via the `makeLoopConfig({ projectRoot: tmpDir, ... })` call pattern, so no test actually uses the empty string for disk writes. However, the default silently papers over a required field, which could hide a bug if a test is added that forgets to pass `projectRoot`. This is a minor style concern.
- [ ] **`executor.test.ts` imports `SandboxMode` from `./runner.js` but never uses it directly.** Line 15: `import type { SandboxMode } from './runner.js'`. This import appears unused — `SandboxMode` is not referenced in the file body. TypeScript's `verbatimModuleSyntax` would emit it as a type-only import with no runtime cost, but it is dead code.

## Questions

- The plan specified `test.sequential` for `executor.test.ts` to avoid `loopEvents` singleton cross-talk. The devlog explains that Vitest runs tests within a file sequentially by default. Is this guaranteed by Vitest's documented behavior, or an implementation detail? If a future Vitest version changes this (e.g., with worker threads per test), the `loopEvents` singleton could cause cross-test interference. Low risk for now, but worth noting if tests start failing non-deterministically.
- `makeCtx` in `executor.test.ts` accepts `tmpDir` as a positional parameter (not via overrides), which differs slightly from the plan's `makeCtx(runner, overrides?)` signature. The actual signature is `makeCtx(runner, tmpDir, overrides?)`. This works fine and is arguably cleaner, but is worth documenting as a deviation in the devlog (it is not currently listed there).

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

The medium issue with `testPoolFactory`'s parameter types is worth fixing for correctness, but the current implementation is likely passing TypeScript compilation due to inference at the object literal in `makeCtx`. If `npm run build` passes, this is not blocking. The low issues are all cosmetic or negligible in risk. No high issues were found.
