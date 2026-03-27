# Plan Review: `cook shell` (UX & Edge Cases)

**Reviewer:** AI (Review 3 of 3)
**Date:** 2026-03-27
**Reviewing:** plan.md

## Summary

The plan is well-structured and makes a sound architectural choice (spawning `docker exec` rather than reimplementing TTY handling). However, several user-facing edge cases are unaddressed, most critically around pre-requisite validation, the `docker` CLI dependency, and the risk of `shell` being swallowed by the default command parser. The plan would benefit from an explicit error-path walkthrough before implementation begins.

## Strengths

- Choosing `child_process.spawn` with `stdio: 'inherit'` over programmatic dockerode TTY management is the right call -- it avoids an entire class of signal/resize bugs for free.
- TTY detection (`process.stdin.isTTY`) to decide between `-it` and `-i` correctly handles both interactive and piped usage.
- Exit code propagation via `process.exitCode = exitCode` is clean and avoids double-exit issues.
- Ephemeral container lifecycle with `finally { await sandbox.stop() }` is simple and matches existing patterns.
- Defaulting to unrestricted networking for an interactive shell is a pragmatic UX decision.

## Concerns

### High

- **`shell` will be parsed as a work prompt by the default case.** The `switch(command)` in `cli.ts` (line 442) falls through to the AST parser for any unrecognized first argument. If the `shell` case is not added *before* the `default` block, or if there is a typo/mismatch, `cook shell` will silently be interpreted as a work prompt with the literal text "shell". The plan mentions adding a case but does not discuss guard rails. Consider also adding `shell` to the help text and to a constant set of reserved subcommand names so the parser can reject them.

- **`docker` CLI binary must be on PATH, but this is not validated.** The plan uses dockerode (which talks to the Docker socket) to start the container, then spawns `docker exec` via `child_process.spawn`. These are two different dependencies. A user could have Docker Desktop running (socket available) but `docker` not on PATH (e.g., Colima with nerdctl, Podman socket-compatible setups, or a misconfigured PATH). The plan lists this in "Error Handling" but the code sample does not actually check for it. A failed `spawn('docker', ...)` produces a cryptic `ENOENT` error, not a helpful message. Add an explicit `which docker` or PATH check before spawning.

- **No `.cook/` directory / no `cook init` guard.** `loadConfig` silently returns defaults when `.cook/config.json` is missing (defaults to `sandbox: 'agent'`, `agent: 'claude'`). The plan calls `loadConfig` and `loadDockerConfig`, so `cook shell` will *appear* to work without `cook init`, but it will use default config and skip project-specific Dockerfile, network rules, etc. The user gets no indication that they are running in a default/degraded configuration. This should either (a) require `.cook/` to exist and error with "Run `cook init` first", or (b) print a clear warning that defaults are being used.

### Medium

- **First-run image build has no progress feedback.** When the base image does not exist, `ensureBaseImage` calls `buildImage` with `verbose: false` (line 77). This means the user sees "Building sandbox image (first run)..." and then nothing for potentially minutes while `npm install -g` runs inside the Dockerfile. For an interactive `cook shell` command where the user is waiting at a terminal, this is a poor experience. Consider passing `verbose: true` for the shell subcommand, or at minimum adding a spinner/elapsed-time indicator.

- **Signal handling gap: Ctrl-C behavior is ambiguous.** The plan relies on `stdio: 'inherit'` to forward signals, which mostly works -- Ctrl-C sends SIGINT to the foreground process group, which includes the spawned `docker exec` and the shell inside it. However, the existing SIGINT handler in `cli.ts` (line 41) calls `cleanupActiveExecutions()` and `process.exit(1)`. If this handler fires during `cook shell`, it will kill the cook process and orphan cleanup of the container. The `finally` block in `cmdShell` should still run (since `process.exit` triggers finally in async contexts inconsistently), but this needs verification. The shell subcommand should either (a) remove/replace the global SIGINT handler, or (b) ensure `sandbox.stop()` is registered in `cleanupActiveExecutions`.

- **`sandbox.containerId`, `sandbox.userSpec`, `sandbox.containerEnv` are all private.** The plan acknowledges this and proposes adding getters, but does not specify whether to use `readonly` fields or getter properties. Using `readonly` changes the access modifier from `private` to `public readonly`, which exposes the raw `Docker.Container` object. Getter properties returning only `container.id` (a string) are safer. This is a minor API design point but worth being explicit about.

- **`-w projectRoot` may be wrong inside the container.** The plan sets `-w` to the host's `projectRoot` path. This works because `startSandbox` bind-mounts `${projectRoot}:${projectRoot}` (same path inside and outside). This is correct but fragile -- if the mount mapping ever changes, the working directory will silently be wrong. Worth a code comment.

### Low

- **Piped input (`echo "ls" | cook shell`) works but exit behavior may surprise.** When stdin is not a TTY, the plan correctly uses `-i` without `-t`. The piped command will execute and the shell will exit when stdin closes. However, `cook shell` (no args) defaults to `bash`, and `bash` in non-interactive mode with `-i` flag reads from stdin until EOF. This is correct behavior, but a user running `echo "ls" | cook shell` might expect the output to appear on stdout. Since `stdio: 'inherit'` is used, this should work. Consider documenting this usage pattern.

- **No `--help` for the shell subcommand.** `cook shell --help` will attempt to run `--help` as a command inside the container, which will fail. Consider intercepting `--help` and `-h` in `cmdShell`.

- **Exit code 137 (OOM kill / `docker stop`) is not distinguished.** If the container is killed externally (OOM, `docker stop`), the exit code will be 137. The plan propagates this as-is, which is fine, but a hint message ("Container was killed -- possible OOM") would improve debuggability.

- **Container name collision with running agent containers.** The plan uses the same `cook-<hash>` naming via `startSandbox`, which calls `cleanupStaleContainers` first. This means running `cook shell` while an agent loop is active on the same project will *kill the agent's container*. The plan should address this -- either use a different container name prefix for shell containers, or detect and refuse if a container is already running.

## Suggestions

- Add a `docker` CLI PATH check early in `cmdShell`, before starting the sandbox. Use the existing `hasCommandOnPath('docker')` utility from `cli.ts` (it is already implemented for `cook doctor`). Fail with a clear message: "docker CLI not found on PATH. cook shell requires both the Docker daemon and the docker CLI."
- For the missing `.cook/` case, add a warning: "No .cook/ directory found. Using default configuration. Run `cook init` to customize." This is low-cost and prevents confusion.
- Register the shell container cleanup in whatever mechanism the SIGINT handler uses, or temporarily replace the SIGINT handler during `cook shell` with one that lets the spawned process handle the signal naturally.
- Consider `cook shell --build` or auto-detecting that the image is missing and offering to build it, rather than silently building on first run with no progress output.
- Add `shell` to the usage text in the `usage()` function alongside `init`, `rebuild`, and `doctor`.
- Strongly consider using a different container name (e.g., `cook-shell-<hash>`) to avoid destroying a running agent container when the user just wants to poke around.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see concerns/suggestions above)
