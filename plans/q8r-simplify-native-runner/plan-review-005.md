# Plan Review: Simplify Native Runner (Rev 2, Review 5)

**Reviewer:** AI
**Date:** 2026-03-07
**Reviewing:** plan.md (rev 2)

## Summary

Fifth independent review with full source verification. All codebase claims confirmed: `Sandbox.runAgent(agent, model, prompt, onLine)` (sandbox.ts:310) and `stop()` (sandbox.ts:314) match the proposed `AgentRunner` interface exactly. Docker imports at cli.ts:9 and cli.ts:13, sandbox.ts:1-2 are correctly identified. `resolveAgentPlan()` (cli.ts:324-339) returns `runAgents` as described. `CookConfig` (config.ts:14-24) currently lacks `sandbox` — addition is straightforward. The `getRunner` callback, `BareRunner extends NativeRunner`, and lazy Docker import strategy are all sound. No new concerns found.

## Strengths

- **Verified interface compatibility**: `Sandbox` already implements `runAgent(agent, model, prompt, onLine): Promise<string>` and `stop(): Promise<void>` — adding `implements AgentRunner` is a zero-change refactor
- **Correct lazy-import analysis**: `sandbox.ts` top-level imports `dockerode` (line 1) and `tar-stream` (line 2), so dynamic `import('./sandbox.js')` in the factory prevents both from loading in native mode
- **Clean per-step resolution**: `config.steps[step].sandbox ?? config.sandbox ?? 'agent'` mirrors the existing agent/model resolution pattern already used in `resolveStepSelection` (cli.ts:311-322)
- **RunnerPool caching**: Shared Docker container across steps avoids repeated startup — critical for performance since Docker startup moves from pre-loop to first Docker step
- **Minimal blast radius**: Phase 2 changes to `loop.ts` are just a parameter type change and one call-site update; `sandbox.ts` adds an `implements` clause

## Concerns

### High

- None

### Medium

- None

### Low

- **`'agent'` → `'native'` naming**: All 5 reviews now recommend this. `--sandbox native` is unambiguous at the CLI; `'agent'` collides with `AgentName` type semantics.
- **Stdin pipe lifecycle**: `child.stdin.end()` after writing prompt is required for `claude -p` and `codex exec -` to begin processing. Obvious but unspecified.
- **Test coverage**: No test files in key files table. At minimum: NativeRunner spawn/capture, BareRunner flag injection, lazy Docker import verification.
- **Docker startup timing**: Lazy creation moves container startup to first Docker step. Behavioral change — worth noting in devlog.
- **`dockerode` packaging**: Keep as regular dependency. Optional peer deps add the friction this plan aims to remove.

## Suggestions

- Resolve `'agent'` → `'native'` at the start of implementation — it touches types and CLI help text across all files
- Consider adding `.cook/` gitignore entry in `cook init` for the logs directory (already exists in current code at cli.ts:142)

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)

Five independent reviews have converged with zero high or medium concerns. The plan is accurate, internally consistent, and ready for implementation.
