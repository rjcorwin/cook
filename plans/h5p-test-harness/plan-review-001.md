# Plan Review: Test Harness

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** plan.md

## Summary

The plan is well-structured and covers all the right surfaces. The injection strategy (`poolFactory` on `ExecutionContext`) is correct and the test case inventory is thorough. Two medium bugs will cause implementation failures if not fixed: a wrong `CookConfig` type in the base context helper, and a render() scope problem that's broader than the plan acknowledges. Fix these before implementation begins.

## Strengths

- Injection strategy (`poolFactory?` on `ExecutionContext`) is well-motivated and correctly derived from the codebase
- 13-step ordered implementation sequence is clear and verifiable
- `TestRunner` / `makeTestPool` / `testPoolFactory` helpers are well-designed
- `parseRalphVerdict` via observable behavior (not direct export) is the right call
- Temp directory pattern is correct
- Alternatives considered section correctly justifies rejecting `vi.mock` and the subclass approach

## Concerns

### High

None.

### Medium

- **`CookConfig` type errors in the `makeCtx` helper will cause TypeScript compile failures.** The plan specifies `config: { animation: false, env: {} }`. Both values are wrong types. `CookConfig.animation` is `AnimationStyle = 'flame' | 'strip' | 'campfire' | 'pot' | 'pulse'` — `false` is rejected by strict TypeScript. `CookConfig.env` is `string[]` — `{}` is not an array. The correct minimal config is `{ sandbox: 'agent', env: [], animation: 'strip', agent: 'claude', steps: { work: {}, review: {}, gate: {}, iterate: {}, ralph: {} } }`. These bugs will fail at Step 4 verification (`npm run build`) or at test compile time.

- **The `render()` issue affects all executor test paths, not just `executeWork`.** The plan correctly notes that `executeWork` calls `render()` but incorrectly implies that `executeReview` tests escape this. They do not: `executeReview` calls `render()` at line 252 (simple/work-inner path) and at line 206 (compound path). `executeRalph` tests also trigger `render()` because their inner node is a work node, which calls `executeWork`. `executeRepeat` tests do too. Every test in `executor.test.ts` that calls `execute()` on a node that eventually bottoms out at a `work` or `review` node will call `render()`. The plan defers this to "evaluate during implementation" — a subagent implementer will get stuck. Prescribe the solution now: add this at the top of `executor.test.ts`:
  ```typescript
  vi.mock('ink', () => ({
    render: () => ({ unmount: () => {}, waitUntilExit: async () => {} }),
  }))
  ```
  This is a known safe approach for Ink in non-TTY test environments.

### Low

- **`buildParsedFlags({})` does not exist in the codebase.** The `makeCtx` helper example references it. Either use `{} as ParsedFlags` or construct the minimal `ParsedFlags` object directly. The actual `ParsedFlags` interface should be imported from `parser.ts` and the helper should use a literal that satisfies it.

- **Step 5 says "7 replacements" but only describes the 4 primary ones in detail.** The 3 resolver call sites (`resolvePick`, `resolveMerge`, `resolveCompare`) are not tested in v1 but the plan still says to update them. This is fine, but the implementer should know that those functions receive `ctx: ExecutionContext` as a parameter — they already thread ctx through, so the substitution is identical. Consider adding the exact call site lines for the resolver functions to remove ambiguity.

- **The `skipFirstWork: true` test in `loop.test.ts`** says to "use a spy or a TestRunner with tracked responses" without specifying which. For consistency with the rest of the test plan (which avoids `vi.fn()` spies), specify that the correct approach is: supply a `TestRunner` with only 2 responses (`['review output', 'DONE']` — no work response) and `maxIterations: 1`. If the work step runs, it will consume the first response and the gate step will receive `'DONE'` but also shift the response list incorrectly. Alternatively, count that the runner's queue has exactly the right number of elements consumed. Clarifying this prevents ambiguity for the implementer.

## Suggestions

- Export `parseRalphVerdict` from `executor.ts` and test it directly. The plan rejects this to avoid "public API surface", but this function is not part of any external API — it's in a CLI tool, not a library. Testing it via behavior adds indirection and makes the test less readable. Export it. The "too much surface area" argument doesn't apply here.
- Consider adding `src/testing/test-runner.ts` to `tsconfig.json`'s include path or verifying that the test file imports work with `NodeNext` module resolution (`.js` extension on imports). This is a known friction point.

## Recommendation

[x] Needs revision (see concerns/suggestions above)

The two Medium bugs are blocking — one causes TypeScript compile failure, the other will cause an implementer subagent to get stuck on `render()`. Fix those, address the `buildParsedFlags` naming issue, and the plan is ready for implementation.
