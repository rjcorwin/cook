# Devlog 002 — RPI Orchestration Session

**Date:** 2026-03-17
**Implementing:** Full RPI workflow for h5p-test-harness (research → plan → implement → pr)

## What Was Done

Ran the complete Research-Plan-Implement loop from research review through push, orchestrating subagents at each phase per CONTRIBUTING.md.

**1. Research review (`research-review-001.md`)**
Read the codebase in full (executor.ts, runner.ts, loop.ts, race.ts, parser.ts, etc.) and critiqued the existing research.md. Found a factual error (`ExecutionContext.runAgents` was described as `RunnerPool` — it's `AgentName[]`), an incorrect composition injection story (`executeBranchForComposition` already accepts `pool` as a direct parameter), and no approach decision. Also found that pure function tests were buried rather than highlighted as the starting point.

**2. Research revision (subagent)**
Subagent updated research.md in place: corrected the `runAgents` type, fixed the composition injection story, added a "Pure Functions — Start Here" section, documented `parseRalphVerdict` with its asymmetric default, added the `poolFactory` chosen approach, addressed the `loopEvents` singleton, noted `confirm()`/`pickOne()` stdin risk, added test file layout and Vitest config, and closed all 7 open questions from the code.

**3. Plan writing (subagent)**
Subagent wrote plan.md from scratch against the updated research. Covered all 13 implementation steps, Technical Design sections for every design decision (Vitest config, `ExecutionContext` change, 7 call sites, `TestRunner` implementation, temp directory pattern, `parseRalphVerdict` export, Ink mock), and exact test cases per file.

**4. Plan review (`plan-review-001.md`)**
Found two medium bugs: `CookConfig.animation: false` (invalid — `AnimationStyle` is a string union) and `CookConfig.env: {}` (invalid — it's `string[]`). Also found that the `render()` scope was understated — it affects all executor tests, not just `executeWork` tests. The plan deferred the `render()` issue to "evaluate during implementation"; the review upgraded it to a prescribed `vi.mock('ink', ...)` solution. Also flagged `buildParsedFlags` as nonexistent and `parseRalphVerdict` should be exported and tested directly.

**5. Plan revision (subagent)**
Subagent fixed all Medium and Low issues: corrected the `CookConfig` literal, added `vi.mock('ink', ...)` to Technical Design §7 and Step 9, replaced `buildParsedFlags({})` with `{} as ParsedFlags`, added exact resolver call site line numbers, clarified the `skipFirstWork` test, and adopted the export-and-test-directly approach for `parseRalphVerdict`.

**6. Implementation (subagent)**
Subagent ran all 13 steps: installed Vitest 3.2.4, created vitest.config.ts, added `"test": "vitest run"`, added `poolFactory?` to `ExecutionContext` (also required importing `RunnerPool` which wasn't previously imported), replaced 7 `createRunnerPool` call sites, created `src/testing/test-runner.ts`, exported `parseRalphVerdict`, and wrote all 5 test files. Final result: 63 tests, all passing.

**7. Code review (`code-review-001.md`)**
Subagent reviewed against plan. All 7 call sites confirmed replaced. One flagged medium (testPoolFactory using `unknown` param types) was a false positive — TypeScript contravariance makes `(x: unknown) => R` assignable to `(x: CookConfig) => R`. Three low issues: wrong comment on `parseRalphVerdict('APPROVE')` test, probabilistic `sessionId` uniqueness test, unused `SandboxMode` import.

**8. Post-review fixes**
Removed the unused `SandboxMode` import from executor.test.ts. Corrected the `parseRalphVerdict('APPROVE')` comment to say "fail-safe default" rather than "DONE-family keyword" (APPROVE is not in `RALPH_DONE_KEYWORDS`). Verified 63/63 still passing.

**9. pr.md, commit, push**
Wrote pr.md. Committed all work as a single commit (`2a77199`). Pushed to origin/add-test-harness.

**10. TODO.md**
Added a `## From h5p-test-harness run` section with 5 deferred items: composition integration tests, resolver tests, UI tests, loopEvents refactor, and the APPROVE/parseRalphVerdict question. Committed and pushed (`ea334f6`).

## Tricky Parts

- The `render()` scope issue was the most consequential catch during plan review. The plan framed it as an `executeWork`-specific problem, but every executor path involving work or review nodes calls `render()`. Without catching this, the implementer would have hit it on `executeReview`, `executeRalph`, and `executeRepeat` tests too.
- The `testPoolFactory` return type using `unknown` params looked like a TypeScript bug but is actually valid due to contravariance — a function accepting `unknown` is more permissive than one accepting `CookConfig`, so the assignment is safe in the contravariant parameter position.

## Decisions Made

- Ran each RPI phase as a fresh subagent with focused context (per CONTRIBUTING.md's context engineering principle), rather than doing everything in one pass.
- Kept the code review subagent read-only (no code execution) to separate review from fix.
- Fixed trivial post-review issues directly rather than spinning up another subagent.

## Deviations from Plan

None. All 13 plan steps were completed as specified.
