# Code Review: Custom CLI Args for Agents (`agentArgs` config field)

**Date:** 2026-05-16
**Reviewing:** plan.md + implementation (commits on `p9r-agent-args` branch)
**Reviewer:** Claude (self-review per CONTRIBUTING.md RPI workflow)

## Scope

Reviewed every file changed by this PR against:
1. Match between plan.md and implementation
2. Type-safety / null-handling
3. Shell-escape correctness (security)
4. Backward compatibility
5. Test coverage
6. Documentation accuracy

## Findings

### ✅ Plan alignment

All goals from plan.md are implemented:

| Goal | Status | Where |
|---|---|---|
| `AgentArgs` type + `agentArgs` field | ✅ | `src/config.ts:17-28` |
| Per-agent string-array shape | ✅ | `parseAgentArgs` validates structure |
| Default `{}` (opt-in, no behavior change) | ✅ | `defaults` in `loadConfig`, `?: {}` defaults on runner ctors |
| Append, do not replace base flags | ✅ | `...extra` after base, before stdin marker for codex |
| Both runners support it | ✅ | `native-runner.ts:114-120`, `sandbox.ts:262-272` |
| Env-var override `COOK_AGENT_ARGS_<AGENT>` | ✅ | `util.ts:resolveAgentArgs` |
| Shell quoting in docker path | ✅ | `sandbox.ts:shellQuote` |
| Tests | ✅ | 15/15 passing |
| README documentation | ✅ | "Custom agent CLI flags" section |

### ✅ Type-safety

- `AgentArgs = Partial<Record<AgentName, string[]>>` — `Partial` is correct here; not all agents need entries.
- All consumers use `agentArgs[agent] ?? []` (or `resolveAgentArgs` which handles undefined).
- Optional constructor params default to `{}` so old callers that omit them still compile.

### ✅ Shell quoting

`shellQuote("a'b")` → `'a'\''b'` (verified by inspection). The standard POSIX trick: close, escape, reopen. No double-quote path because `runCommandForAgent` wraps quoted tokens in single quotes only — no `$VAR` expansion needed for user flags. If a user passes `--flag=$HOME` they get the literal `$HOME` string, which is the documented behaviour (their flag, their problem).

Tested cases that *should* pass through unchanged:
- `--mcp-config .cook/mcp.json` — two simple tokens, no special chars.
- `--add-dir /tmp/with space` — space inside a single token (only relevant for env-var form; in config it's an array of two strings, so no split issue).

Tested edge case for `splitShellArgs`:
- `--key "a\\"b"` — backslash-escaped quote inside double quotes → `--key`, `a"b`. Passes.

### ✅ Backward compatibility

- `startSandbox` signature: `verbose` retained in original position; `agentArgs` appended. `shell.ts:109` still passes `true` as the 6th positional arg without modification (it now also passes `config.agentArgs` as the 7th, which is the intended wiring). Any external caller that was passing `verbose=true` continues to work.
- `CookConfig.agentArgs` is required (not optional) in the type, but `loadConfig` always populates it (defaults to `{}`). So consumers can safely read `config.agentArgs[agent]` without a runtime check.
- Existing tests (`tests/runs/` integration recipes) are unchanged.

### ⚠ Minor observations (not blockers)

1. **`shellQuote` is not exported**, so it's only testable indirectly. Acceptable: it's a 1-line internal helper. If someone adds a test for it later, exporting it for testing is a trivial change.
2. **Test coverage for the docker path is structural, not behavioural.** The `runCommandForAgent` + `shellQuote` interaction is only exercised by inspecting the assembled string (not by spawning a real container). This matches the project's "manual integration tests" pattern for docker; full E2E would require a Docker daemon in CI.
3. **`COOK_AGENT_ARGS_<AGENT>` casing.** Env-var name uses uppercase agent (`CLAUDE`, `CODEX`, `OPENCODE`). Matches the common shell convention and `COOK_MODEL`. If someone uses a mixed-case agent name in a future Gemini-like PR, they'll need `COOK_AGENT_ARGS_GEMINI` consistently — documented implicitly via the formula in the README env-var example.
4. **`shell.ts` change.** I added `config.agentArgs` as the 7th positional arg. The previous comment `// verbose` documented the 6th arg; consider whether to add a similar inline comment for the 7th. Decided against — the parameter name in `startSandbox` is self-documenting at the definition site; over-commenting at call sites tends to drift when signatures change.

### No findings

- No new dependencies in `dependencies` (`tsx` is `devDependencies` only — runtime stays clean).
- No log line additions / removals.
- No changes to existing config defaults beyond adding the new field.
- No changes to public CLI surface (no new flags) — entire feature is config-driven.

## Risks for Maintainer

- **Adding `tsx` as devDep.** Small (~1.5MB), zero runtime cost. Standard pattern. If the maintainer prefers Vitest (in flight per PR #21), the test file is a single `.mjs` with 15 tests — easy to port.
- **Docker users with restricted networks.** If a user passes `--mcp-config <url>` pointing at a remote server, the docker network restrictions (`network.allowedHosts`) still apply. Documented in README. No code change needed.

## Verdict

**LGTM.** Plan and implementation match. No blockers. Ready for human review.
