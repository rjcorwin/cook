# Code Review: `cook shell` (Architecture & Quality)

**Reviewer:** AI (Review 2 of 3)
**Date:** 2026-03-27
**Reviewing:** src/shell.ts, src/util.ts, src/sandbox.ts, src/cli.ts

## Summary

The implementation is clean, well-structured, and closely follows the plan. The separation of concerns between shell.ts (orchestration), sandbox.ts (container encapsulation), util.ts (shared helpers), and cli.ts (routing) is sound. The code follows existing codebase patterns for error handling, logging, and module boundaries. There are a few duplication and robustness issues worth addressing, but nothing that blocks human review.

## What Works Well

- **`Sandbox.shell()` is a natural fit on the class.** It encapsulates container ID, user spec, env vars, and working directory -- the CLI never sees Docker internals. This mirrors how `runAgent()` works: same private fields, same encapsulation boundary. The method is the right size and scope.
- **`hasCommandOnPath` extraction to util.ts is clean.** All four helper functions moved as a unit, cli.ts imports from util.ts, no leftover copies of the logic. The comment on line 243 of cli.ts (`// hasCommandOnPath and helpers have been moved to src/util.ts`) is a helpful breadcrumb.
- **Flag parsing with `--` separator is well done.** `parseShellArgs` handles the ambiguity of `cook shell --unrestricted` (cook flag) vs `cook shell -- env --unrestricted` (container command) correctly. This is a subtle UX detail that was handled proactively.
- **Async spawn over spawnSync.** Correct choice, well-documented in the comment block on `shell()`. The signal-to-exit-code mapping in the `close` handler is thorough.
- **Error flow uses `process.exitCode` instead of `process.exit()`.** This allows cleanup to run naturally, consistent with how the rest of the codebase handles non-fatal exits.
- **Verbose build propagation.** The `verbose` parameter threads cleanly through `startSandbox` -> `ensureBaseImage` -> `buildImage` with backward-compatible defaults.
- **CLI routing follows existing pattern.** Dynamic `import('./shell.js')` in the switch case matches how `rebuild` uses dynamic `import('./sandbox.js')`.

## Issues

### Medium

- [ ] **Duplicated `findProjectRoot()` function.** `shell.ts:10-16` is an exact copy of `cli.ts:51-57`. This should be extracted to `util.ts` (or a shared module) and imported by both. Two copies means two places to update if the heuristic changes (e.g., supporting monorepos, or falling back to `.cook/` directory search instead of git root).

- [ ] **`shell()` env var handling differs from `runAgent()`.** In `runAgent()` (line 285), env vars are passed as `Env: [...env, 'HOME=/home/cook']` to dockerode's exec API, where each entry is `KEY=VALUE`. In `shell()` (lines 379-381), the same `this.env` array is iterated and passed as `-e` flags to `docker exec` CLI. This works because `this.env` contains `KEY=VALUE` strings -- but the pattern divergence is fragile. If someone later changes the env format in one place, the other breaks silently. Consider extracting a helper like `buildExecEnv()` or at minimum adding a comment that documents the `KEY=VALUE` format contract on the `env` constructor parameter.

- [ ] **`hasCookContainer` does not filter by container name prefix.** `cleanupStaleContainers` (line 131) checks `name.startsWith('/cook-')` in addition to the label, but `hasCookContainer` (line 144-149) only filters by label. If another tool creates containers with the same label but different naming convention, `hasCookContainer` would produce a false positive. This is unlikely but the asymmetry is worth noting. Consider adding the name filter for consistency, or document why it is intentionally omitted.

### Low

- [ ] **`shellUsage()` writes to stderr but returns void.** The main `usage()` in cli.ts writes to stderr AND calls `process.exit(1)`. `shellUsage()` just writes and returns, relying on `cmdShell` to return cleanly (which it does). This is actually better behavior -- but the inconsistency between the two usage functions is worth being aware of. No change needed; just noting the pattern difference.

- [ ] **`shell()` passes env vars with `-e env` as two separate args.** On line 380, `execArgs.push('-e', env)` where `env` shadows `this.env` loop variable. The parameter name `env` shadowing the class field `this.env` is not a bug (the loop variable is local), but it reduces readability. Consider renaming the loop variable to `envEntry` or `envVar`.

- [ ] **No timeout or resource limit on shell sessions.** The plan explicitly lists "persistent/long-lived shell containers" as a non-goal, but there is no mechanism to enforce this. A shell session can run indefinitely. This is fine for v1 but worth noting for future consideration.

- [ ] **`config.env` semantics in shell context.** `cmdShell` passes `config.env` to `startSandbox`, which resolves env var names to `KEY=VALUE` pairs from `process.env`. This means shell sessions get the same env passthrough as agent runs, which is correct. However, there is no way for the user to pass additional env vars specifically for the shell session (e.g., `cook shell -e FOO=bar`). This is fine for v1 scope.

## Questions

- **Should `findProjectRoot` move to util.ts now?** It is duplicated and both copies are identical. This seems like the right time to consolidate, since util.ts was just created as the shared-helpers module.

- **What happens if Docker daemon is not running but docker CLI is on PATH?** `hasCommandOnPath('docker')` passes, then `startSandbox` calls `docker.ping()` which fails with `process.exit(1)` (sandbox.ts line 424). This hard exit bypasses the graceful `process.exitCode` pattern used in shell.ts. Should `startSandbox`'s ping failure throw instead of calling `process.exit(1)`, letting the caller handle the error?

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

The medium issues (duplicated `findProjectRoot`, env handling divergence, `hasCookContainer` filter asymmetry) are real but non-blocking. The implementation is solid and follows the plan faithfully. The code is production-ready with minor cleanup.
