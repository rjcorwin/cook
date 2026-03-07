# Plan: Native Agent Sandbox as Default

**Status:** Draft
**Author:** AI
**Created:** 2026-03-06

## Summary

Flip cook's sandbox model so the default is to use each agent's own native sandbox/permissions system (Seatbelt, Landlock, permission rules) instead of Docker. Docker becomes a secondary mode (`sandbox: "docker"`), and a new `sandbox: "none"` mode exists for pre-isolated VMs. This eliminates Docker as a hard dependency, stops bypassing agent-level safety mechanisms with `--dangerously-skip-permissions`, and provides purpose-built autonomous configs that are safe by default — even with zero configuration.

## Motivation

1. **Docker is heavy.** Most users already have agent CLIs installed. Requiring Docker for every run is friction.
2. **Agent-native sandboxes are better.** Claude Code's Seatbelt/Landlock + permission rules, Codex's OS-level sandbox + approval policies — these provide fine-grained control that a Docker container with `--dangerously-skip-permissions` doesn't.
3. **User configs are wrong for autonomous runs.** A developer's daily-driver Claude settings shouldn't govern autonomous agent behavior. Cook needs purpose-built, restrictive configs.
4. **Safe by default.** Running `cook "do something"` with no init should work and be locked down.

## Goals

- Default sandbox mode is `"agent"` — agents use their own native sandbox
- `cook init` generates agent-specific config files in `.cook/agents/`
- Zero-config runs (no `cook init`) use hardcoded locked-down defaults
- Claude runs are fully isolated from user's `~/.claude/settings.json` via `CLAUDE_CONFIG_DIR`
- OpenCode + `sandbox: "agent"` is rejected with a clear error (no OS sandbox)
- Per-step sandbox mode overrides (reusing Decision 13)
- `cook doctor` is mode-aware
- Docker mode still works as before for users who want it

## Non-Goals

- Changing the work→review→gate loop structure
- Adding new agents
- Parallel step execution
- Network restriction controls for native mode (delegated to agent configs)
- Supporting agent versions older than those with the required config mechanisms

## Technical Design

### 1. `AgentRunner` interface and `RunnerPool`

Extract a common interface from the current `Sandbox` class. Three implementations: `NativeRunner`, `DockerSandbox` (renamed from `Sandbox`), and `BareRunner`.

**New file: `src/runner.ts`**

```typescript
import type { AgentName } from './config.js'

export interface AgentRunner {
  runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void,
  ): Promise<string>
  cleanup(): Promise<void>
}

export type SandboxMode = 'agent' | 'docker' | 'none'
```

**New file: `src/runner-pool.ts`**

```typescript
import type { AgentRunner, SandboxMode } from './runner.js'

export class RunnerPool {
  private runners = new Map<SandboxMode, AgentRunner>()

  constructor(
    private factory: (mode: SandboxMode) => AgentRunner | Promise<AgentRunner>,
  ) {}

  async get(mode: SandboxMode): Promise<AgentRunner> {
    if (!this.runners.has(mode)) {
      this.runners.set(mode, await this.factory(mode))
    }
    return this.runners.get(mode)!
  }

  async cleanupAll(): Promise<void> {
    for (const runner of this.runners.values()) {
      await runner.cleanup()
    }
    this.runners.clear()
  }
}
```

Per Decision r3k: lazy creation, cache by mode, single `cleanupAll()` at end.

### 2. `NativeRunner` — new default

**New file: `src/native-runner.ts`**

Spawns agent CLIs directly on the host with cook-managed configs.

**Per-agent invocation:**

**Claude:**
```bash
CLAUDE_CONFIG_DIR=/tmp/cook-claude-XXXXXX claude --model "$MODEL" -p < prompt.txt
```

Where the temp dir contains:
- `.credentials.json` — copied from `~/.claude/.credentials.json`
- `settings.json` — cook's permissions config

