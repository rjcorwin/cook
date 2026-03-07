# Devlog: Native Sandbox — LOW Issue Polish

**Date:** 2026-03-06
**Implementing:** plan.md (post-gate polish — addressing deferred LOW issues)

## What Was Done
- Fixed L1: `--max-iterations` now validated as a positive integer. Both `--max-iterations` flag and positional trailing number reject `0`, negative values, and non-numeric strings with a clear error message and `process.exit(1)`.
- Fixed L2: Added `--skip-git-repo-check` to native Codex invocation in `native-runner.ts`, matching Docker mode's flags in `sandbox.ts:220`. Prevents Codex from warning or failing when run in subdirectories of a git repo.
- Fixed L4: Version bumped from `1.1.2` to `1.2.0` in `package.json`. This is appropriate since the default sandbox mode changed from Docker to agent — a breaking change for existing workflows.
- Fixed L5: Both `NativeRunner.cleanup()` and `BareRunner.cleanup()` now check `proc.exitCode !== null` before sending SIGTERM and waiting. Already-exited processes are skipped immediately instead of waiting 5 seconds for a `close` event that won't fire, then pointlessly sending SIGKILL.

## Tricky Parts
- None — all four fixes were straightforward.

## Decisions Made
- L3 (config path override `agents.<name>.settings`) and L6 (OpenCode ARG_MAX) were intentionally left unaddressed. L3 is a nice-to-have feature that adds complexity for a use case nobody has requested yet. L6 affects both BareRunner and Docker mode equally and only matters for unusually large prompts (~2MB+).

## Deviations from Plan
- None. The plan didn't specify LOW issue resolution; these are voluntary polish.

## Next Steps
- None for this plan. All HIGH, MEDIUM, and actionable LOW issues are resolved. TypeScript compiles cleanly.
