# Plan Review: `cook shell` (Architecture & Design)

**Reviewer:** AI (Review 2 of 3)
**Date:** 2026-03-27
**Reviewing:** plan.md

## Summary

The plan proposes a reasonable feature with a pragmatic implementation approach (shelling out to `docker exec -it`), but it has a significant abstraction design flaw: it exposes Sandbox internals (`containerId`, `userSpec`, `containerEnv`) to the CLI layer rather than encapsulating the interactive shell capability within the Sandbox class itself. It also introduces a network policy override that bypasses the existing config system in a way that could surprise users.

## Strengths

- The decision to use `child_process.spawn` with `stdio: 'inherit'` instead of programmatic dockerode TTY management is the right call. The research document thoroughly justifies this.
- Reusing `startSandbox()` and `sandbox.stop()` keeps the container lifecycle consistent with the agent loop path.
- The ephemeral container model is the correct starting point. Persistent containers add state management complexity that is not needed yet.
- Exit code propagation is handled correctly.
- Scoping `cook shell claude` as a non-goal is wise.

## Concerns

### High

- **Leaking Sandbox internals violates the existing encapsulation for no good reason.** The plan proposes exposing `containerId`, `userSpec`, and `containerEnv` as public getters on the `Sandbox` class so that `cmdShell` can reconstruct a `docker exec` command externally. This is backwards. The Sandbox class already knows everything needed to exec into its own container. The right design is a `Sandbox.attachShell(args: string[])` method that encapsulates the `docker exec` spawn logic. This keeps the container ID, user spec, and env vars private, and avoids spreading Docker implementation details into the CLI layer. The plan even acknowledges the non-goal "Modifying the existing Sandbox class or startSandbox API" but this constraint is self-imposed and works against good design. A method addition is a far smaller API surface change than exposing three internal fields.

- **`cmdShell` builds a `docker exec` command by reconstructing env vars, working directory, and user spec from Sandbox fields, duplicating knowledge that `startSandbox` and `runAgent` already encapsulate.** If the container setup changes (e.g., a different home directory, additional env vars, a different user creation strategy), `cmdShell` will silently drift out of sync. Centralizing the exec logic in Sandbox eliminates this class of bug.

### Medium

- **The network policy override is architecturally questionable.** The plan proposes defaulting to unrestricted networking by constructing a synthetic `DockerConfig` that overrides whatever `.cook/docker.json` says. This means `cook shell` silently ignores the project's security configuration. A user who has configured restricted networking for a reason (e.g., preventing accidental data exfiltration from a client project) would not expect `cook shell` to bypass it. A better approach: respect the project's `docker.json` by default, and provide `--unrestricted` as an explicit opt-in flag. This is the safer default and aligns with the principle of least surprise.

- **The plan places `cmdShell` inline in `cli.ts` but the function has a different character than the other commands there.** `cmdInit` is 30 lines of file writes. `cmdRebuild` is 4 lines delegating to `sandbox.ts`. `cmdDoctor` is large but is pure diagnostics. `cmdShell` would be ~60-80 lines of container orchestration with spawn logic, signal handling concerns, and Docker CLI dependency. It would be the only command in `cli.ts` that spawns a long-running child process with inherited stdio. A separate `src/shell.ts` module (even at 60 lines) would keep `cli.ts` as a routing/config layer and avoid it growing into a catch-all.

- **The plan does not address `loadDockerConfig` being available.** It mentions checking if `loadDockerConfig` is exported, but it already is exported from `config.ts` (line 129). This is a minor research gap but suggests the plan was written without fully verifying the current API surface.

### Low

- **The `docker` CLI binary dependency is new and unvalidated.** The existing codebase uses `dockerode` (a Node.js library) exclusively for all Docker operations. `cook shell` would be the first and only code path that requires the `docker` CLI binary on PATH. This is noted in the error handling section but deserves more attention: the `cook doctor` command should be extended to check for the `docker` CLI when shell-related checks are relevant, and the error message should be specific about needing the CLI binary (not just the daemon).

- **Working directory is set to `projectRoot` on the host path.** This works because the bind mount maps `projectRoot:projectRoot` (same path inside and outside), but this assumption is implicit. A comment or assertion would help future maintainers.

- **No mention of SIGWINCH or signal forwarding.** The plan correctly notes that `stdio: 'inherit'` handles TTY, but `spawn` with inherited stdio does pass through SIGWINCH for terminal resize automatically. This is worth a brief note to confirm the design handles it, rather than leaving it as an implicit assumption.

## Suggestions

- **Add a `Sandbox.shell(args: string[]): Promise<number>` method** that encapsulates the `docker exec` spawn. It has access to all the private fields it needs. `cmdShell` becomes: start sandbox, call `sandbox.shell(args)`, propagate exit code, stop sandbox. This is ~15 lines in cli.ts and ~30 lines in sandbox.ts, cleanly separated.

- **Respect `docker.json` network config by default in shell mode.** Add `--unrestricted` flag for convenience. This way security-conscious projects keep their guarantees, and casual users can opt out with a flag.

- **Put the command handler in `src/shell.ts`** even if small. The pattern of `cli.ts` delegating to domain modules (`sandbox.ts` for rebuild, `config.ts` for loading) is already established. A `shell.ts` that exports `cmdShell` keeps this clean.

- **Extend `cook doctor` to check for the `docker` CLI binary on PATH** (using the existing `hasCommandOnPath('docker')` utility already in cli.ts) when Docker sandbox mode is in use.

- **Consider whether `startSandbox` should accept an options object** instead of growing its parameter list. It currently takes 5 positional parameters. Adding a network override or shell-mode flag would push it further. An options bag (`StartSandboxOptions`) would be more maintainable, though this is a larger refactor that could be deferred.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see concerns/suggestions above)

The core issue is the abstraction boundary: interactive shell capability should live on the Sandbox class, not be reconstructed externally from leaked internals. Fixing this one concern resolves the high-priority items and naturally improves the separation of concerns. The network policy default is a secondary but important design decision that should be made deliberately rather than defaulting to the less safe option.
