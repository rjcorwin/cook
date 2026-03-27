# Plan Review: `cook shell` (Correctness & Feasibility)

**Reviewer:** AI (Review 1 of 3)
**Date:** 2026-03-27
**Reviewing:** plan.md

## Summary

The plan is well-structured and the core approach (spawn `docker exec` with `stdio: 'inherit'`) is sound. However, the pseudocode contains several incorrect assumptions about the existing APIs: it references properties that do not exist on the `Sandbox` class, passes the wrong type for the `env` parameter to `startSandbox`, and uses `projectRoot` as the container working directory (which would only work by coincidence of the bind mount layout). The plan also contradicts itself by stating "no modifications to the existing Sandbox class" as a non-goal, then immediately describing modifications to it. These issues are fixable but would cause compilation or runtime failures if implemented as-written.

## Strengths

- The `docker exec` spawn approach with `stdio: 'inherit'` is the correct choice for TTY handling -- it avoids all the complexity of programmatic raw mode, SIGWINCH, and stream piping that the dockerode approach would require.
- The ephemeral container lifecycle (start on entry, remove via `sandbox.stop()` in `finally`) correctly mirrors the existing pattern.
- The `loadDockerConfig` function does exist and is already exported from `config.ts` (line 129). The plan's concern about needing to export it is unnecessary -- it is already exported.
- The TTY detection (`process.stdin.isTTY`) for choosing `-it` vs `-i` is correct.

## Concerns

### High

- **`sandbox.containerId`, `sandbox.userSpec`, and `sandbox.containerEnv` do not exist.** The `Sandbox` class (line 328-351 of sandbox.ts) has all fields declared `private`: `docker`, `container`, `userSpec`, `env`, and `projectRoot`. There are no public getters. The plan acknowledges this in the "Exposing Sandbox Internals" section but then lists it as a non-goal ("Not modifying the existing Sandbox class"). This is a direct contradiction. The class must be modified, or the shell command must bypass it entirely and call the setup functions directly.

- **The `env` parameter type mismatch.** The pseudocode passes `config.env` (which is `string[]` of variable *names* like `["CLAUDE_CODE_OAUTH_TOKEN"]`) directly to `startSandbox`. This is correct -- `startSandbox` expects `env: string[]` of variable names and resolves their values internally (line 396-399). However, the pseudocode then iterates `sandbox.containerEnv` to pass `-e` flags, and this property does not exist. The private field is named `env`, not `containerEnv`. If getters are added, the naming should match.

- **Working directory is `projectRoot` (host path).** The pseudocode uses `execArgs.push('-w', projectRoot)` where `projectRoot` is the host filesystem path. This happens to work because the bind mount is `${projectRoot}:${projectRoot}` (same path inside and outside container, line 409), but this is a fragile implicit dependency. It works today but would break if the mount mapping ever changes. Worth a comment at minimum.

- **`agents` array is wrong.** The pseudocode sets `const agents: AgentName[] = [config.agent]`. This is used for two things: (1) credential warnings in `startSandbox`, and (2) network restriction rules. For a shell session, the agent is arguably irrelevant (especially with unrestricted networking), but if `--restricted` mode is used, the iptables rules would only allow hosts for the default agent, not all configured agents. This could silently block network access to providers the user expects to reach.

### Medium

- **Non-goal contradiction.** The plan lists "Not modifying the existing Sandbox class or startSandbox API" as an explicit non-goal, then Section "Exposing Sandbox Internals" describes exactly that -- adding public getters to the Sandbox class. This should be reconciled: either remove the non-goal or find an approach that truly avoids modifying `Sandbox` (e.g., extract container setup into a lower-level function).

- **No check for `docker` CLI on PATH.** The pseudocode checks for the Docker daemon via dockerode `ping()`, but the actual `docker exec` is run via `child_process.spawn('docker', ...)`. If the `docker` CLI binary is not on PATH (possible in some Docker Desktop configurations), the spawn will fail with an unhelpful ENOENT error. The plan mentions this in the Error Handling section but the pseudocode does not implement it.

- **`startSandbox` double-pings Docker.** The pseudocode calls `docker.ping()` explicitly, then calls `startSandbox` which also calls `docker.ping()` (line 354-358). This is harmless but redundant -- remove the explicit ping since `startSandbox` already handles it.

- **Network override not shown in pseudocode.** The plan recommends defaulting to unrestricted networking for shell mode, but the pseudocode passes `dockerConfig` directly from `loadDockerConfig` without overriding the network mode. The actual override logic is not implemented in the pseudocode.

### Low

- **`sandbox.stop()` logging.** The `Sandbox.stop()` method logs "Sandbox stopped" (line 349). For the shell use case, this message would appear after the user's shell exits, which is fine but slightly noisy. Consider whether this message makes sense in the interactive context.

- **No `--help` for the shell subcommand.** The plan does not mention handling `cook shell --help` or `cook shell -h`, which would currently be passed as a command to run inside the container (literally running `--help` as a command, which would fail).

- **Signal handling.** The existing SIGINT/SIGTERM handlers in cli.ts call `cleanupActiveExecutions()`. The shell command's container cleanup is in a `finally` block on `sandbox.stop()`, which should work, but if the user hits Ctrl-C, the signal goes to the `docker exec` child process (since `stdio: 'inherit'`), not to the Node parent. The parent process may not get a chance to run the `finally` block if the user Ctrl-C's aggressively or if the shell ignores SIGINT. Consider adding the sandbox to the cleanup registry or handling this explicitly.

## Suggestions

- **Option A (simpler, recommended):** Instead of modifying the `Sandbox` class, extract the container setup logic from `startSandbox` into a helper that returns the raw container, userSpec, and env. The shell command calls the helper directly. The `Sandbox` class stays untouched. This aligns with the stated non-goal.

- **Option B:** Drop the non-goal and add three readonly getters to `Sandbox`. This is the smaller code change but contradicts the plan's own stated constraint.

- For the network override, explicitly construct the `DockerConfig` in the pseudocode:
  ```typescript
  const dockerConfig: DockerConfig = {
    network: { mode: 'unrestricted', allowedHosts: [] }
  }
  ```

- Add a `which docker` or `hasCommandOnPath('docker')` check before spawning (the `hasCommandOnPath` utility already exists in cli.ts).

- For the `agents` parameter, consider passing an empty array `[]` when using unrestricted networking (since agent hosts are irrelevant), or all three agents when using restricted networking.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see concerns/suggestions above)
