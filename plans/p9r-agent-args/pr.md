# Add `agentArgs` config field — pass-through extra CLI flags to agent binaries

Adds a `.cook/config.json` field `agentArgs` that appends user-supplied CLI flags to the agent invocation on every cook step (work, review, gate, iterate, ralph, race, judge, shell). Native and docker runners both honor it. Defaults to `{}` — fully opt-in, no behavior change for existing configs.

## Motivation

Today the flags passed to `claude -p` / `codex exec` / `opencode run` are hardcoded in two places (`src/native-runner.ts:111`, `src/sandbox.ts:254`). Real workflows that need extra flags — most notably `--mcp-config` and `--add-dir` for Claude Code — cannot be expressed in cook config and force users into private forks or `PATH`-shadowing wrappers (which break inside the docker sandbox).

This PR adds a single config field that unblocks every "I just need to pass `--my-flag`" case without committing cook to know each agent's flag surface.

## Usage

```json
{
  "agent": "claude",
  "agentArgs": {
    "claude": ["--mcp-config", ".cook/mcp.json", "--add-dir", "../shared"],
    "codex":  ["--profile", "fast"]
  }
}
```

Or as an env-var override for one-off runs (space-separated, POSIX shell quoting):

```sh
COOK_AGENT_ARGS_CLAUDE="--add-dir /tmp/bus" cook "fix the bug" review
```

## Design Decisions

- **Per-agent map** (`Partial<Record<AgentName, string[]>>`), not a flat list — agents have disjoint CLI surfaces; a flat list would silently misapply flags.
- **Append, do not replace** the hardcoded base flags. Users can still override via CLI semantics (e.g. add `--permission-mode bypassPermissions` to override the native runner's `acceptEdits` default).
- **Env-var fallback replaces, not concatenates** — additive composition would make `cook` invocations hard to reason about ("what's actually being passed?").
- **No flag validation** — cook stays agnostic of each agent's CLI surface; the agent itself surfaces errors for unknown flags.
- **POSIX single-quote escaping** in the docker shell-string path to keep the interpolation injection-safe.
- **No per-step `agentArgs`** in v1 — extends cleanly to `steps.<name>.agentArgs` later if needed.

See `plans/p9r-agent-args/research.md` and `plans/p9r-agent-args/plan.md` for full rationale.

## Files Changed

- `src/config.ts` — new `AgentArgs` type, `agentArgs` field on `CookConfig`, `parseAgentArgs()` validator, default `{}`.
- `src/util.ts` — `splitShellArgs()` (POSIX-ish tokenizer) + `resolveAgentArgs()` (env-var > config).
- `src/native-runner.ts` — constructor accepts `agentArgs`; `buildCommand()` appends extras (before stdin marker for codex).
- `src/sandbox.ts` — `shellQuote()` helper; `runCommandForAgent()` interpolates safely; `Sandbox` and `startSandbox` thread `agentArgs` through. `verbose` parameter position preserved for backward compatibility.
- `src/race.ts` — `createRunnerPool` passes `config.agentArgs` to both runners.
- `src/shell.ts` — `cook shell` honours `agentArgs` so interactive sessions inherit the same flags.
- `tests/agent-args.test.mjs` — 15 unit tests (`splitShellArgs`, `resolveAgentArgs`, `loadConfig` parsing, `NativeRunner.buildCommand` argv composition).
- `package.json` — added `tsx` to devDependencies + `npm test` script using Node's built-in `--test` runner.
- `README.md` — "Custom agent CLI flags" subsection with examples + docker caveat.
- `plans/p9r-agent-args/` — RPI artifacts (research, plan, devlog, code-review, this pr.md).

## Backward Compatibility

- Configs without `agentArgs` default to `{}` — no change to spawn argv.
- `startSandbox` signature evolution: new `agentArgs` parameter appended after the existing `verbose` (which kept its position). Existing positional callers (currently only `src/shell.ts`) compile and run unchanged.
- No new runtime dependencies.

## Test Plan

### Automated (15 tests)

```sh
npm test
```

Covers:

- `splitShellArgs` — simple tokens, single-quoted with spaces, double-quoted with backslash escapes, empty input.
- `resolveAgentArgs` — config fallback, env-var override, unset both.
- `loadConfig` — valid `agentArgs`, missing (default), malformed (non-object), unknown agent key (dropped), non-string entries in list (filtered).
- `NativeRunner.buildCommand` — claude appends after base flags; codex preserves stdin marker `-` as last argv; no `agentArgs` leaves base argv unchanged.

### Manual

```sh
# 1. Create a project with the new config
mkdir -p /tmp/cook-test && cd /tmp/cook-test
git init && npx -y -- @let-it-cook/cli@local init  # or your local build path

cat > .cook/config.json <<'JSON'
{
  "agent": "claude",
  "sandbox": "agent",
  "agentArgs": {
    "claude": ["--mcp-config", ".cook/mcp.json", "--add-dir", "/tmp"]
  }
}
JSON

# 2. Verify argv via a wrapper for `claude` that logs argv to a file
# Or set DEBUG-level logging if a future revision adds it.
# 3. Run `cook 'hello' work` and inspect the captured argv — extras should appear after `-p`.

# Env-var path:
COOK_AGENT_ARGS_CLAUDE="--add-dir /tmp/other" cook "hello" work
# Verify `--add-dir /tmp/other` overrides config value.
```

## Out of Scope

- Per-step `agentArgs` (extensible later).
- Auto-injecting Claude/Codex-specific defaults (cook stays agent-agnostic).
- Replacing the existing hardcoded base flags (`acceptEdits`, `dangerously-skip-permissions`) — those keep current behaviour; users override via append semantics.
- Test framework choice — `tsx + node --test` is the lightest path that doesn't preempt PR #21's Vitest discussion.

## Notes

No LICENSE file in the repo today; submitting under the implicit terms used by prior merged PRs. Happy to clarify or sign anything if maintainer has a CLA preference.
