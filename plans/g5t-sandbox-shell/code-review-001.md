# Code Review: `cook shell` (Correctness)

**Reviewer:** AI (Review 1 of 3)
**Date:** 2026-03-27
**Reviewing:** src/shell.ts, src/util.ts, src/sandbox.ts, src/cli.ts

## Summary

The implementation is solid and closely follows plan-003. The flag parsing, spawn+promise pattern, container collision check, verbose propagation, cleanup via try/finally, and exit code propagation are all implemented correctly. I found one medium-severity issue (a TOCTOU race between the collision check and container creation) and a few low-severity items. No high-severity bugs.

## What Works Well

- **spawn + promise pattern** in `Sandbox.shell()` is correct: async spawn with `stdio: 'inherit'` for TTY forwarding, promise-based wait, proper handling of both `code` and `signal` on close.
- **Signal-to-exit-code mapping** (lines 399-404 in sandbox.ts) follows Unix convention correctly (128 + signal number).
- **try/finally cleanup** in `cmdShell` (shell.ts lines 133-138) guarantees `sandbox.stop()` runs even if the shell errors out.
- **`--` separator** in `parseShellArgs` is implemented correctly: flags before `--` are parsed, everything after is passthrough. Non-flag args before `--` also pass through correctly (e.g., `cook shell ls -la` works).
- **`hasCommandOnPath`** in util.ts is thorough: handles absolute paths, relative paths with slashes, PATH search, Windows PATHEXT, and empty input.
- **`hasCookContainer` filter syntax** is correct for dockerode: `{ filters: { label: [...] } }` with string array values. Without `all: true`, it defaults to running containers only.
- **Verbose propagation** works end-to-end: `cmdShell` passes `true` to `startSandbox`, which passes it to `ensureBaseImage`, which passes it to `buildImage`, which conditionally writes build output to stderr.
- **Exit code propagation** is correct: `process.exitCode = exitCode` (not `process.exit()`) allows the finally block to run before the process exits.
- **Import paths** all use `.js` extensions correctly for ESM resolution.

## Issues

### High

(none)

### Medium

- [ ] **TOCTOU race between collision check and `startSandbox`** (shell.ts lines 110-125). `hasCookContainer` checks for a running container, then `startSandbox` calls `cleanupStaleContainers` (which removes stopped containers) and creates a new one. If another `cook` process starts between the check and the creation, both could pass the collision check and then race to create a container with the same name. In practice this is unlikely for a CLI tool (the window is small), but `startSandbox` will fail with a Docker name conflict error if it happens, which is a reasonable implicit guard. Consider adding a comment acknowledging this is best-effort rather than atomic.

### Low

- [ ] **`loadDockerConfig` returns a fresh object, but mutation is still surprising** (shell.ts line 104). `dockerConfig.network.mode = 'unrestricted'` mutates the returned config object in place. This works correctly since `loadDockerConfig` creates a new object each call, but direct mutation of a config object is a code smell. Consider creating a shallow copy: `const effectiveConfig = { ...dockerConfig, network: { ...dockerConfig.network, mode: 'unrestricted' } }` or similar.
- [ ] **Duplicate `findProjectRoot` implementations** (shell.ts line 10, cli.ts line 51). Both files define identical `findProjectRoot()` functions using `git rev-parse --show-toplevel`. This should be moved to util.ts or a shared module to avoid divergence. If one is changed later (e.g., to handle worktrees differently), the other could silently remain stale.
- [ ] **`-it` as a single argument** (sandbox.ts line 371). `execArgs.push('-it')` works because Docker CLI accepts combined short flags, but it is slightly unconventional for programmatic usage. `execArgs.push('-i', '-t')` would be more explicit. Not a bug.
- [ ] **`config.env` naming ambiguity** (shell.ts line 122). `config.env` contains environment variable *names* to pass through (e.g., `['OPENAI_API_KEY']`), while `Sandbox.env` contains `KEY=VALUE` strings. The `startSandbox` function handles the conversion (sandbox.ts lines 466-468), so this works correctly, but the naming could confuse future readers. Not actionable here since it is an existing pattern.
- [ ] **No timeout on `hasCookContainer`** (shell.ts line 110). If the Docker daemon is slow or hung, this call could block indefinitely. However, `startSandbox` also calls `docker.ping()` with no timeout, so this is consistent with existing behavior.

## Questions

- **Is it intentional that `cook shell` does not register with the SIGINT/SIGTERM handlers in cli.ts?** The plan says yes (signals go to the spawned child via `stdio: 'inherit'`), and this appears correct. But if the user hits Ctrl-C *before* the shell starts (during image build), the global handler calls `cleanupActiveExecutions()` which does nothing for the shell path. The `try/finally` in `cmdShell` would not run because `process.exit(1)` in the SIGINT handler terminates immediately. This means if Ctrl-C is pressed during image build, the partially-started container may not be cleaned up. This is an edge case worth noting.
- **Should `cmdShell` validate that `config.agent` is set before passing `[config.agent]` to `startSandbox`?** `loadConfig` always returns a valid `AgentName` (defaults to `'claude'`), so this is safe. Just confirming.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)

The implementation is correct and well-structured. The medium issue (TOCTOU) has a natural backstop (Docker name conflict error) and is typical for CLI tools. The low issues are code quality improvements that could be addressed in a follow-up.
