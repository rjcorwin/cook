# Plan Review: `cook shell` Revised (UX & Edge Cases)

**Reviewer:** AI (Review 6 — Round 2)
**Date:** 2026-03-27
**Reviewing:** plan-002.md

## Summary

The revised plan addresses the most critical concerns from review 003 — it now explicitly guards against missing `.cook/`, validates the `docker` CLI on PATH, handles container collision without killing a running agent, and adds verbose image builds for shell mode. Signal handling is resolved by correctly noting that `cmdShell` never registers with `cleanupActiveExecutions`, so the global SIGINT handler is harmless. The remaining gaps are mostly around discoverability of `--unrestricted`, the user's experience during container startup, and a handful of edge cases around error messaging and `--help`.

## Strengths

- All three high-priority concerns from review 003 (subcommand parsing, docker CLI validation, `.cook/` guard) are now explicit precondition checks with clear error messages.
- Container collision is handled by refusing rather than silently killing the running container — this is the right call for v1.
- Verbose image build for shell mode means users see real progress instead of a silent hang on first run.
- Signal handling analysis is correct: since `cmdShell` does not call `execute()`, no active executions are registered, so the global SIGINT handler only calls `cleanupActiveExecutions()` (a no-op) and exits. The `finally` block in `cmdShell` handles container cleanup. This is clean.
- The decision to respect `docker.json` network config by default and require `--unrestricted` opt-in is the right security posture.

## Concerns

### High

- **`--unrestricted` is not discoverable at point of failure.** When a user runs `cook shell` and then tries `apt install` or `curl`, they get a network timeout or iptables rejection with no indication that cook is responsible. The container's iptables rules produce silent drops (`-j DROP`), so the user sees a hang or a generic connection error from inside the shell. The plan should specify that `cmdShell` prints a notice on entry when network restrictions are active, e.g., `"Network restricted (per .cook/docker.json). Use --unrestricted for full network access."` This one line eliminates the most likely support question.

### Medium

- **Startup latency is unspecified and not communicated.** Between the user typing `cook shell` and getting a prompt, several things happen: Docker ping, stale container cleanup, image check (possibly a multi-minute build), container create, container start, user setup, auth file copy, and optionally iptables setup. For a warm start (image exists) this is likely 2-5 seconds, but for a cold start (first build) it could be minutes. The plan mentions verbose build output but does not specify any progress indication for the other steps. At minimum, a `"Starting sandbox..."` message before the heavy work and a clear `"Ready."` or shell banner after would set expectations. The existing `logStep`/`logOK` calls in `startSandbox` cover some of this, but the plan should confirm they are visible in shell mode (they write to stderr, which is fine).

- **`cook shell --help` will start a container and run `--help` inside it.** The plan's `cmdShell` pseudocode parses `--unrestricted` but does not intercept `--help` or `-h`. Since args are passed through to the container shell, `cook shell --help` will spin up a full sandbox to run `bash --help` inside it — a confusing 5-second wait for unhelpful output. `--help` and `-h` should be caught before any Docker work begins.

- **Exit from shell leaves no indication of container cleanup.** When the user types `exit` or Ctrl-D, the shell exits, `sandbox.stop()` runs in the `finally` block, and cook exits. The user sees nothing confirming the container was removed. Since `sandbox.stop()` calls `logOK('Sandbox stopped')`, this is actually covered — but the plan should state that this message is expected and desirable so it is not accidentally suppressed.

- **`agents` parameter for `startSandbox` is awkward for shell mode.** The existing `startSandbox` signature requires an `agents: AgentName[]` array, used to determine which API hosts to whitelist in iptables and which credential warnings to show. For `cook shell`, there is no agent — the user is just getting a shell. Passing an empty array means iptables will only allow DNS (no API hosts), and no credential warnings fire. Passing `['claude']` is misleading. The plan does not specify what to pass here. When `--unrestricted` is used, this is moot (no iptables), but for the default restricted case, the shell would have even more restricted networking than an agent run. The plan should clarify: either pass all agents to keep API access available, or document that the restricted shell intentionally has no outbound HTTPS at all (which makes it nearly useless for anything beyond local work).

### Low

- **No shell customization or `.bashrc` sourcing.** The shell runs as the `cook` user created via `useradd -m`, which gets a minimal `/home/cook/.bashrc`. The prompt will be a bare `$` with no project context. This is fine for v1 but worth noting — a future enhancement could set `PS1` to include the project name or a `[cook]` prefix so users know they are in a sandbox.

- **`spawnSync` blocks the Node event loop.** The plan uses `spawnSync` for `docker exec`, which means the Node process cannot do any async work (like handling a graceful shutdown signal) while the shell is running. Since the shell is the only thing happening, this is acceptable in practice, but using `spawn` (async) with manual signal forwarding would be more robust. Not a v1 blocker.

- **`cook shell ls -la` with `--unrestricted` requires flag ordering.** The plan parses `--unrestricted` from `args` but does not specify where it must appear. If the user writes `cook shell --unrestricted ls -la`, the flag should be consumed and `ls -la` passed through. But `cook shell ls --unrestricted -la` would pass `--unrestricted` to `ls` inside the container. The plan should specify that `--unrestricted` is only recognized before the first non-flag argument, or document the expected position.

## Suggestions

- Print a one-line network restriction notice when entering a restricted shell session. This single addition eliminates the biggest UX gap.
- Intercept `--help` and `-h` in `cmdShell` before touching Docker. Print shell-specific usage showing the `--unrestricted` flag and command passthrough syntax.
- Clarify what `agents` array to pass to `startSandbox` in shell mode. Consider adding a `shell: true` option to `startSandbox` that skips agent-specific credential warnings and adjusts iptables behavior (e.g., allow all HTTPS in restricted mode, or skip iptables entirely for shell).
- Specify flag parsing order: `--unrestricted` must appear before any positional command arguments.
- Consider printing elapsed time after container startup completes, so users have a baseline expectation for future invocations.

## Recommendation

[ ] Ready for human review
[x] Needs revision
