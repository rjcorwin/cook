# Plan Review: Simplify Native Runner (Rev 2)

**Reviewer:** AI
**Date:** 2026-03-07
**Reviewing:** plan.md (rev 2, addresses plan-review-001)

## Summary

Rev 2 cleanly resolves all three medium concerns from plan-review-001. The `getRunner` callback pattern keeps the loop decoupled from `RunnerPool` internals, the Docker factory closure captures `runAgents` naturally, and `BareRunner extends NativeRunner` eliminates spawn logic duplication with a single method override. The plan is now internally consistent and ready for implementation.

## Strengths

- **`getRunner` callback pattern**: Clean separation — `agentLoop` doesn't depend on `RunnerPool` or `SandboxMode` semantics, it just calls a function. The pool handles caching transparently. This is the right abstraction boundary.
- **Docker agent list via closure**: The factory captures `runAgents` from `resolveAgentPlan()` — the same list already computed today (confirmed at `cli.ts:478`). No new data flow needed; the factory just closes over what's already there.
- **Inheritance for BareRunner**: Single override (`getBypassFlags`) is the right granularity. NativeRunner owns all spawn logic, BareRunner only adds the bypass flags. No shared utility files, no duplicate code.
- **Codebase alignment verified**: All claims checked against source — `Sandbox.runAgent()` and `stop()` signatures match the proposed `AgentRunner` interface exactly, import sites for lazy loading are correctly identified (`cli.ts:9`, `cli.ts:13`, `sandbox.ts:1-2`), and `resolveAgentPlan()` returns `runAgents` as described.
- **Per-step sandbox resolution chain**: `config.steps[step].sandbox ?? config.sandbox ?? 'agent'` is clear and matches the existing pattern for per-step agent/model resolution.

## Concerns

### High

- None

### Medium

- None — all three medium concerns from plan-review-001 are resolved

### Low

- **`SandboxMode = 'agent'` naming**: Carried forward from review 001. The value `'agent'` could be confused with `AgentName` (claude/codex/opencode). `'native'` would be clearer. Minor — can be decided during implementation.
- **Testing strategy unspecified**: Phase 4 says "test all three modes end-to-end" but doesn't specify what tests or where they live. No test files in the key files table. At minimum, a smoke test that NativeRunner spawns and captures output would validate the core path. Not blocking — can be figured out during implementation.
- **`dockerode` dependency handling**: Phase 4 item 11 is still ambiguous ("optional peer deps or keep as deps"). Recommend keeping as regular deps — optional peer deps add `npm install` friction, which contradicts the "reduce friction" goal.

## Suggestions

- Consider renaming `'agent'` to `'native'` for the default sandbox mode to avoid confusion with `AgentName`. The CLI flag would read `--sandbox native` which is also more intuitive.
- Add a test file to the key files table (e.g., `test/native-runner.test.ts`) even if the test strategy is minimal.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)

No high or medium concerns remain. The three low items are naming preferences, testing details, and dependency packaging — all safe to resolve during implementation without plan changes.
