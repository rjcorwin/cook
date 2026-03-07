# Plan Review: Native Agent Sandbox as Default (Review 2)

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** plan.md (post-revision)

## Summary

The first revision successfully resolved all 8 concerns from review 001. The plan is architecturally sound: the `AgentRunner` interface extraction is clean, `CLAUDE_CONFIG_DIR` isolation is well-specified, Codex CLI flag overrides are correctly scoped, the config resolution chain is explicit, and the 6-phase implementation approach produces a working system at each step. Two medium-severity gaps remain — both are dependency/implementation details rather than design flaws.

## Strengths

- **All review 001 concerns resolved.** The stream-of-consciousness is gone, Decision 9 is followed (Docker network config split to `.cook/docker.json`), config resolution chain is specified (3-step: settings override → convention path → hardcoded defaults), codex.toml consumption is explicit (read + extract as CLI flags), BareRunner config isolation is stated (none — uses user's native config).
- **`Bash(npm run *)` / `Bash(npm install *)` / `Bash(npm test *)`** is a meaningful safety improvement over `Bash(npm *)` — blocks `npm publish`, `npm cache clean`, etc.
- **Config resolution chain** (Section 2) is clear: file contents replace defaults entirely (no merge). This matches user expectations and avoids subtle merge bugs.
- **`cook rebuild` behavior** in non-Docker modes is explicit — errors with a message.
- **`.cook/.gitignore` with `logs/`** correctly handles the target use case (user projects, not cook's own repo).

## Concerns

### High

None.

### Medium

- **TOML parsing dependency unmentioned.** NativeRunner reads `.cook/agents/codex.toml` and extracts `sandbox_mode`, `approval_policy`, and potentially `--config key=value` pairs. TypeScript has no built-in TOML parser. The plan should either (a) note a dependency like `smol-toml` will be added, (b) specify that simple regex/line parsing is sufficient for the flat key-value structure, or (c) switch Codex config to JSON (losing parity with Codex's native format). This affects Phase 3 implementation. Note: the default path (no custom file) uses CLI flags directly and doesn't need parsing — this only matters when a user has customized `.cook/agents/codex.toml`.

- **NativeRunner process lifecycle on interruption.** The plan specifies `cleanup()` deletes the temp dir, but doesn't address terminating spawned agent processes. `DockerSandbox.stop()` currently does `container.remove({ force: true })` which kills everything inside the container. If a cook run is interrupted (Ctrl-C, timeout, crash), `NativeRunner` needs to kill the `child_process.spawn`-ed agent. Without this, orphaned `claude` or `codex` processes could continue running. Suggest adding a note: "NativeRunner tracks spawned child processes and kills them in `cleanup()`, plus registers a process exit handler as a safety net."

### Low

- **`LoopConfig` type changes not shown.** The agentLoop code in Section 10 references `config.defaultSandbox` and `config.steps[step.name].sandbox`, but the `LoopConfig` interface updates aren't specified. Inferrable from context but would help an implementer to have the type shown explicitly.

- **`DockerConfig.network.mode` type values differ from current.** Current config has `'restricted' | 'unrestricted'`; the plan's `DockerConfig` uses `'restricted' | 'bridge' | 'none'`. This is a silent type change (not just a move). With a single user this is fine, but worth noting in Phase 2 implementation notes.

- **Missing credentials error path.** If `~/.claude/.credentials.json` doesn't exist, NativeRunner's copy step will fail at runtime. `cook doctor` checks auth, but users who skip it get an unhelpful file-not-found error. A descriptive error message ("Claude credentials not found. Run `cook doctor` or authenticate with `claude auth login`.") would improve the experience. Minor — this is implementation-level detail.

## Suggestions

- For the TOML concern: the simplest path may be to use `smol-toml` (zero-dependency, 4KB) since cook already depends on external packages and TOML is Codex's native config format. Alternatively, if you want to avoid the dependency, document that NativeRunner uses regex extraction for the 2-3 known keys.

- For process lifecycle: a simple pattern is to store the `ChildProcess` reference and call `process.kill()` in cleanup, plus `process.on('exit', () => child.kill())` as a safety net. This is ~5 lines of code but should be noted in the plan since it's a behavioral difference from Docker mode.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns above)

The two Medium concerns are implementation details that don't affect the overall design. An implementer following this plan would encounter them during Phase 3 and could resolve them without architectural changes. The plan's core design — `AgentRunner` interface, `CLAUDE_CONFIG_DIR` isolation, RunnerPool, phased implementation — is solid and ready for human approval.
