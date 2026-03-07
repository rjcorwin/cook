# Plan Review: Simplify Native Runner (Rev 2, Independent Review)

**Reviewer:** AI
**Date:** 2026-03-07
**Reviewing:** plan.md (rev 2)

## Summary

Independent review of the plan after verifying all claims against the source code. The plan is accurate, internally consistent, and well-scoped. All six codebase claims checked out exactly: `Sandbox.runAgent()`/`stop()` signatures match the proposed `AgentRunner` interface, top-level Docker imports are correctly identified at `cli.ts:9`/`cli.ts:13`/`sandbox.ts:1-2`, `resolveAgentPlan()` returns `runAgents` at `cli.ts:478`, and `LoopStepConfig` has the structure shown. The three medium concerns from review 001 are genuinely resolved in rev 2. No new high or medium concerns.

## Strengths

- **Source-verified accuracy**: Every claim about the existing codebase (method signatures, import locations, return values) matches the actual code
- **Right abstraction boundary**: The `getRunner` callback insulates the loop from runner lifecycle, caching, and construction details — the loop just says "give me a runner for mode X"
- **Minimal interface delta**: `AgentRunner` is literally `Sandbox`'s existing public API (`runAgent()` + `stop()`), so the refactor adds a type annotation rather than forcing a redesign
- **Correct lazy-import strategy**: Dynamic `import('./sandbox.js')` inside the factory's `'docker'` case means `dockerode` and `tar-stream` are never loaded in native mode — verified that both are top-level imports in `sandbox.ts`
- **Inheritance over duplication**: `BareRunner extends NativeRunner` with a single `getBypassFlags()` override is the right granularity — no shared utility file, no code duplication
- **Per-step resolution chain**: `config.steps[step].sandbox ?? config.sandbox ?? 'agent'` mirrors the existing pattern for per-step agent/model resolution already in the codebase

## Concerns

### High

- None

### Medium

- None

### Low

- **Startup timing shift for Docker mode**: Currently `startSandbox()` is called before the loop begins — the container is warm by the time the first step runs. With `RunnerPool` lazy creation, the first Docker-mode step pays the container startup cost inline. Not a bug, but a behavioral change users may notice as a slight delay on the first Docker step. Worth a comment in the devlog.
- **NativeRunner stderr handling unspecified**: The plan details stdout streaming via `onLine` but doesn't mention stderr. Claude CLI and Codex write progress/status info to stderr. Implementation should decide: pass stderr through to Cook's stderr (likely correct), or suppress it. Minor — the right choice is obvious, just not written down.
- **`'agent'` vs `'native'` naming** (carried forward from reviews 001/002): `SandboxMode = 'agent'` overlaps semantically with `AgentName`. `'native'` reads better in CLI usage (`--sandbox native` vs `--sandbox agent`). Still low priority.
- **Test strategy** (carried forward): No test files in the key files table. At minimum a unit test for NativeRunner spawn/capture and a check that `import('dockerode')` is not called in native mode would validate the core design claims.
- **`dockerode` packaging** (carried forward): Recommend keeping as regular dep, not optional peer dep, to avoid npm install friction.

## Suggestions

- Document the Docker startup timing change in the devlog when implementing
- Consider `'native'` over `'agent'` for the default sandbox mode — it's more intuitive at the CLI surface

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)

No high or medium concerns. The five low items are behavioral notes, implementation details, and naming preferences — all safe to resolve during implementation. The plan has converged after two review cycles and is ready for human approval.
