# Plan Review: `cook shell` Rev 003 (Correctness & Feasibility)

**Reviewer:** AI (Review 7 -- Round 3)
**Date:** 2026-03-27
**Reviewing:** plan-003.md

## Summary

Revision 003 directly addresses all high and medium concerns from review 004. The `spawnSync` blocking issue is fixed with `spawn` + promise. The `agents` parameter is specified as `[config.agent]`. The `ensureBaseImage` verbose propagation chain is explicitly called out. The `--help` and `--unrestricted` flag parsing are described. The dockerode filter syntax for the collision check is shown. One feasibility gap remains: `ensureBaseImage` currently takes only `(docker: Docker)` as parameters, and the plan's verbose propagation chain requires adding a second parameter -- this is straightforward but the plan should note it changes a non-exported internal function signature. There are no remaining high-severity concerns.

## Strengths

- The `spawn` + promise pattern (lines 66-71 of the plan pseudocode) is correct. The `error` event listener handles the case where the `docker` binary is not found (ENOENT), and `close` with `code ?? 1` handles both normal exit and signal-killed processes. This resolves the blocking high concern from review 004.
- The `agents` parameter is now explicitly `[config.agent]` (step 7 of `cmdShell`), which is the right choice: it whitelists only the project's configured agent's API hosts in restricted mode, and becomes irrelevant in `--unrestricted` mode. This resolves the medium concern from review 004.
- The container collision check specifies `docker.listContainers({ filters: { label: ['cook.project=<projectRoot>'], status: ['running'] } })`. This is correct dockerode syntax -- `listContainers` without `all: true` defaults to running containers only, so the `status: ['running']` filter is redundant but harmless. This resolves the medium concern from review 004 about specifying the implementation.
- The `--help` interception is now explicitly listed in `cmdShell` step 2, resolving the low concern from review 004.
- The flag parsing description (lines 98-107) clarifies that `--unrestricted` and `--help` are extracted first and not forwarded to the container command, resolving the low concern from review 004.

## Concerns

### High

- None.

### Medium

- **`ensureBaseImage` signature change is feasible but slightly understated.** The plan says "Add an optional `verbose?: boolean` parameter to both `startSandbox` and `ensureBaseImage`" and describes the propagation chain `startSandbox(verbose)` -> `ensureBaseImage(docker, verbose)` -> `buildImage(docker, name, dockerfile, verbose)`. Looking at the actual code: `ensureBaseImage` (line 73) currently takes only `(docker: Docker)` and hardcodes `false` on line 77 in the call to `buildImage`. The `buildImage` function (line 80) already accepts a `verbose` parameter, so only `ensureBaseImage` and `startSandbox` need signature changes. This is a two-function change, both internal (non-exported), and fully backward-compatible with a default of `false`. The plan correctly identifies this chain but does not show the updated `ensureBaseImage` signature in pseudocode. Low risk since the change is mechanical, but worth noting.

- **`child_process` import statement.** The plan pseudocode (line 39) shows `import { spawn } from 'child_process'` as a top-level import for the `Sandbox.shell()` method. The existing `sandbox.ts` already imports `execSync` from `child_process` (line 5), but not `spawn`. The implementation will need to add `spawn` to the existing import: `import { execSync, spawn } from 'child_process'`. The plan's step 2 note ("already available in the module via `execSync`") acknowledges this but the pseudocode shows a separate import. Minor discrepancy -- implementer should add to the existing import rather than creating a new one.

- **`hasCommandOnPath` is not currently exported from `cli.ts`.** The plan (step 4) says to export it or move to a shared util. The function (line 272 of cli.ts) is currently module-private. Exporting it from `cli.ts` is the simplest path, but `cli.ts` also contains the `main()` call and side effects (SIGINT/SIGTERM handlers, `process.argv` parsing). Importing from `cli.ts` would execute those side effects. The function should be moved to a shared utility module (or `shell.ts` can implement its own simpler check, e.g., just `execSync('which docker')`) to avoid importing `cli.ts` as a module.

### Low

- **The `status: ['running']` filter in the collision check is redundant.** Dockerode's `listContainers` without `all: true` already returns only running containers. The extra filter is harmless but could confuse future readers into thinking it is necessary. Consider using just `{ filters: { label: [...] } }` without the status filter, or adding a comment explaining it is defensive.

- **`this.projectRoot` in `Sandbox.shell()` (line 51) is used as the working directory for `docker exec -w`.** This is the host path (e.g., `/home/user/myproject`), and it works because `startSandbox` bind-mounts `projectRoot:projectRoot` (same path inside container, line 409 of sandbox.ts). Correct, but worth a brief comment in the implementation since it is non-obvious that host path equals container path.

- **Exit code propagation from `cmdShell` to the process.** The plan (step 11) says "Propagate exit code" but does not specify the mechanism. The `main()` function in `cli.ts` uses `.catch(err => { logErr(String(err)); process.exit(1) })`, so `cmdShell` would need to set `process.exitCode` or throw. Setting `process.exitCode = exitCode` after `sandbox.shell()` returns is the cleanest approach; the plan should specify this.

## Suggestions

- Move `hasCommandOnPath` (and its helpers `commandCandidates`, `isRunnableFile`, `stripSurroundingQuotes`) to a shared utility module like `src/util.ts` rather than exporting from `cli.ts`, to avoid side-effect imports.
- Show the updated `ensureBaseImage` signature in the pseudocode: `async function ensureBaseImage(docker: Docker, verbose = false)`.
- Specify that exit code propagation uses `process.exitCode = code` in `cmdShell`.
- Add `spawn` to the existing `child_process` import in `sandbox.ts` rather than a separate import statement.

## Recommendation

[x] Ready for human review
[ ] Needs revision

All high and medium concerns from review 004 have been resolved. The remaining medium concerns are implementation details (import mechanics, `hasCommandOnPath` extraction) that are straightforward to handle during coding. The core design -- `spawn` + promise for shell execution, collision detection via dockerode filters, `[config.agent]` for network rules, verbose propagation chain -- is correct and feasible against the actual codebase.
