# Plan Review: `cook shell` Revised (Architecture & Design)

**Reviewer:** AI (Review 5 -- Round 2)
**Date:** 2026-03-27
**Reviewing:** plan-002.md

## Summary

The revised plan addresses the two most critical concerns from the prior review: Sandbox internals are now encapsulated behind a `Sandbox.shell()` method, and network policy defaults to the project's `docker.json` with an explicit `--unrestricted` opt-in. The `cmdShell` function lives in its own `src/shell.ts` module, and the CLI routing is a clean three-line dynamic import. The remaining design questions are smaller-scope: whether a `verbose` flag on `startSandbox` is the right seam for build output, whether `hasRunningContainer` belongs in `sandbox.ts` or deserves its own home, and whether the `agents` parameter to `startSandbox` can be cleanly avoided for shell mode.

## Strengths

- `Sandbox.shell()` is the right encapsulation boundary. Container ID, user spec, env vars, and working directory stay private. The CLI layer calls `sandbox.shell(args)` and gets back an exit code -- nothing else leaks.
- Defaulting to the project's `docker.json` network config and offering `--unrestricted` as an opt-in is the safer and less surprising default. This directly addresses the prior review's medium-severity concern.
- Putting `cmdShell` in `src/shell.ts` keeps `cli.ts` as a routing layer. The dynamic `import('./shell.js')` pattern matches how `cmdRebuild` already delegates to `sandbox.ts`.
- The precondition checks (Docker CLI on PATH, `.cook/` directory, container collision) are ordered correctly: cheapest checks first, container operations last.
- Signal handling is addressed by observation rather than mechanism -- `cmdShell` does not register with `cleanupActiveExecutions`, so the global SIGINT handler has nothing to clean up, and `stdio: 'inherit'` lets the shell handle Ctrl-C naturally. This is correct and avoids adding complexity.

## Concerns

### High

- **`startSandbox` requires an `agents: AgentName[]` parameter that shell mode has no natural value for.** The current signature is `startSandbox(docker, projectRoot, env, dockerConfig, agents)`. The `agents` array drives two things: credential warnings (lines 363-371) and network allow-list generation (lines 428-431). For `cook shell`, there is no agent selection -- the user is getting a raw shell. Passing an empty array `[]` would skip credential warnings (fine) but would also produce an iptables script that allows zero API hosts (only DNS), which is probably too restrictive even in restricted mode. Passing `['claude']` as a dummy is misleading. This suggests `startSandbox` needs a way to either skip network restrictions entirely when the caller handles it, or accept a "no agents" mode that still applies the `allowedHosts` from `docker.json` without requiring an agent list. This is an API mismatch that the plan should address explicitly.

### Medium

- **Adding `verbose?: boolean` to `startSandbox` pushes a presentation concern into a domain function.** `startSandbox` currently has five positional parameters. Adding `verbose` makes six, and the parameter controls how `ensureBaseImage` prints output -- a purely UI decision. The plan's alternative (calling `ensureBaseImage` directly with verbose=true before `startSandbox`) is architecturally cleaner because it keeps the UI decision in the CLI layer where it belongs. The downside is that `ensureBaseImage` is not currently exported, and calling it separately introduces a risk of double-building if `startSandbox` also calls it. A better option: export `ensureBaseImage` and have `startSandbox` skip the build if the image already exists (which it already does via `imageExists`). Then `cmdShell` calls `ensureBaseImage(docker, { verbose: true })` first, and `startSandbox`'s internal call becomes a no-op. No parameter change to `startSandbox` needed.

- **`hasRunningContainer` as a standalone function in `sandbox.ts` is reasonable but has a naming precision issue.** The function checks for containers with the `cook.project` label, but the name does not convey that it is scoped to cook containers for a specific project. Something like `hasCookContainerRunning(docker, projectRoot)` would be clearer. More importantly, the function's placement in `sandbox.ts` means it joins a module that is already 450 lines of mixed concerns (image building, container setup, network config, agent execution, and now container discovery). This is acceptable for now but worth noting as technical debt -- `sandbox.ts` is becoming a grab-bag.

- **`Sandbox.shell()` uses a dynamic `import('child_process')` instead of a top-level import.** The code sample shows `const { spawnSync } = await import('child_process')`. `sandbox.ts` already imports `execSync` from `child_process` at the top of the file (line 5). There is no reason for a dynamic import here -- it adds an unnecessary `await` and makes the dependency less visible. Use the existing top-level import and add `spawnSync` to the destructure.

### Low

- **`spawnSync` blocks the event loop.** The plan uses `spawnSync` in `Sandbox.shell()`, which blocks the Node.js event loop for the entire duration of the shell session. For an interactive shell that could run for hours, this means no async cleanup, no signal handler execution via the event loop, and no graceful shutdown path. The existing SIGINT handler in `cli.ts` uses `async` cleanup (`cleanupActiveExecutions`), but that code path cannot execute while `spawnSync` blocks. Using `spawn` (async) with a `Promise` wrapper would allow the event loop to remain live. The difference matters if the process receives SIGTERM from an external source (e.g., the terminal emulator closing).

- **The collision check and `cleanupStaleContainers` have overlapping but different semantics.** `hasRunningContainer` checks if a container is running (state filter). `cleanupStaleContainers` removes all containers with the project label regardless of state. `startSandbox` calls `cleanupStaleContainers` internally. So the sequence in `cmdShell` is: check for running container (refuse if found), then call `startSandbox` which force-removes all project containers anyway. The collision check is specifically to protect a running agent loop, but a stopped/dead container from a previous session would be cleaned up by `startSandbox` regardless. This is logically correct but the two functions encode subtly different definitions of "conflict." A comment in `cmdShell` explaining this two-phase logic would help.

- **The plan does not mention the `--help` edge case.** `cook shell --help` would attempt to run `--help` inside the container. The prior UX review (plan-review-003) flagged this. The revised plan should intercept `--help` and `-h` in `cmdShell` before starting the sandbox.

## Suggestions

- Refactor `startSandbox` to accept an options object (`StartSandboxOptions`) rather than growing positional parameters. This was suggested in the prior review and the need is now more concrete: shell mode needs to vary the agent list (or omit it), potentially skip credential checks, and control verbosity. An options object makes these variations explicit without parameter explosion.
- Export `ensureBaseImage` from `sandbox.ts` and let `cmdShell` call it with verbose output before calling `startSandbox`. This keeps presentation logic in the CLI layer.
- Use async `spawn` instead of `spawnSync` in `Sandbox.shell()` to keep the event loop live during the shell session. Wrap it in a Promise that resolves on the `close` event.
- Add `spawnSync` (or `spawn`) to the existing top-level `child_process` import rather than using a dynamic import.
- Clarify in the plan how shell mode will handle the `agents` parameter -- either by passing an empty array and adjusting network restriction logic to still apply `allowedHosts`, or by making `agents` optional in `startSandbox`.

## Recommendation

[x] Ready for human review
[ ] Needs revision

The revised plan resolves the two structural issues from Round 1 (encapsulation and network defaults). The remaining concerns are implementable refinements rather than design-level problems. The highest-priority item to resolve before coding is the `agents` parameter mismatch in `startSandbox`, which will surface immediately during implementation.
