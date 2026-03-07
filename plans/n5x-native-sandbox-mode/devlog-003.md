# Devlog: Native Sandbox — Iteration 3

**Date:** 2026-03-06
**Implementing:** plan.md (iteration 3 — final review fixes)

## What Was Done
- Fixed M1 (OpenCode stdin compatibility in BareRunner): Changed `bare-runner.ts` so OpenCode receives the prompt as a positional CLI argument (`opencode run -m $MODEL "prompt"`) instead of piping to stdin. This matches Docker mode's invocation pattern (`sandbox.ts:222`) and the documented CLI usage in research.md. The `agentCommand` method now accepts the `prompt` parameter and passes it as the last arg with `pipeStdin: false`.
- Fixed M2 (double cleanup on rapid SIGINT): Added a `cleaning` guard in `cli.ts` to prevent concurrent cleanup calls. A second SIGINT arriving while `cleanup()` is still running now returns immediately instead of starting a parallel `cleanupAll()`.

## Tricky Parts
- M1 required threading the `prompt` parameter through `agentCommand()` since the opencode args are constructed at command-resolution time, unlike claude/codex which receive the prompt via stdin at execution time. The method signature changed from `(agent, model)` to `(agent, model, prompt)`.

## Decisions Made
- For M1, chose to pass the prompt as a direct CLI argument rather than writing to a temp file. This matches Docker mode's approach and keeps BareRunner simple. The ARG_MAX risk exists in both modes equally and only affects unusually large prompts.

## Deviations from Plan
- None. Both fixes are direct responses to review feedback.

## Next Steps
- None — all HIGH and MEDIUM issues from reviews 1 and 2 are resolved.