**Codex invocation:**
```bash
codex exec --sandbox workspace-write --ask-for-approval never --model "$MODEL" - < prompt.txt
```

No temp dir needed — CLI flags fully override security-critical config.

**OpenCode:** Rejected at validation time (Decision 10). OpenCode can only be used with `sandbox: "docker"` or `sandbox: "none"`.

**Config resolution order (per Decision 3):**

When `NativeRunner` needs agent config, it resolves in this order:
1. Check `agents.<name>.settings` in `.cook/config.json` for a custom path override
2. Check the conventional path `.cook/agents/<agent>.<ext>` (e.g., `.cook/agents/claude.json`)
3. Fall back to hardcoded defaults (same permissions as `cook init` generates)

File contents **replace** the hardcoded defaults entirely (no merge). This matches user expectations — if you customize `.cook/agents/claude.json`, that file is the full config.

**Per-agent config usage at runtime:**
- **Claude:** The resolved config is written to `settings.json` in the `CLAUDE_CONFIG_DIR` temp dir.
- **Codex:** If `.cook/agents/codex.toml` exists, NativeRunner reads it and extracts `sandbox_mode` and `approval_policy` values to pass as CLI flags (`--sandbox`, `--ask-for-approval`). CLI flags are the only reliable override mechanism — Codex has no flag to point to an alternate config file that fully replaces `~/.codex/config.toml`. If additional config keys are present (e.g., `sandbox_workspace_write.network_access`), they are passed via `--config key=value`.
- **OpenCode:** Rejected (Decision 10).

**Known limitation — project-level Claude settings:** `CLAUDE_CONFIG_DIR` isolates from `~/.claude/settings.json`, but Claude also loads project-level `.claude/settings.json` and `.claude/settings.local.json` from the working directory. These concatenate with cook's permissions. Since project-level settings are committed to the repo (i.e., trusted by the developer), this is acceptable — cook's allowlist still governs what the agent can do, and project-level settings can only widen permissions the developer has already approved for their repo.

**NativeRunner lifecycle:**
- On first Claude `runAgent()` call: create temp dir under `os.tmpdir()` with prefix `cook-claude-config-`
- Copy `~/.claude/.credentials.json` into it
- Write `settings.json` with cook's permissions
- Set `CLAUDE_CONFIG_DIR` env var when spawning Claude
- On `cleanup()`: kill any spawned child processes (via stored `ChildProcess` references), then delete temp dir

**Process spawning:** Use `child_process.spawn` with `{ stdio: ['pipe', 'pipe', 'pipe'] }`. Pipe prompt to stdin, stream stdout line-by-line via `LineBuffer` (existing utility), collect stderr for error reporting. NativeRunner must store `ChildProcess` references and register a `process.on('exit')` handler to kill spawned agents on unexpected termination (Ctrl-C, SIGTERM). Without this, orphaned `claude`/`codex` processes would persist — a behavioral regression from Docker mode where `container.remove({force: true})` handles cleanup automatically.

**TOML parsing dependency:** NativeRunner reads `.cook/agents/codex.toml` to extract CLI flags. Use `smol-toml` (zero-dependency, spec-compliant TOML parser) as a new dependency. Only 2-3 keys need extraction (`sandbox_mode`, `approval_policy`), but a proper parser avoids fragile regex and handles TOML edge cases correctly.

### 3. `DockerSandbox` — renamed from `Sandbox`

**Modify: `src/sandbox.ts`**

