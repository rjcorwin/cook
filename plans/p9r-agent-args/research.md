# Research: Custom CLI Args for Agents (`agentArgs` config field)

**Requester:** oleksiimazurenko
**Date:** 2026-05-16

## Requirements

### Original Request
Allow cook users to pass arbitrary extra CLI flags to the underlying agent binary (claude, codex, opencode) through `.cook/config.json`. Today the args list is hardcoded in two places (`src/native-runner.ts` and `src/sandbox.ts`), so use-cases that need extra flags — most notably `--mcp-config` and `--add-dir` for Claude Code — cannot be expressed in cook config.

### Context

Cook currently invokes the agent CLIs with a fixed argument set per agent:

- **Native runner** (`src/native-runner.ts:111-127`):
  ```ts
  case 'claude':
    return { cmd: 'claude', args: ['--model', model, '--permission-mode', 'acceptEdits', '-p', ...bypassFlags] }
  ```
- **Docker sandbox** (`src/sandbox.ts:254-263`):
  ```ts
  case 'claude':
    return `claude --model "$COOK_MODEL" --dangerously-skip-permissions -p < /tmp/${promptFile}`
  ```

Claude Code's CLI exposes flags that some teams need at every invocation:

- `--mcp-config <path>` — load a project-scoped Model Context Protocol config (e.g. to enable Figma, Gandalf, Jira MCP servers inside the cook loop).
- `--add-dir <path>` — grant access to directories outside the current working directory (e.g. a shared `/tmp/cb/<concept>/` file bus, or a sibling Strapi worktree).
- `--system-prompt-append <text>` — append a permanent instruction to every step in the loop without editing COOK.md.
- `--permission-mode <mode>` — override the runner default (some users want `bypassPermissions` natively, not just in docker).

Without a config field for these, users either:
1. Maintain a private fork (loses upstream updates).
2. Wrap `claude` with a shell script that prepends flags (works for native, breaks in docker because the wrapper isn't shipped into the container).
3. Avoid cook entirely and reimplement the work/review/gate/ralph loop in shell.

### Existing config shape

`src/config.ts:17` — `CookConfig`:

```ts
export interface CookConfig {
  sandbox: SandboxMode
  env: string[]
  animation: AnimationStyle
  agent: AgentName
  model?: string
  steps: Record<StepName, StepAgentConfig>
  retry: RetryConfig
}
```

Loaded from `.cook/config.json` with safe field-by-field parsing — malformed values fall back to defaults with a `logWarn`. This pattern lets us add `agentArgs` without breaking older configs.

### Open Questions

- **Per-agent or flat list?** **Per-agent.** Each agent has a different CLI surface (claude vs codex vs opencode); a flat list would silently apply claude flags to codex and vice-versa. `agentArgs: Partial<Record<AgentName, string[]>>` keeps each list scoped.
- **Per-step override (e.g. only on `work`)?** **No, not in v1.** Adds config-shape complexity for a use-case nobody has reported. The same MCP / `--add-dir` flags are typically needed in every step; if a per-step need emerges later, extend by adding `steps.<name>.agentArgs`.
- **Env-var fallback?** **Yes.** `COOK_AGENT_ARGS_CLAUDE` (space-separated, shell-quoted) for one-off runs without editing config — mirrors the existing `COOK_MODEL` env conventions inside the sandbox.
- **Shell quoting in docker runner?** **Required.** The docker path builds a shell string interpolated into `sh -c '<cmd>'`. Naive concatenation is a shell-injection vector if extra args come from config (technically user-controlled, but still risky). Use POSIX single-quote escaping.
- **Validate that flags actually exist?** **No.** Cook should not know about every CLI flag of every agent — that's the agent's job. Cook passes args through; if a flag is wrong, the agent exits with a clear error.
- **Default value?** **Empty object `{}`** — feature is opt-in, no behavior change for existing users.

## System Architecture

### Related Components

| File | Reference | What it does |
|---|---|---|
| `src/config.ts:17` | `CookConfig` | Type definition for parsed config |
| `src/config.ts:68` | `loadConfig()` | Reads `.cook/config.json`, validates fields |
| `src/native-runner.ts:111` | `buildCommand()` | Builds claude/codex argv for native spawn |
| `src/native-runner.ts:10` | `NativeRunner` ctor | Currently `(projectRoot, env)` — needs agentArgs |
| `src/sandbox.ts:254` | `runCommandForAgent()` | Builds shell string for in-container exec |
| `src/sandbox.ts:265` | `runAgent()` | Calls `runCommandForAgent` — needs to thread args |
| `src/race.ts:60` | `createRunnerPool()` | Instantiates runners from config — needs to pass `config.agentArgs` |

### Data flow

```
.cook/config.json
   └─ agentArgs.claude: ["--mcp-config", ".cook/mcp.json"]
        │
        ▼
   loadConfig() → CookConfig.agentArgs
        │
        ▼
   createRunnerPool(projectRoot, config, runAgents)
        │
        ├─ native → new NativeRunner(projectRoot, env, agentArgs)
        │              └─ buildCommand() appends agentArgs[agent] to args
        │
        └─ docker → startSandbox(..., agentArgs)
                      └─ runAgent() → runCommandForAgent(agent, file, agentArgs[agent])
                           └─ shell-quoted, appended to command string
```

### Compatibility considerations

- **Backward-compatible**: missing `agentArgs` → `{}` default, no change to spawn args.
- **Forward-compatible**: schema is per-agent record, new agents (e.g. Gemini in PR #12) inherit the same shape automatically when added to `AgentName`.
- **Docker** runs the agent inside a network-restricted container (`src/sandbox.ts:165-213`). If `agentArgs.claude` includes `--mcp-config <path>`, the path must be reachable inside the container — i.e. under `projectRoot` (already bind-mounted) or explicitly added to `allowedHosts` if the MCP server is remote. Documented in README, not enforced.

## Prior Art

- No open issue or PR proposes this feature (verified via `gh issue list` / `gh pr list` for `mcp`, `args`, `permission`, `config`).
- Issue #27 ("--dangerously-skip-permissions cannot be used with root/sudo privileges") is adjacent — it's about a specific permission flag, not about config-level extensibility.
- PR #12 (DRAFT, "Add Gemini CLI support") expands `AgentName` — our `Partial<Record<AgentName, string[]>>` shape will pick up Gemini automatically when that PR merges, no follow-up needed.

## Decisions

1. **Add `agentArgs: Partial<Record<AgentName, string[]>>` to `CookConfig`** (decision over flat list).
2. **Append, do not replace** — extra args go AFTER cook's hardcoded args, so users can override permission-mode by specifying `--permission-mode bypassPermissions` (CLI semantics: last flag wins).
3. **Env-var fallback `COOK_AGENT_ARGS_<AGENT>`** for runtime overrides without editing config.
4. **POSIX single-quote escaping** in docker runner.
5. **README section** documenting common use-cases (MCP, add-dir) and the docker-path-reachability caveat.
6. **No validation** of flag names — pass-through.
