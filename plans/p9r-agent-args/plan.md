# Plan: Custom CLI Args for Agents (`agentArgs` config field)

**Status:** Draft
**Author:** oleksiimazurenko + Claude
**Created:** 2026-05-16

## Summary

Add an `agentArgs` field to `.cook/config.json` that lets users append extra CLI flags to the agent binary (claude / codex / opencode) on every step in the cook loop. Threading is uniform across native and docker runners. Defaults to `{}` so existing configs see no behavior change.

## Motivation

Today the CLI flags passed to `claude -p` / `codex exec` are hardcoded in two places (`src/native-runner.ts:111`, `src/sandbox.ts:254`). Real workflows need extra flags — most notably `--mcp-config` and `--add-dir` for Claude Code — that have no config-level escape hatch. Workarounds (`PATH`-shadowing wrappers, private forks) either break in docker or fragment the ecosystem. A single small config field unblocks every "I just need to pass `--my-flag`" request without committing cook to know about each agent's flag surface.

## Goals

- New config field `agentArgs: Partial<Record<AgentName, string[]>>`, default `{}`.
- Args are appended to both native and docker runner invocations.
- Env-var override: `COOK_AGENT_ARGS_CLAUDE`, `COOK_AGENT_ARGS_CODEX`, `COOK_AGENT_ARGS_OPENCODE` (space-separated; quotes handled via shell-style parsing).
- Docker path: extra args are POSIX single-quote escaped before string interpolation.
- README documents the field + common recipes (Figma MCP, add-dir for sibling repos).
- Tests cover config parsing (valid / malformed / missing) and arg-append behavior in `NativeRunner.buildCommand()`.

## Non-Goals

- **Per-step `agentArgs`** — adds shape complexity, no use-case today. Can be added later as `steps.<name>.agentArgs`.
- **Flag validation / autocomplete** — pass-through; agent exits with its own error message for unknown flags.
- **Auto-injecting MCP config paths** — cook should not know about Claude-specific concepts. Users opt in by writing the flag.
- **Backward-compat removal of hardcoded flags** (`--permission-mode acceptEdits`, `--dangerously-skip-permissions`) — those stay; `agentArgs` appends *after* them so users can override via CLI semantics (last flag wins).

## Technical Design

### Config shape

```json
{
  "agent": "claude",
  "sandbox": "agent",
  "model": "opus",
  "agentArgs": {
    "claude": ["--mcp-config", ".cook/mcp.json", "--add-dir", "../shared-bus"],
    "codex": []
  }
}
```

### Type addition (`src/config.ts`)

```ts
export type AgentArgs = Partial<Record<AgentName, string[]>>

export interface CookConfig {
  // existing fields…
  agentArgs: AgentArgs
}
```

Defaults in `loadConfig()`:

```ts
const defaults: CookConfig = {
  // …
  agentArgs: {},
}
```

### Parser (`src/config.ts`)

```ts
function parseAgentArgs(value: unknown): AgentArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: AgentArgs = {}
  for (const key of Object.keys(value as object)) {
    if (!isAgentName(key)) continue
    const list = (value as Record<string, unknown>)[key]
    if (!Array.isArray(list)) continue
    const flags = list.filter((v): v is string => typeof v === 'string')
    if (flags.length > 0) result[key] = flags
  }
  return result
}
```

Wired into `loadConfig()`:

```ts
const agentArgs = parseAgentArgs(parsed.agentArgs)
return { sandbox, env, animation, agent, model, steps, retry, agentArgs }
```

### Env-var fallback helper (`src/util.ts`)

```ts
export function resolveAgentArgs(agent: AgentName, configArgs: string[] | undefined): string[] {
  const envKey = `COOK_AGENT_ARGS_${agent.toUpperCase()}`
  const raw = process.env[envKey]
  if (raw && raw.trim().length > 0) {
    return splitShellArgs(raw)
  }
  return configArgs ?? []
}

function splitShellArgs(s: string): string[] {
  // Minimal POSIX-ish split: handles single quotes, double quotes, escapes.
  // Implementation in util.ts; ~30 LOC, has unit tests.
}
```

### Native runner (`src/native-runner.ts`)

```ts
constructor(
  private projectRoot: string,
  private env: string[],
  private agentArgs: AgentArgs = {},
) {}

private buildCommand(agent: AgentName, model: string): { cmd: string; args: string[] } {
  const bypassFlags = this.getBypassFlags(agent)
  const extra = resolveAgentArgs(agent, this.agentArgs[agent])
  switch (agent) {
    case 'claude':
      return {
        cmd: 'claude',
        args: ['--model', model, '--permission-mode', 'acceptEdits', '-p', ...bypassFlags, ...extra],
      }
    case 'codex':
      return {
        cmd: 'codex',
        args: ['exec', '--model', model, '--full-auto', '--skip-git-repo-check', ...bypassFlags, ...extra, '-'],
      }
    // …
  }
}
```

