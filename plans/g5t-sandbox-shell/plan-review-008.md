# Plan Review: `cook shell` Rev 003 (Architecture & Design)

**Reviewer:** AI (Review 8 -- Round 3)
**Date:** 2026-03-27
**Reviewing:** plan-003.md

## Summary

Rev 003 addresses every high and medium concern from the prior architecture review (plan-review-005). The `agents` parameter gap is resolved by passing `[config.agent]`, the `spawnSync` concern is resolved in favor of async `spawn` with a Promise wrapper, the dynamic import of `child_process` is gone (the plan now notes using the existing top-level import), and `--help` interception is explicitly handled. The verbose parameter approach and `hasCommandOnPath` export are the two remaining design decisions worth examining, but neither is a blocker.

## Strengths

- The `agents: [config.agent]` resolution is pragmatic and well-reasoned. It gives the shell session network rules that match the project's configured agent, which is the right default -- users who enter the shell may well want to invoke the agent manually. This directly closes the prior review's only high-severity concern.
- `Sandbox.shell()` remains clean. It encapsulates container ID, user spec, env, and working directory. The CLI layer gets back an exit code and nothing else. The TTY detection (`process.stdin.isTTY`) choosing between `-it` and `-i` is correct.
- The switch from `spawnSync` to async `spawn` + Promise is the right call. The plan explicitly documents why in the "Alternatives Considered" section, which is good for future maintainers.
- The two-phase container collision logic (check for running containers, then let `startSandbox` clean up stale ones) is now implicitly documented in the plan's step-by-step `cmdShell` pseudocode (steps 6-7). The distinction between "refuse if running" and "clean up if stopped" is clear.
- `--help` is intercepted in step 1 of `cmdShell` before any Docker work, resolving the prior review's low-severity concern.

## Concerns

### High

- None.

### Medium

- **The `verbose` parameter threading through `startSandbox` -> `ensureBaseImage` -> `buildImage` is functional but slightly misplaced.** The prior review suggested exporting `ensureBaseImage` and calling it from `cmdShell` directly to keep the presentation concern in the CLI layer. Rev 003 instead adds `verbose?: boolean` as an optional parameter that propagates through the call chain. This works and is backward-compatible (defaults to false), but it means `startSandbox` -- a domain function responsible for container lifecycle -- now carries a UI concern. The current `ensureBaseImage` on line 73 of `sandbox.ts` already hardcodes `verbose: false` in its `buildImage` call. Adding a `verbose` parameter means changing that to pass-through. The practical risk is low (it is a boolean, not a rendering strategy), but the alternative of exporting `ensureBaseImage` is worth noting as cleaner if `startSandbox` ever grows more optional parameters. The plan's approach is acceptable for a v1 -- just be aware it is a minor layering violation that could compound if more presentation flags are added later.

- **Exporting `hasCommandOnPath` from `cli.ts` creates a small dependency direction concern.** `cli.ts` is the top-level entry point (it has the `#!/usr/bin/env node` shebang, the `process.argv` parsing, the `main()` function). Importing from `cli.ts` into `shell.ts` means a utility module imports from the application entry point. The plan acknowledges this with "or move it to a shared util if that's cleaner" -- and moving it is indeed cleaner. `hasCommandOnPath` along with its helpers (`commandCandidates`, `isRunnableFile`, `stripSurroundingQuotes`) form a self-contained utility that belongs in something like `src/util.ts` or `src/path-util.ts`. This is not blocking -- Node.js handles the circular-ish import fine since `shell.ts` is dynamically imported -- but it is the kind of thing that becomes confusing when a third consumer appears. Recommend moving to a shared module during implementation rather than deferring it.

### Low

- **The `hasCookContainer` function uses dockerode's `listContainers` with label and status filters, but `cleanupStaleContainers` (line 126-137) uses `docker.listContainers({ all: true })` with manual label filtering.** These two functions would benefit from sharing a consistent filtering approach. Not a design issue for the plan, but worth noting for implementation to avoid subtle divergence in how containers are identified.

- **`Sandbox.shell()` hardcodes `HOME=/home/cook` (line 57 of the plan's code sample), duplicating knowledge that also exists in `copyAuthFiles` and `containerExec` setup.** This is existing technical debt in `sandbox.ts` (the `/home/cook` path appears in multiple places), not introduced by the plan, but shell mode adds one more occurrence. A `CONTAINER_HOME` constant would reduce drift risk.

## Suggestions

- Move `hasCommandOnPath` and its helpers to a shared utility module during implementation rather than exporting from `cli.ts`. This keeps the dependency graph clean (entry point imports from modules, not the reverse).
- Consider extracting a `CONTAINER_HOME = '/home/cook'` constant in `sandbox.ts` while adding `Sandbox.shell()`, since you will be editing the file anyway. Low effort, reduces string duplication.
- If a second presentation-related parameter is ever needed on `startSandbox`, refactor to an options object at that point. For now, the single `verbose?: boolean` is tolerable.

## Recommendation

[x] Ready for human review
[ ] Needs revision

Rev 003 has resolved all prior high and medium architecture concerns. The remaining items (verbose parameter layering, hasCommandOnPath location) are implementation-level refinements that do not affect the overall design. The plan is ready for implementation.
