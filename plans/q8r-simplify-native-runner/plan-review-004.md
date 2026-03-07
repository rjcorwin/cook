# Plan Review: Simplify Native Runner (Rev 2, Review 4)

**Reviewer:** AI
**Date:** 2026-03-07
**Reviewing:** plan.md (rev 2)

## Summary

Fourth review with fresh context and independent source verification. The plan is accurate, well-scoped, and internally consistent. All codebase claims verified: `Sandbox.runAgent(agent, model, prompt, onLine)` and `stop()` match the proposed `AgentRunner` interface exactly, Docker imports at `cli.ts:9`/`cli.ts:13`/`sandbox.ts:1-2` are correctly identified for lazy-loading, and `resolveAgentPlan()` returns `runAgents` as described. The `getRunner` callback pattern, `BareRunner extends NativeRunner` inheritance, and lazy Docker import strategy are all sound. No new high or medium concerns.

## Strengths

- **Source-verified accuracy**: Method signatures, import locations, `resolveAgentPlan()` return value, and `LoopStepConfig` structure all match the actual code
- **Minimal refactor surface**: `AgentRunner` is `Sandbox`'s existing public API with an `implements` clause — the loop's call site (`sandbox.runAgent(...)`) changes only in the parameter name
- **Clean abstraction boundary**: `getRunner(mode)` callback keeps the loop free of runner lifecycle, caching, and construction concerns
- **Correct lazy-import chain**: `sandbox.ts` has top-level `dockerode`/`tar-stream` imports, so a dynamic `import('./sandbox.js')` in the factory's `'docker'` case prevents both modules from loading in native mode
- **Inheritance over duplication**: `BareRunner` overrides a single `protected getBypassFlags()` method — all spawn logic stays in one place
- **Per-step resolution chain**: `config.steps[step].sandbox ?? config.sandbox ?? 'agent'` mirrors the existing agent/model resolution pattern

## Concerns

### High

- None

### Medium

- None

### Low

- **`'agent'` vs `'native'` naming** (carried forward, reviews 001-003): `SandboxMode = 'agent'` overlaps with `AgentName`. All three prior reviews recommend `'native'`. At this point, strongly suggest resolving this in favor of `'native'` during implementation — three consistent recommendations is a clear signal.
- **Stdin pipe lifecycle**: Plan says prompts are piped via stdin but doesn't specify closing stdin after writing. Both `claude -p` and `codex exec -` need stdin EOF to begin processing. Implementation must call `child.stdin.end()` after writing the prompt. Obvious, but worth noting.
- **Test strategy** (carried forward): No test files in the key files table. Recommend at minimum: a unit test for NativeRunner spawn/capture and a verification that `import('dockerode')` is not called in native mode.
- **Docker startup timing** (carried forward from review 003): Lazy `RunnerPool` creation moves container startup cost from before the loop to the first Docker step. Behavioral change worth documenting in the devlog.
- **`dockerode` packaging** (carried forward): Recommend keeping as regular dependency — optional peer deps add friction that contradicts the "reduce friction" goal.

## Suggestions

- Resolve `'agent'` → `'native'` during implementation — four reviews have now consistently flagged this
- Add `test/native-runner.test.ts` to the key files table

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)

No high or medium concerns across four independent reviews. The five low items are naming preferences, implementation details, and testing — all safely resolved during implementation. The plan has fully converged.
