# Code Review: `cook shell` (Security & Edge Cases)

**Reviewer:** AI (Review 3 of 3)
**Date:** 2026-03-27
**Reviewing:** src/shell.ts, src/util.ts, src/sandbox.ts, src/cli.ts

## Summary

The `cook shell` implementation is clean and well-structured. The security posture is reasonable for a developer tool that already requires Docker access. The main concerns are a TOCTOU race in container collision detection, unguarded cleanup failures, and the `--unrestricted` flag being a feature rather than a vulnerability (but worth documenting). No command injection risks were found — args are passed as array elements to `spawn`, not interpolated into a shell string.

## What Works Well

- Args passed to `spawn('docker', execArgs)` as an array — no shell interpolation, no injection vector
- `--` separator in `parseShellArgs` prevents flag confusion (e.g., `cook shell -- env --unrestricted` works correctly)
- `stdio: 'inherit'` is the right call — signals flow naturally to the child, no manual forwarding needed
- Async spawn with promise (not `spawnSync`) keeps the event loop alive for cleanup
- `sandbox.stop()` in `finally` block ensures cleanup even on exceptions
- Error messages use generic text, no credential values are logged
- `hasCommandOnPath` avoids spawning a subprocess (no shell involved)
- Signal-killed child processes are correctly mapped to 128+signal exit codes

## Issues

### High

- (none found)

### Medium

- [ ] **TOCTOU race in container collision check (shell.ts:110-115, sandbox.ts:419-431).** `hasCookContainer()` checks for running containers, then `startSandbox()` calls `cleanupStaleContainers()` which removes stopped containers and creates a new one. Between the `hasCookContainer` check and `createContainer`, another `cook shell` process could start a container. The deterministic container name (`cook-<hash>`) mitigates this — `createContainer` will fail with a name conflict — but the error message will be an opaque Docker error rather than the friendly "already running" message. **Suggestion:** Catch the name-conflict error from `createContainer` in `startSandbox` and surface a clear message, or accept the race as benign given the deterministic naming.

- [ ] **`sandbox.stop()` failure is silently swallowed but also hides the original error (shell.ts:133-138).** If `sandbox.shell()` throws and then `sandbox.stop()` also throws, the `finally` block's error will replace the original error from `shell()`. The `.catch(() => {})` inside `Sandbox.stop()` on the `container.remove` call prevents this for the remove itself, but `logOK('Sandbox stopped')` on line 416 would still run even if the container was never fully started. If `stop()` itself threw (e.g., Docker daemon unreachable), the original shell error is lost. **Suggestion:** Wrap the `stop()` call in its own try/catch within the `finally` block to preserve the original error.

- [ ] **`cleanupStaleContainers` runs inside `startSandbox` and force-removes all cook containers for the project (sandbox.ts:126-137), including running ones.** Although `cmdShell` checks `hasCookContainer` first, if two `cook shell` invocations race, the second one's `startSandbox` call will force-remove the first's running container without warning. The `hasCookContainer` guard prevents the common case, but the underlying `cleanupStaleContainers` behavior is aggressive. **Suggestion:** Consider having `cleanupStaleContainers` skip running containers (only remove stopped/exited ones), and fail loudly if a running container exists at that point.

### Low

- [ ] **`projectRoot` used as Docker label value without sanitization (sandbox.ts:477).** `cook.project` label is set to the raw `projectRoot` string. While Docker labels accept arbitrary strings, if `projectRoot` contains unusual characters (newlines, null bytes from a malicious git config), the label filter in `hasCookContainer` may not match correctly. Practically unlikely since it comes from `git rev-parse` or `process.cwd()`, but a `path.resolve()` + basic validation would add defense in depth.

- [ ] **`findProjectRoot` duplicated in shell.ts and cli.ts.** Both files have identical `findProjectRoot()` implementations using `execSync('git rev-parse --show-toplevel')`. This is a minor DRY violation, not a security issue. **Suggestion:** Move to `util.ts`.

- [ ] **No timeout on `hasCookContainer` Docker API call (shell.ts:110).** If the Docker daemon is hung (accepting connections but not responding), `hasCookContainer` will block indefinitely. The same applies to all dockerode calls throughout. Not specific to this PR, but shell sessions are interactive and users will notice the hang more. **Suggestion:** Consider adding a timeout wrapper for the precondition checks, or document that Ctrl-C is the escape hatch.

- [ ] **`process.exitCode` vs `process.exit()` inconsistency.** `cmdShell` sets `process.exitCode` and returns (good practice, allows cleanup). But `startSandbox` calls `process.exit(1)` on Docker ping failure (sandbox.ts:424). If the Docker daemon dies between the `hasCookContainer` check and `startSandbox`, the process exits abruptly without running any finally blocks. **Suggestion:** Have `startSandbox` throw instead of calling `process.exit(1)`, and let the caller handle it.

## Questions

- **Is `--unrestricted` intentionally available to any user who can run `cook shell`?** This is documented and by-design per the plan, but worth confirming: anyone with Docker access can already do `docker run --net=host`, so `--unrestricted` doesn't grant new capabilities. It just makes it convenient. If cook is ever used in a multi-tenant context where the shell user shouldn't control network policy, this would need revisiting.

- **Should `cook shell` work when `config.sandbox` is set to `'agent'` (non-Docker mode)?** Currently `cmdShell` always starts a Docker sandbox regardless of the config's sandbox mode setting. This seems intentional (shell always needs Docker), but a user with `"sandbox": "agent"` in config might be confused. A note in the help text could clarify.

- **What happens to the container if the host machine loses power or the process is SIGKILL'd?** The container will remain running (no cleanup). `cleanupStaleContainers` on the next run handles this, but it's worth noting that orphaned containers consume resources. The `sleep infinity` command means they won't self-terminate.

## Recommendation

[x] Ready for human review

The implementation is solid for a v1. The TOCTOU race is mitigated by deterministic container naming (Docker itself prevents the collision). The most actionable items are: (1) wrapping `stop()` in try/catch within the finally block, and (2) changing `startSandbox`'s `process.exit(1)` to a thrown error so callers retain control. Neither is a blocker.
