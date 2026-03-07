# Plan Review: Simplify Native Runner (Human Review)

**Reviewer:** Human (via AI assist)
**Date:** 2026-03-07
**Reviewing:** plan.md (rev 2)
**Gate:** 2:Human:Review per CONTRIBUTING.md

## Summary

The plan is solid and well-scoped. The runner abstraction is clean, the `getRunner` callback keeps the loop decoupled, and `BareRunner extends NativeRunner` is elegant. All 5 AI reviews converged with zero high/medium concerns, and I verified the codebase claims independently. Ready for implementation with one required change and a few notes.

## Verified Claims

- `Sandbox.runAgent(agent, model, prompt, onLine)` and `stop()` match proposed `AgentRunner` interface exactly
- Docker imports at cli.ts:9, cli.ts:13, sandbox.ts:1-2 correctly identified
- `resolveAgentPlan()` returns `runAgents` as described
- `CookConfig` lacks `sandbox` field — addition is straightforward
- Docker spawn commands include `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` because Docker IS the sandbox; NativeRunner correctly omits these since the agent manages its own OS sandbox

## Required Change

**Rename `'agent'` → `'native'`**: All 5 reviews unanimously recommend this. `--sandbox agent` is confusing because `agent` already refers to Claude/Codex/OpenCode. `--sandbox native` is immediately clear. This touches:
- `SandboxMode` type
- CLI `--sandbox` flag values and help text
- Default config value
- RunnerPool factory switch cases

Resolve this at the start of Phase 1.

## Notes for Implementation

1. **`child.stdin.end()`** after writing prompt — required for `claude -p` and `codex exec -` to begin processing
2. **Test files**: Add at minimum `test/native-runner.test.ts` (spawn/capture) and `test/bare-runner.test.ts` (flag injection). Consider a test verifying `dockerode` is not imported in native mode.
3. **Docker startup timing**: Lazy creation moves container startup from pre-loop to first Docker step. Document in devlog.
4. **Keep `dockerode` as regular dep** — optional peer deps add the friction this plan aims to eliminate
5. **Error messaging**: If agent CLI not found on PATH in native mode, give a clear error pointing to `cook doctor`

## Recommendation

[x] Approved for implementation (with `'agent'` → `'native'` rename)
[ ] Needs revision
