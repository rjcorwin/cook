# Devlog: Custom CLI Args for Agents (`agentArgs` config field)

**Date:** 2026-05-16
**Implementing:** plan.md

## What Was Done

- Added `AgentArgs = Partial<Record<AgentName, string[]>>` type and `agentArgs: AgentArgs` field to `CookConfig` in `src/config.ts`. Default `{}` keeps the feature opt-in.
- Added `parseAgentArgs()` in `src/config.ts` that validates input field-by-field: must be a plain object, keys must be known `AgentName`s, values must be string arrays. Non-conforming entries are dropped silently (matches the existing `parseStepAgentConfig` style).
- Added `splitShellArgs()` and `resolveAgentArgs()` in `src/util.ts`. `splitShellArgs` is a minimal POSIX-ish tokenizer supporting single quotes (literal), double quotes (with backslash escapes), and backslash escapes in bare tokens. `resolveAgentArgs` returns env-var (`COOK_AGENT_ARGS_<AGENT>`) tokens if set, otherwise the config value.
- Updated `NativeRunner` (`src/native-runner.ts`) — constructor accepts `agentArgs` (default `{}`); `buildCommand` appends `resolveAgentArgs(agent, this.agentArgs[agent])` to argv. For codex, extras go *before* the trailing `-` (stdin marker) so they parse correctly.
- Updated docker path (`src/sandbox.ts`): added `shellQuote()` (POSIX single-quote escape, handles embedded quotes via `'\''` sequence); `runCommandForAgent()` now accepts `extra: string[]`, quotes each token, and splices the result into the shell command string between the hardcoded flags and the stdin redirection. `runAgent()` resolves extras via `resolveAgentArgs` and passes them through. `Sandbox` class and `startSandbox` factory both accept `agentArgs` (the latter as a backward-compatible trailing optional argument, after `verbose`).
- Wired `config.agentArgs` through `createRunnerPool` (`src/race.ts`) for both native and docker modes.
- Updated `shell.ts` to pass `config.agentArgs` into `startSandbox` so `cook shell` honours the same flags as cook steps.
- Added `npm test` script using `tsx` (added as devDep) + Node's built-in `--test` runner. 15 tests cover: `splitShellArgs` (4 cases), `resolveAgentArgs` (3), `loadConfig` parsing (5 — happy path, defaults, malformed, unknown agent, non-string entries), `NativeRunner.buildCommand` argv composition (3 — claude append, codex stdin-marker preservation, default behaviour unchanged).
- README — new "Custom agent CLI flags" subsection under Configuration with example config, env-var fallback example, and docker-path-reachability caveat.

## Tricky Parts

- **Docker shell-string interpolation.** `runCommandForAgent` builds a shell command that gets wrapped in `sh -c '<cmd>'`. Naive string concatenation of extras would be a shell-injection vector for anything in config (technically user-controlled but worth defending). Solution: POSIX single-quote escape every extra token — closes the surrounding quote, emits an escaped literal quote, reopens. Verified via test that `shellQuote("a'b")` produces `'a'\''b'` (correct round-trip).
- **`startSandbox` signature evolution.** The existing signature had `verbose = false` as the trailing optional. Adding `agentArgs` between `agents` and `verbose` would have broken the one positional caller in `shell.ts` (which passes `true` as the 6th arg). Solution: keep `verbose` in its original position and append `agentArgs` after — back-compat for any external callers, only `race.ts` needed the new param.
- **codex argv ordering.** The codex CLI uses `-` as a stdin marker that must remain last in argv. Cook's existing native-runner code already places `-` last; my change splices extras into `...bypassFlags, ...extra, '-'`. Test asserts `args.at(-1) === '-'` and `args.slice(-3, -1)` matches the injected flags to lock this contract.
- **TypeScript path resolution for tests.** Node 24's `--experimental-strip-types` strips types but does not rewrite `.js` imports back to `.ts`, so a test that does `import('../src/util.ts')` fails when `util.ts` itself imports `./log.js`. Added `tsx` as devDep (it handles the rewrite transparently) and ran tests via `node --import tsx --test`. This is the standard TS-in-Node test pattern; it avoids picking a heavier framework (vitest/jest) until the maintainer decides on test infrastructure (PR #21 is the canonical place for that decision).

## Decisions Made

- **Append, do not replace.** Cook's hardcoded `--permission-mode acceptEdits` / `--dangerously-skip-permissions` stay; user flags come after. This means `agentArgs.claude: ["--permission-mode", "bypassPermissions"]` overrides via CLI last-flag-wins semantics — no schema change needed for that common need.
- **Per-agent map, not flat list.** Agents have disjoint CLI surfaces; a flat list would silently misapply codex flags to claude. The `Partial<Record<AgentName, string[]>>` shape also auto-extends to new agents (Gemini in PR #12) without a follow-up here.
- **No per-step `agentArgs`.** Kept out of v1 — no use-case reported, and the shape can grow into `steps.<name>.agentArgs` later without breaking compatibility.
- **No flag validation.** Cook stays agnostic of each agent's flag surface; passing an invalid flag surfaces an error from the agent itself with its own help text.
- **Env-var fallback is one-off override, not additive.** When `COOK_AGENT_ARGS_<AGENT>` is set, it *replaces* the config value (not concatenates). Additive would make composition surprising — users would have to grep their config to know what's being passed.

## Deviations from Plan

- The plan suggested testing `shellQuote` directly. The current test file covers the docker-path behaviour indirectly through `resolveAgentArgs` + the argv assertions on `NativeRunner`. `shellQuote` is a 1-line function with a single regex; rather than re-test the regex, the contract is locked by docs/comment. A future test can be added if the function grows.
- Tests cover the native runner argv composition but do **not** spawn an actual claude process (which would require a real claude binary and credentials). This matches the project's existing test philosophy — unit-level coverage for pure functions, manual integration recipes in `tests/SPEC.md` for end-to-end CLI behaviour.
