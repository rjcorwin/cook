# Plan Review: Simplify Native Runner

**Reviewer:** AI
**Date:** 2026-03-07
**Reviewing:** plan.md

## Summary

The plan is well-scoped and cleanly layered. It correctly identifies that the existing `Sandbox` class already has the exact interface needed (`runAgent()` + `stop()`), making the refactor minimal. The four-phase approach is sequenced correctly, and the decision to drop agent config management (from the n5x plan) keeps complexity low. Two medium concerns need clarification before implementation: the per-step sandbox override mechanism contradicts the `agentLoop` signature, and `startSandbox()` needs its multi-agent pre-configuration preserved.

## Strengths

- **Minimal interface extraction**: The `AgentRunner` interface matches the existing `Sandbox` class 1:1 — no forced API changes
- **Lazy Docker import**: Correctly identifies both `src/sandbox.ts` (line 1) and `src/cli.ts` (line 9) as top-level import sites; the dynamic `import()` pattern will cleanly eliminate the Docker dependency for native users
- **Clear rejection of n5x complexity**: No TOML parser, no config isolation, no permission constants — the right scope cut
- **Per-step sandbox overrides**: Useful for workflows like "code in Docker, review natively" — this adds flexibility without architectural cost
- **OpenCode blocking**: Correct security call — advisory permissions without OS-level enforcement gives false safety

## Concerns

### High

- None

### Medium

- **Per-step override vs. agentLoop signature**: The plan's `agentLoop` signature takes `runner: AgentRunner` (a single runner), but per-step sandbox overrides (`steps.work.sandbox: "docker"`) require access to the `RunnerPool` inside the loop. Either `agentLoop` needs to accept `RunnerPool` instead of a single `AgentRunner`, or the CLI needs to resolve per-step runners and pass them in a different structure (e.g., a map of step→runner). The current plan is internally inconsistent on this point.

- **`startSandbox()` multi-agent parameter**: The current `startSandbox()` signature is `startSandbox(docker, projectRoot, config, agents: AgentName[])` — it takes the full list of agents to pre-copy auth files for all of them into the container. The plan says "factory function stays as-is" but the `AgentRunner` interface and `RunnerPool` pattern don't account for this pre-configuration step. Need to clarify: does the Docker runner get created once with all agents, or created per-step? If once, who provides the agent list to the factory?

- **NativeRunner and BareRunner code sharing**: Both spawn agents identically except for bypass flags. The plan creates two separate files (`native-runner.ts`, `bare-runner.ts`) without specifying how they share spawn logic. A base class or shared helper would prevent duplication. Clarify the relationship.

### Low

- **`SandboxMode = 'agent'` naming**: The value `'agent'` could be confused with `AgentName` (claude/codex/opencode) since both concepts use "agent". Consider `'native'` for clarity. Minor naming concern.
- **Testing**: Phase 4 says "test all three modes end-to-end" but doesn't detail what constitutes a test. No test files mentioned in the key files table. Consider at minimum: a smoke test that NativeRunner spawns and captures output, and that the lazy import path works (Docker not imported when mode is native).
- **`dockerode` as optional dependency**: Phase 4 item 11 mentions either optional peer deps or keeping as regular deps. Recommend keeping as regular deps with documentation — optional peer deps add npm install complexity that contradicts the "reduce friction" goal.

## Suggestions

- Change `agentLoop` to accept `RunnerPool` (or a `getRunner: (mode: SandboxMode) => Promise<AgentRunner>` callback) so per-step overrides work naturally. The loop already resolves per-step agent/model from config — it can similarly resolve per-step sandbox mode.
- Have `BareRunner` extend `NativeRunner` with a `protected getFlags()` override, or extract a shared `spawnAgent()` utility both call.
- Keep `dockerode` as a regular dependency to avoid peer-dep friction.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)

The medium concerns are real but addressable during implementation without changing the plan's overall structure. The per-step override mechanism needs a quick design decision (pool in loop vs. pre-resolved map) but won't alter the phased approach.