- Rename `Sandbox` class to `DockerSandbox`
- Implement `AgentRunner` interface (already matches — `runAgent` and `stop`→`cleanup`)
- Rename `stop()` to `cleanup()` for interface conformance
- Export `DockerSandbox` instead of `Sandbox`
- Move Docker-specific network config into this module (it's the only mode that uses it)

### 4. `BareRunner` — no sandbox

**New file: `src/bare-runner.ts`**

Spawns agents directly with full-bypass flags. **No config isolation** — uses the user's native agent config (e.g., `~/.claude/settings.json`, `~/.codex/config.toml`). No temp dirs, no `CLAUDE_CONFIG_DIR`. The user explicitly opts out of all sandboxing by choosing `sandbox: "none"`, so inheriting their personal config is expected.

| Agent | Command |
|-------|---------|
| Claude | `claude --dangerously-skip-permissions --model $MODEL -p < prompt` |
| Codex | `codex exec --dangerously-bypass-approvals-and-sandbox --model $MODEL - < prompt` |
| OpenCode | `opencode run -m $MODEL "$(cat prompt)"` |

### 5. Config changes

**Modify: `src/config.ts`**

Add `sandbox` field to `CookConfig`:

```typescript
export type SandboxMode = 'agent' | 'docker' | 'none'

export interface StepAgentConfig {
  agent?: AgentName
  model?: string
  sandbox?: SandboxMode  // per-step override (Decision 13)
}

export interface CookConfig {
  sandbox: SandboxMode  // new, default: 'agent'
  env: string[]
  animation: AnimationStyle
  agent: AgentName
  model?: string
  steps: Record<StepName, StepAgentConfig>
}
```

Config file location changes (Decision 4):
- `.cook.config.json` → `.cook/config.json`
- `.cook.Dockerfile` → `.cook/Dockerfile`
- New: `.cook/agents/claude.json`, `.cook/agents/codex.toml`, `.cook/agents/opencode.json`

`loadConfig()` changes:
1. First try `.cook/config.json` (new location)
2. Fall back to `.cook.config.json` (old location, for backward compat during migration)
3. Parse new `sandbox` field, default to `"agent"`
4. Parse per-step `sandbox` overrides

Docker-specific network config (Decision 9): Per the research, Docker-specific settings move to `.cook/docker.json`. `loadConfig()` loads this file only when `sandbox: "docker"`. The `network` field is removed from `CookConfig` and lives in a new `DockerConfig` type:

```typescript
export interface DockerConfig {
  network: {
    mode: 'restricted' | 'bridge' | 'none'
    allowedHosts: string[]
  }
}
```

`cook init` generates `.cook/docker.json` alongside the other files. `DockerSandbox` receives this config at construction time.

### 6. Default agent configs

**Hardcoded defaults** (used when no `.cook/agents/` files exist):

Claude (`settings.json` written to temp dir):
```json
{
  "permissions": {
    "allow": [
      "Read", "Glob", "Grep", "Edit", "Write",
      "Bash(npm run *)", "Bash(npm test *)", "Bash(npm install *)",
      "Bash(npx *)", "Bash(node *)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git checkout *)",
      "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
      "Bash(wc *)", "Bash(find *)", "Bash(grep *)",
      "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)"
    ]
  }
}
```
Note: `npm run *` instead of `npm *` prevents `npm publish`, `npm cache clean`, etc. `npm install` and `npm test` are allowed explicitly. The OS sandbox restricts filesystem operations to the project directory, so `mkdir *`, `cp *`, etc. are safe.

Codex: CLI flags only (`--sandbox workspace-write --ask-for-approval never`). No config file needed for defaults.

OpenCode: blocked from `sandbox: "agent"`.

**`cook init` generated files** use the same permissions (Decision 14). The generated files are editable copies of the hardcoded defaults. Note: `.cook/agents/opencode.json` is generated for documentation and future use only — OpenCode is blocked from `sandbox: "agent"` mode and uses the user's native config in `sandbox: "none"` mode. The generated file serves as a reference for what config would look like if OpenCode gains a native sandbox in the future.

### 7. `cook init` changes

**Modify: `cmdInit()` in `src/cli.ts`**

New file layout:
```
COOK.md                          (project root, unchanged)
.cook/
  .gitignore                     (new — ignores logs/)
  config.json                    (was .cook.config.json)
  docker.json                    (new — Docker-specific network config)
  Dockerfile                     (was .cook.Dockerfile)
  agents/
    claude.json                  (new)
    codex.toml                   (new)
    opencode.json                (new)
  logs/                          (unchanged)
```

- Generate `.cook/config.json` with `"sandbox": "agent"` as default
- Generate `.cook/agents/` with all three agent config files
- Generate `.cook/Dockerfile` with comment explaining it's for `sandbox: "docker"` mode
- Skip files that already exist (current behavior)
- Generate `.cook/.gitignore` with `logs/` entry (logs should not be committed; config files should be)

### 8. `cook doctor` changes

**Modify: `cmdDoctor()` in `src/cli.ts`**

Mode-aware checks:

**`sandbox: "agent"` mode:**
- Check agent CLI is installed on host (`which claude`, `which codex`)
- Check agent CLI version (warn if too old for required features)
- Verify auth credentials exist
- Check for `.cook/agents/` configs (warn if missing → will use hardcoded defaults)
- Validate OpenCode is not configured for this mode

**`sandbox: "docker"` mode:**
- Check Docker daemon is running (existing)
- Check base image exists (existing)
- Verify auth files for container copying (existing)

**`sandbox: "none"` mode:**
- Check agent CLI is installed
- Verify auth
- Warn about no isolation

### 9. CLI changes

**Modify: `src/cli.ts`**

- Add `--sandbox` flag: `cook --sandbox agent|docker|none "work prompt"`
- CLI flag overrides config file value
- Add to `ParsedArgs`, `parseArgs()`, `VALUE_FLAGS`
- In `runLoop()`: resolve sandbox mode, validate agent+sandbox combinations, create `RunnerPool`, pass to `agentLoop()`
- Update cleanup to use `RunnerPool.cleanupAll()` instead of `sandbox.stop()`

### 10. Agent loop changes

**Modify: `src/loop.ts`**

- Change `agentLoop` signature: accept `RunnerPool` instead of `Sandbox`
- Each step resolves its sandbox mode (step-level override or top-level default)
- Calls `pool.get(mode)` to get the right runner for each step
- Add `sandbox` to step config type

```typescript
export async function agentLoop(
  pool: RunnerPool,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter,
): Promise<void> {
  // ...
  for (const step of steps) {
    const mode = config.steps[step.name].sandbox ?? config.defaultSandbox
    const runner = await pool.get(mode)
    output = await runner.runAgent(...)
  }
}
```

### 11. Validation

**OpenCode + `sandbox: "agent"` rejection (Decision 10):**

Validate early — in `runLoop()` after resolving agent+sandbox for all steps. If any step has `agent: "opencode"` with `sandbox: "agent"`, exit with:

```
Error: OpenCode does not have a native OS sandbox. Use --sandbox docker or --sandbox none with OpenCode.
```

### 12. Environment variables and auth

**NativeRunner env setup:**
- Git config (`GIT_AUTHOR_NAME`, etc.) — pass through from host, same as Docker mode
- `config.env` passthrough — set these env vars on the spawned process
- `CLAUDE_CONFIG_DIR` — set to temp dir (Claude only)

**Auth in native mode:**
- Claude: `CLAUDE_CONFIG_DIR` temp dir contains `.credentials.json`
- Codex: uses host's `~/.codex/auth.json` directly (no isolation needed)
- OpenCode: blocked from agent mode

## Implementation Approach

Ordered for incremental, testable progress. Each step produces a working state.

### Phase 1: Interface extraction (no behavior change)

1. **Create `src/runner.ts`** — `AgentRunner` interface and `SandboxMode` type
2. **Rename `Sandbox` → `DockerSandbox`** in `src/sandbox.ts`, implement `AgentRunner` (rename `stop()` → `cleanup()`), update exports
3. **Update imports** in `src/loop.ts` and `src/cli.ts` to use new names
4. **Create `src/runner-pool.ts`** — `RunnerPool` class
5. **Update `agentLoop()`** signature to accept `RunnerPool` instead of `DockerSandbox`
6. **Update `runLoop()`** in CLI to create a `RunnerPool` that always returns `DockerSandbox` — no behavior change, just plumbing

**Verify:** existing Docker-based runs still work identically.

### Phase 2: Config changes

7. **Add `sandbox` to `CookConfig`** — new field with `"agent"` default
8. **Add per-step `sandbox` to `StepAgentConfig`**
9. **Update `loadConfig()`** — try `.cook/config.json` first, fall back to `.cook.config.json`; remove `network` from `CookConfig`
10. **Create `DockerConfig` type and `loadDockerConfig()`** — loads `.cook/docker.json` (only when `sandbox: "docker"`); migrate `network` settings from main config
11. **Add `--sandbox` CLI flag** — add to parser, pass through to runner resolution
12. **Add validation** — OpenCode + agent mode rejection

**Verify:** config loads correctly, `--sandbox docker` works with existing Docker path.

### Phase 3: Native runner

13. **Create `src/native-runner.ts`** — `NativeRunner` implementing `AgentRunner`
    - Config resolution: check `agents.<name>.settings` override → `.cook/agents/<agent>.<ext>` → hardcoded defaults
    - Claude: temp dir, `CLAUDE_CONFIG_DIR`, spawn process
    - Codex: read config file → extract values as CLI flags, spawn process
    - OpenCode: throw (should be caught by validation, but defensive)
14. **Hardcode default configs** — Claude permissions JSON, Codex CLI flags
15. **Wire up** — `RunnerPool` factory creates `NativeRunner` for `sandbox: "agent"`

**Verify:** `cook --sandbox agent "hello"` works with Claude (primary test target).

### Phase 4: Bare runner

16. **Create `src/bare-runner.ts`** — `BareRunner` implementing `AgentRunner`
    - All agents: spawn with `--dangerously-skip-permissions` / equivalent
    - No config isolation — uses the user's native agent config
17. **Wire up** — `RunnerPool` factory creates `BareRunner` for `sandbox: "none"`

**Verify:** `cook --sandbox none "hello"` works.

### Phase 5: `cook init` and `cook doctor`

18. **Update `cmdInit()`** — generate `.cook/config.json`, `.cook/docker.json`, `.cook/Dockerfile`, `.cook/agents/*`, `.cook/.gitignore`
19. **Update `cmdDoctor()`** — mode-aware checks
20. **Update `cook rebuild`** — if `sandbox` is not `"docker"`, print a message: "Rebuild is only relevant for Docker sandbox mode. Current mode: <mode>" and exit. Otherwise, proceed with existing Docker image rebuild.

**Verify:** `cook init` creates correct files, `cook doctor` reports correctly per mode.

### Phase 6: Cleanup

21. **Update banner** in `runLoop()` to show sandbox mode
22. **Update help text** with `--sandbox` option
23. **Remove old config file references** (`.cook.config.json`, `.cook.Dockerfile`) from docs/comments, keeping backward-compat loading in `loadConfig()`

## Alternatives Considered

### Keep Docker as default, add native as opt-in
Rejected — the whole point is that native should be the happy path. Docker-as-default trains users to depend on a heavy tool when their agent CLI already has better sandboxing.

### Single runner class with mode switching
Rejected — the three modes have fundamentally different setup, invocation, and cleanup. Separate classes with a shared interface is cleaner than a single class with mode-conditional branches.

### Generate agent configs in agent-native locations (`.claude/settings.local.json`, `.codex/config.toml`)
Rejected (Decision 2) — pollutes agent-native config directories. Keeping everything in `.cook/agents/` makes it clear these are cook-managed and avoids conflicts with user's own agent configs.

### Two-tier defaults (locked-down zero-config vs permissive `cook init`)
Rejected (Decision 14) — the agent's OS sandbox already restricts filesystem access. Overly restrictive zero-config would cause failures, training users to always run `cook init` first. One set of defaults is simpler.
