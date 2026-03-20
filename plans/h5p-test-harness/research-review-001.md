# Research Review: Test Harness

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** research.md

## Summary

The research correctly identifies the major testing surfaces and the right tool (Vitest), but it contains a factual error about `ExecutionContext`, understates how clean the composition injection story already is, and fails to pick an approach — leaving planning with no clear decision to execute on. The document also buries the fastest wins (pure function tests) beneath infrastructure concerns that don't affect them. The overall analysis is sound; the gaps are in precision and decisiveness.

## Strengths

- Correctly identifies `AgentRunner` / `RunnerPool` as the primary injection seam
- `TestRunner` mock design is correct and minimal
- Vitest recommendation is right: native ESM, no transform overhead, TypeScript-first
- `agentLoop` being injectable via `getRunner` callback is correctly noted
- Correctly flags `loopEvents` singleton as a parallel-test hazard
- Covers all major AST node types (work, repeat, review, ralph, composition)

## Gaps

### High

- **Factual error in `ExecutionContext` description.** The research states `ExecutionContext` carries `runAgents: RunnerPool`. It does not. `runAgents: AgentName[]` is a plain array of agent name strings, passed into `createRunnerPool()` to know which Docker images to prepare. There is no `RunnerPool` in `ExecutionContext` at all. Every `executeWork`, `executeReview`, `executeRalph` call creates a pool internally via `createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)` from `race.ts`. This error must be corrected before planning — the injection seam is in `race.createRunnerPool`, not `ExecutionContext.runAgents`.

- **Composition injection is already parameterized — the research misses this.** `executeBranchForComposition` already accepts `pool` as a direct function parameter (line 548: `pool: ReturnType<typeof createRunnerPool>`). The composition executor creates pools in `executeComposition` (line 451: `const pools = worktrees.map(wt => createRunnerPool(...))`) and passes them in. The injection story for composition branches is: control how `createRunnerPool` is called in `executeComposition`, and branches get the injected pool automatically. This is cleaner than the research implies.

- **No approach is chosen.** Three options are listed (Fake CLI binary, Interface injection, RunnerPool subclass) but none is recommended. Planning cannot begin without a decision. The code makes the answer obvious: **add a `poolFactory` field to `ExecutionContext`**, defaulting to `createRunnerPool`. Tests pass `() => new RunnerPool(async () => testRunner)`. One field. No subclass. No binary. This covers `executeWork`, `executeReview`, `executeRalph`, and — because `executeComposition` also calls `createRunnerPool` via this same pattern — compositions too.

- **The fastest test wins are underemphasized.** `parseGateVerdict`, `parseRalphVerdict`, `parseJudgeVerdict`, `buildJudgePrompt`, `parse()`, and `renderTemplate()` are pure functions requiring zero mocking, zero infrastructure, zero framework debate. Roughly 80% of the critical business logic is reachable this way. The research mentions parser and template briefly but doesn't frame these as "start here, today, unconditionally."

### Medium

- **`parseRalphVerdict` is absent from the research entirely.** It is a pure function with an important asymmetry: when no verdict keyword is found, it defaults to `'DONE'` (fail-safe stop), while `parseGateVerdict` defaults to `'ITERATE'` (fail-safe continue). This behavioral difference is exactly the kind of thing that needs a test. Missing it from the analysis is a gap.

- **`loopEvents` singleton has a clean workaround that the research undersells.** `agentLoop` already accepts `events: EventEmitter` as a parameter — tests that call `agentLoop` directly supply their own emitter and the singleton is never touched. The singleton only matters for tests that go through the executor path (`executeWork`, `executeReview`). Mitigation: run those tests serially via `test.sequential` in Vitest. No refactor needed in v1.

- **`confirm()` and `pickOne()` in `race.ts` read from `process.stdin`.** Tests that exercise the full composition resolver flow (`resolvePick` with no auto-pick, `resolveCompare`) will hang waiting for input. This needs a mock or the tests need to exercise only the auto-resolve paths. Not mentioned in the research.

- **No proposed test file layout or Vitest config.** Where do tests live? Co-located `*.test.ts` next to source, or a top-level `test/` directory? What does `vitest.config.ts` look like for a `NodeNext` module resolution project? These are unresolved decisions that will block the start of implementation.

- **Open questions at the bottom duplicate the ones in Requirements without resolving them.** The body of the research was supposed to answer those questions. At minimum, questions 1–3 are answerable from the code and should be closed out.

### Low

- **`line-buffer.ts` is trivially testable** and not mentioned. It is the kind of file you write five tests for in ten minutes. Not critical, but it fills out coverage.
- **The `Function` constructor in `template.ts`** is not mentioned. It's an unusual choice worth a brief note — it's not a security concern in this context but it does affect testability (template errors surface as runtime exceptions, not TypeScript errors).
- **`sessionId()` in `race.ts`** is a pure function with a random component — easy to test the format, harder to test the randomness. Worth a sentence.

## Questions

- Should `ExecutionContext` gain a `poolFactory` field, or should injection happen at a higher level (e.g., a wrapper that replaces `createRunnerPool` at the module level via Vitest's `vi.mock`)? The former requires one small code change; the latter requires zero code changes but is more fragile.
- Is there a preference for test co-location (`src/parser.test.ts`) vs. a top-level `test/` directory? This affects the Vitest config and import paths.
- Are composition integration tests in scope for v1? If yes, the plan needs a section on temp git repo setup. If no, the plan should explicitly say so rather than leaving it as an open question.

## Recommendation

[x] Needs revision (see gaps/questions above)

The factual error and missing approach decision are blocking. Suggested path before planning:

1. Correct the `ExecutionContext.runAgents` description.
2. Decide on the injection mechanism. The clear answer from the code: add `poolFactory?: (...) => RunnerPool` to `ExecutionContext`, replacing direct `createRunnerPool(...)` calls. Document this as the decision.
3. Close out open questions 1–3 from the Requirements section — the code answers them.
4. Add `parseRalphVerdict` to the pure function inventory.
5. Explicitly recommend skipping composition integration tests for v1 (or explicitly include them with a git temp-repo setup plan).

If the decision on injection approach is made now (not in planning), the research is ready for human review after a focused revision pass.
