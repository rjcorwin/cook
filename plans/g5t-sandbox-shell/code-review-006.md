# Code Review: `cook shell` Final Integration

**Reviewer:** AI (Review 6 -- Final)
**Date:** 2026-03-27
**Reviewing:** Full implementation vs plan-003.md

## Summary

The implementation is a faithful, clean translation of plan-003.md. All major flows work as designed: interactive shell, command execution, `--unrestricted` override, `--help` short-circuit, `--` passthrough separator, precondition checks, verbose builds, network notices, exit code propagation, and container cleanup. The code is well-structured across `shell.ts`, `sandbox.ts`, `util.ts`, and `cli.ts` with clear separation of concerns. Two low-severity items noted below; neither blocks shipping.

## Plan Compliance

- [x] cook shell -> interactive bash
- [x] cook shell <command> -> run command
- [x] cook shell --unrestricted -> no network restrictions
- [x] cook shell --help -> help text, no Docker
- [x] cook shell -- <args> -> passthrough separator
- [x] Docker CLI validation
- [x] .cook/ directory check
- [x] Container collision check
- [x] Verbose image build
- [x] Network restriction notice
- [x] Exit code propagation
- [x] Cleanup on exit

### Detail walkthrough

**`cook shell`** -- `cli.ts:385-388` routes to `cmdShell(args.slice(1))`. `parseShellArgs` returns empty command. `shell([])` pushes `'bash'`. TTY check adds `-i -t` or just `-i`. `spawn('docker', execArgs, { stdio: 'inherit' })` gives the user an interactive bash. On exit, `finally` block calls `sandbox.stop()`, and `process.exitCode` is set. Correct.

**`cook shell ls -la`** -- `parseShellArgs(['ls', '-la'])` puts both into `command`. `shell(['ls', '-la'])` appends them after the container ID. No TTY flags issue since it still checks `process.stdin.isTTY`. Correct.

**`cook shell --unrestricted`** -- Flag extracted, `dockerConfig.network.mode` overridden to `'unrestricted'` at line 94-96 of shell.ts. The network notice at line 119 checks `!== 'unrestricted'` so it is suppressed. In `startSandbox`, iptables script is skipped when mode is unrestricted, and `CapAdd: ['NET_ADMIN']` is omitted. Correct.

**`cook shell --help`** -- Returns immediately at line 67-69 after printing usage. No Docker work, no imports triggered beyond the static ones. Correct.

**`cook shell -- --unrestricted`** -- `parseShellArgs(['--', '--unrestricted'])`: hits `--` separator, sets `pastSeparator = true`, then `--unrestricted` goes into `command` (not treated as a flag). Result: `{ unrestricted: false, help: false, command: ['--unrestricted'] }`. Container runs with `--unrestricted` as a literal argument. Correct.

**Error: no Docker CLI** -- `hasCommandOnPath('docker')` returns false -> logs error, sets `process.exitCode = 1`, returns. No Docker connection attempted. Correct.

**Error: no .cook/ directory** -- Checks `fs.existsSync(configPath)` for `.cook/config.json`. Logs "Run 'cook init' first". Correct.

**Error: container collision** -- `hasCookContainer` queries `listContainers` filtered by label and checks `/cook-` name prefix. Returns true -> logs refusal message. Note: `listContainers` without `all: true` returns only running containers (Docker API default), matching the plan's "only checks for running containers" requirement. Correct.

**Verbose build** -- `startSandbox` passes `verbose` to `ensureBaseImage`, which passes to `buildImage`. When verbose, `followProgress` streams `event.stream` to `process.stderr`. Correct.

**Exit code propagation** -- `shell()` resolves with exit code from the spawned process. Signal-killed processes map to `128 + signal_number`. `cmdShell` sets `process.exitCode` to the result. Correct.

**Cleanup** -- `finally` block in `cmdShell` calls `sandbox.stop()` which does `container.remove({ force: true })`. Errors during stop are caught and ignored so they don't mask shell errors. Correct.

**Signal handling** -- Plan says shell mode should NOT register with `cleanupActiveExecutions`. `cmdShell` never calls `execute()` or registers any execution, so the global SIGINT handler in cli.ts has nothing to clean up for shell mode. `spawn` with `stdio: 'inherit'` forwards signals naturally to the child. Correct.

**Usage text** -- `cli.ts:65-67` includes all three shell lines matching the plan. `shell.ts` has its own detailed `shellUsage()` with examples and the `--` separator documented. Correct.

## Remaining Issues

### High

(none)

### Medium

(none)

### Low

- [ ] **`hasCookContainer` does not filter by `status: ['running']` explicitly.** The Docker API's `listContainers` defaults to only running containers when `all` is not set to `true`, so this works correctly in practice. However, the plan explicitly calls for `status: ['running']` in the filter for clarity. Adding it would be a defensive/documentation improvement but is not functionally necessary.
- [ ] **`logOK('Sandbox stopped')` in `Sandbox.stop()` prints during shell cleanup.** After the user exits the shell, they will see a "Sandbox stopped" message. This is arguably good UX feedback, but the plan doesn't mention it. If it feels noisy, it could be suppressed for shell mode. Very minor.

## Recommendation

[x] Ready to ship
[ ] Needs revision

The implementation is complete, correct, and closely follows the plan. The two low items are cosmetic/defensive and can be addressed post-ship if desired.
