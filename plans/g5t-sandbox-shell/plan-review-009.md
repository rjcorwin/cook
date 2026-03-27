# Plan Review: `cook shell` Rev 003 (UX & Edge Cases)

**Reviewer:** AI (Review 9 — Round 3)
**Date:** 2026-03-27
**Reviewing:** plan-003.md

## Summary

Revision 003 addresses every high and medium concern from review 006. The `--help` interception is now explicitly handled before Docker work (step 1 of `cmdShell` pseudocode). Network restriction discoverability is solved with a printed notice on shell entry. The `agents` parameter is clarified as `[config.agent]` with a rationale. Flag parsing order is specified (known flags extracted first, remainder becomes command). The plan is in good shape for implementation, with only minor edge cases and polish items remaining.

## Strengths

- All four high/medium concerns from review 006 are directly addressed: `--help` interception (line 81/103), network notice (line 149-153), agents parameter (lines 131-140), and flag parsing order (lines 98-107).
- The flag parsing examples are concrete and cover the three key cases (`--unrestricted` with command, `--help` alone, passthrough with no flags).
- Container collision check uses `status: ['running']` filter, correctly distinguishing from `cleanupStaleContainers` which removes all containers. This prevents the shell from killing an active agent loop.
- The decision to use async `spawn` instead of `spawnSync` (raised as a low concern in review 006) is now adopted with a clear rationale about event loop blocking and cleanup handlers.
- Verbose build propagation chain is well-specified: `startSandbox(verbose)` to `ensureBaseImage(docker, verbose)` to `buildImage(docker, name, dockerfile, verbose)`.
- The `--unrestricted` override is scoped to `dockerConfig.network.mode` only, not a wholesale bypass of sandbox security. The agents list still controls credential warnings.

## Concerns

### High

- None.

### Medium

- **`cleanupStaleContainers` still runs unconditionally inside `startSandbox`.** The collision check in `cmdShell` (step 6) guards against killing a running agent, but `startSandbox` (line 361 of sandbox.ts) calls `cleanupStaleContainers` which force-removes all containers matching the project label, including stopped ones. If the collision check passes (no running container), `startSandbox` will still remove stopped containers from a previous session. This is probably fine, but the plan does not acknowledge it. Worth a one-liner in the plan confirming that cleaning up stopped containers is intentional and expected.

- **`--unrestricted` flag consumed greedily from anywhere in args.** The plan says "extract known flags first, remainder becomes the command args" but does not specify a `--` separator convention. Consider: `cook shell env --unrestricted` -- the user wants to run `env --unrestricted` inside the container, but cook will consume the flag. This is an uncommon edge case, but the standard Unix convention of `--` to stop flag parsing would be cheap to support and eliminates the ambiguity. The plan should either add `--` support or document that `--unrestricted` is always consumed regardless of position.

### Low

- **No docker.json defaults explanation for new users.** When `docker.json` does not exist, `loadDockerConfig` returns `{ network: { mode: 'restricted', allowedHosts: [] } }`. This means a fresh `cook init` project with no `docker.json` gets a restricted shell with zero allowed hosts (only DNS and agent API endpoints). The network notice will print, but the user may not understand what `docker.json` is or how to configure it. A pointer in the `--help` output (e.g., "See .cook/docker.json for network configuration") would help.

- **Exit code 1 used as fallback for null exit codes.** In `Sandbox.shell()`, `code ?? 1` maps a null exit code (which means the process was killed by a signal) to exit code 1. The conventional approach is `128 + signal` for signal deaths, but this requires capturing the signal number from the `close` event. Not a blocker, but worth noting -- a user who kills the inner process with SIGKILL will see exit code 1 instead of 137.

- **No `cook shell` entry in the usage text for `cook --help`.** The plan says to add shell to the usage block (line 165-171), but the proposed text only shows three lines. It would be helpful to also show the `--` separator if adopted, and to confirm the text appears in the "Usage" section alongside `cook init`, `cook rebuild`, and `cook doctor`.

- **`hasCommandOnPath` export or relocation not specified.** Step 4 says "export the existing function or move to a shared util" but does not pick one. This is a minor implementation detail, but since `hasCommandOnPath` has Windows-specific logic (PATHEXT, quote stripping) that is only relevant to `cook doctor`, moving it to a shared util may pull in unnecessary complexity. Exporting from cli.ts is simpler.

## Suggestions

- Add `--` separator support to the flag parser so `cook shell -- env --unrestricted` unambiguously passes `--unrestricted` to the inner command. This is a two-line addition to the flag extraction logic.
- Add a brief note in the plan confirming that stopped container cleanup by `startSandbox` is expected behavior for shell mode.
- Consider adding `docker.json` to the `cook init` scaffold (alongside config.json and Dockerfile), with a sensible default that includes a comment explaining network modes. This would make the network restriction notice more actionable for new users.
- Export `hasCommandOnPath` directly from cli.ts rather than creating a new util module -- it keeps the change surface small.

## Recommendation

[x] Ready for human review
[ ] Needs revision