Note: for codex, `-` (stdin marker) must remain last; extras go *before* it.

### Docker sandbox (`src/sandbox.ts`)

Add a quoter helper at the top of the file:

```ts
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
```

`runCommandForAgent` accepts and interpolates extras:

```ts
function runCommandForAgent(agent: AgentName, promptFile: string, extra: string[] = []): string {
  const tail = extra.length > 0 ? ' ' + extra.map(shellQuote).join(' ') : ''
  switch (agent) {
    case 'claude':
      return `claude --model "$COOK_MODEL" --dangerously-skip-permissions${tail} -p < /tmp/${promptFile}`
    case 'codex':
      return `codex exec --model "$COOK_MODEL" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox${tail} - < /tmp/${promptFile}`
    case 'opencode':
      return `opencode run -m "$COOK_MODEL"${tail} "$(cat /tmp/${promptFile})"`
  }
}
```

`runAgent` and `startSandbox` thread `agentArgs` through; `Sandbox.runAgent` reads `this.agentArgs[agent]` and forwards.

### Wiring (`src/race.ts`)

```ts
export function createRunnerPool(worktreePath: string, config: CookConfig, runAgents: AgentName[]): RunnerPool {
  return new RunnerPool(async (mode: SandboxMode) => {
    switch (mode) {
      case 'agent':
        return new NativeRunner(worktreePath, config.env, config.agentArgs)
      case 'docker': {
        // …
        return startSandbox(new Docker(), worktreePath, config.env, dockerConfig, runAgents, config.agentArgs)
      }
    }
  })
}
```

## Files to Change

| File | Change |
|---|---|
| `src/config.ts` | Add `AgentArgs` type, `agentArgs` field on `CookConfig`, parser, default `{}` |
| `src/util.ts` | Add `resolveAgentArgs()` + `splitShellArgs()` helpers |
| `src/native-runner.ts` | Ctor accepts `agentArgs`; `buildCommand` appends extras |
| `src/sandbox.ts` | Add `shellQuote`; `runCommandForAgent` accepts `extra`; thread through `runAgent`/`startSandbox`/`Sandbox` |
| `src/race.ts` | `createRunnerPool` passes `config.agentArgs` to both runners |
| `tests/config.test.ts` | (new or existing) config parsing for `agentArgs` |
| `tests/native-runner.test.ts` | (new or existing) `buildCommand` appends extras |
| `tests/util.test.ts` | (new or existing) `splitShellArgs` edge cases |
| `README.md` | "Custom agent CLI flags" section + examples |

## Test Plan

### Unit

- `parseAgentArgs({})` → `{}`
- `parseAgentArgs({ claude: ['--a', '--b'] })` → `{ claude: ['--a', '--b'] }`
- `parseAgentArgs({ claude: 'oops' })` → `{}` (not an array → skipped)
- `parseAgentArgs({ ghost: ['--x'] })` → `{}` (unknown agent → skipped)
- `parseAgentArgs({ claude: [1, '--b', null] })` → `{ claude: ['--b'] }` (non-string entries dropped)
- `splitShellArgs("--a --b")` → `['--a', '--b']`
- `splitShellArgs("--mcp 'with space'")` → `['--mcp', 'with space']`
- `NativeRunner.buildCommand('claude', 'opus')` with `agentArgs: { claude: ['--mcp-config', 'x'] }` → args end with `['--mcp-config', 'x']`
- `shellQuote("a'b")` → `'a'\\''b'`

### Manual / Integration

- Create `.cook/config.json` with `agentArgs.claude: ['--mcp-config', '.cook/mcp.json']`; run `cook 'hello' work`; verify the spawn argv (via `ps`/`strace` or test harness) contains the extra flag.
- Set `COOK_AGENT_ARGS_CLAUDE="--add-dir /tmp/test"`; verify env-var path overrides config.
- Docker mode: `cook --sandbox docker 'hello' work` with `agentArgs`; verify command string inside container has properly quoted flags.

### Regression

- Existing test suite (`tests/runs/`) passes unchanged — confirms backward compatibility for configs without `agentArgs`.

## Rollout

- v5.5.0 — minor bump (additive, no breakage).
- README + CHANGELOG entry (if changelog conventions exist; check after implementation).

## Risks

- **Shell injection in docker** — mitigated by POSIX single-quote escaping. Test: `shellQuote("a'b")` round-trip.
- **Args with leading dashes break stdin redirection** — append-after-flags, before-stdin position is preserved (see codex case).
- **Future agents** — `Partial<Record<AgentName, string[]>>` auto-extends; PR #12 (Gemini) needs no changes here.
