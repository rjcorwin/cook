# Plan Review: `cook shell` Revised (Correctness & Feasibility)

**Reviewer:** AI (Review 4 -- Round 2)
**Date:** 2026-03-27
**Reviewing:** plan-002.md

## Summary

The revised plan addresses the most critical concerns from reviews 1-3: it encapsulates exec logic inside `Sandbox.shell()` instead of leaking internals, moves the handler to a separate `src/shell.ts` module, respects `docker.json` network config by default with an `--unrestricted` opt-in, adds a container collision guard, and proposes verbose image builds. The pseudocode is largely correct but has one definite bug (use of `spawnSync` in an `async` method that cannot propagate the return properly through the existing call chain) and a few feasibility gaps around the collision check API and the `this.env` field contents.

## Strengths

- The `Sandbox.shell()` method cleanly resolves the encapsulation concern from reviews 1 and 2. Container ID, user spec, and env stay private. The CLI layer calls one method and gets an exit code.
- Defaulting to restricted networking and providing `--unrestricted` as opt-in is the correct security posture. This directly addresses the medium concern from review 2.
- The container collision check (refuse if a cook container is already running) prevents the dangerous scenario from review 3 where `cook shell` would silently kill an active agent container via `cleanupStaleContainers`.
- The signal handling analysis is correct: since `cmdShell` never calls `execute()`, no active executions are registered, and `stdio: 'inherit'` forwards signals naturally. The SIGINT handler in `cli.ts` calls `cleanupActiveExecutions()` which will be a no-op, so it will not interfere.
- Separating into `src/shell.ts` follows the existing pattern and keeps `cli.ts` focused on routing.

## Concerns

### High

- **`spawnSync` in an async method is functionally correct but semantically wrong and blocks the event loop.** The `Sandbox.shell()` method is declared `async` and returns `Promise<number>`, but internally uses `spawnSync` which blocks the Node.js event loop for the entire duration of the shell session. This means: (1) the `finally` block in `cmdShell` that calls `sandbox.stop()` will work fine after `spawnSync` returns, so the lifecycle is correct; (2) however, any pending async work (timers, signal handler promises, dockerode keepalives) will be frozen for the entire session. The original plan (plan.md) used `spawn` with a Promise wrapper around the `close` event, which is the correct pattern for an async method. The revised plan should use `spawn` + promise, not `spawnSync`. The fix is straightforward -- use the original plan's pattern:
  ```typescript
  const { spawn } = await import('child_process')
  const child = spawn('docker', execArgs, { stdio: 'inherit' })
  const code = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1))
  })
  return code
  ```

- **`this.env` contains resolved `KEY=VALUE` pairs, not variable names.** The pseudocode iterates `this.env` with `for (const env of this.env) { execArgs.push('-e', env) }`. Looking at `startSandbox` (line 390-399 of sandbox.ts), the `containerEnv` array passed to the `Sandbox` constructor contains fully resolved strings like `GIT_AUTHOR_NAME=cook` and `OPENAI_API_KEY=sk-...`. Passing these with `-e` to `docker exec` is correct -- `docker exec -e KEY=VALUE` works. However, the field is named `env` in the constructor (line 335: `private env: string[]`), not `containerEnv`. The pseudocode uses `this.env` which matches the actual private field name, so this is correct. No bug here on re-examination. (Note: the `HOME=/home/cook` addition on line 55 is also correct since the Sandbox constructor does not include HOME in the env array.)

### Medium

- **Container collision check requires a label filter that dockerode supports, but the pseudocode does not show the implementation.** The plan says "list containers with label `cook.project=<projectRoot>`, check if any are running." Dockerode's `listContainers` supports label filtering via `filters: { label: ['cook.project=<value>'] }`. However, the existing `cleanupStaleContainers` function (line 126-137) does not use label filters -- it lists all containers and checks labels in JS. The new `hasRunningContainer` function should use the filter parameter for efficiency:
  ```typescript
  const containers = await docker.listContainers({
    filters: { label: [`cook.project=${projectRoot}`] }
  })
  return containers.length > 0
  ```
  Note: `listContainers` without `all: true` defaults to only running containers, which is exactly what we want here. This is feasible but the plan should specify the implementation to avoid someone accidentally using `all: true` and flagging stopped containers.

- **Verbose build option requires threading through `startSandbox` to `ensureBaseImage`.** The plan recommends adding `verbose?: boolean` to `startSandbox`, but `ensureBaseImage` is a standalone function (line 73-78) that hardcodes `verbose: false` on line 77. The change requires: (1) adding `verbose` param to `startSandbox`, (2) passing it to `ensureBaseImage`, (3) adding `verbose` param to `ensureBaseImage`. This is three function signatures to change. It is feasible and backward-compatible (defaulting to false), but the plan should note that `ensureBaseImage` also needs modification, not just `startSandbox`.

- **The `agents` parameter to `startSandbox` is unclear for shell mode.** The plan's `cmdShell` pseudocode (step 6) says "Start sandbox (verbose image build, network per config unless --unrestricted)" but does not specify what to pass for `agents`. The `agents` array affects: (1) credential warnings (lines 363-371), and (2) iptables rules (line 428). For shell mode, credential warnings are mostly noise (the user is not necessarily running an agent). For iptables rules with restricted networking, the allowed hosts depend on the agent list. The plan should specify passing an empty array `[]` (which would only allow `docker.json` allowedHosts) or all three agents (which would allow all provider hosts). An empty array with `--unrestricted` is fine since no iptables rules are applied, but restricted mode with an empty agents array would block all API hosts, which might surprise users. Consider defaulting to `[config.agent]` or all three.

### Low

- **The `--unrestricted` flag parsing is mentioned but not shown.** The pseudocode for `cmdShell` says "Parse --unrestricted flag from args" without showing how. This needs to handle the flag appearing anywhere in args and not pass it through to the container command. For example, `cook shell --unrestricted ls -la` should run `ls -la` in the container with unrestricted networking. The flag should be consumed before `remainingArgs` is passed to `sandbox.shell()`.

- **`cook shell --help` is still not addressed.** This was raised in review 3 (low concern) and the revised plan does not mention it. `cook shell --help` would attempt to run `--help` inside the container. Consider intercepting `-h`/`--help` in `cmdShell`.

- **The `Sandbox stopped` log message from `sandbox.stop()` (line 349) will print after every shell exit.** For a brief command like `cook shell ls`, the user would see "Sandbox stopped" which is fine. But it is slightly noisy for interactive sessions where the user just typed `exit`. This is cosmetic and can be addressed later.

## Suggestions

- Switch from `spawnSync` to `spawn` with a promise wrapper in `Sandbox.shell()`. This is the most important fix.
- Specify the `hasRunningContainer` implementation using dockerode's label filter and default (running-only) listing.
- Note that `ensureBaseImage` also needs a `verbose` parameter, not just `startSandbox`.
- Decide on the `agents` array for shell mode explicitly. Recommendation: pass `[config.agent]` for restricted mode (matches the project's default agent's required hosts), pass `[]` for unrestricted mode (irrelevant since no iptables rules are applied).
- Show the `--unrestricted` flag parsing logic, even as pseudocode, to clarify that it is consumed and not forwarded to the container.

## Recommendation

[ ] Ready for human review
[x] Needs revision

The `spawnSync` issue is the only blocking concern -- it is a clear regression from the original plan's correct `spawn` usage and would freeze the event loop during the shell session. The other items are clarifications and implementation details that could be resolved during coding, but specifying them in the plan reduces the risk of implementation bugs.
