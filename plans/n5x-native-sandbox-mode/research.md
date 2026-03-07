# Research: Native Agent Sandbox as Default

**Requester:** rjcorwin
**Date:** 2026-03-06

## Requirements

### Original Request

Flip cook's sandbox model: the **default** should be to use each agent's own native sandbox/permissions system, not Docker. Docker with `--dangerously-skip-permissions` becomes the secondary/fallback mode. A third "none" mode should exist for users running on already-locked-down VMs.

`cook init` should generate agent-specific config files (Claude settings, Codex config, OpenCode config) that cook points to. When running cook **without** `cook init` (no config files at all), cook should use a very locked-down hardcoded default so that the zero-config experience is safe by default.

Key motivations:
1. **No Docker dependency by default** — Docker is heavy. Most users already have agent CLIs installed. Native mode should be the happy path.
2. **Agent-native permissions are better** — Claude Code's Seatbelt/Landlock sandbox + permission rules, Codex's OS-level sandbox + approval policies, and OpenCode's permission system all provide fine-grained control that a Docker container with `--dangerously-skip-permissions` doesn't.
3. **Autonomous-safe configs** — A user's daily-driver settings are wrong for autonomous runs. cook needs to provide purpose-built configs: restrictive on destructive operations, permissive on routine ones.
4. **Safe by default** — Running `cook "do something"` with no init should work and be locked down hard. Users opt into more permissive configs explicitly via `cook init`.

### Context

Currently, cook's sandbox (`src/sandbox.ts`) does everything through Docker:
- Builds a base image with agent CLIs installed
- Creates containers with the project mounted as a volume
- Manages network restrictions via iptables
- Copies auth credentials into the container
- Runs agents with dangerous bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`)

This makes Docker a hard requirement and bypasses all agent-level safety mechanisms.

### Open Questions

1. **Naming for the three modes** — Need clear names for:
   - Agent's own sandbox (new default)
   - Docker container (current behavior, becomes secondary)
   - No sandbox at all (for pre-isolated environments)
   - Options: `sandbox: "agent" | "docker" | "none"`, or `sandbox: "native" | "docker" | "none"`

2. **Where do cook-generated agent configs live?** Should they go in `.cook/agents/`, or in each agent's own config directory (`.claude/`, `.codex/`)?

3. **How to pass cook's config to each agent** — each agent has different mechanisms (see Agent Config Research below). Claude has `--settings`, Codex has `--config` and `.codex/config.toml`, OpenCode has `OPENCODE_CONFIG` env var.

4. **What goes in the locked-down zero-config defaults?** — We need sensible defaults per agent that allow useful autonomous work (read, write, run tests) while blocking destructive ops (rm -rf, git push --force, network access).

5. **Per-step sandbox modes** — Cook already supports per-step agent/model overrides. Should sandbox mode also be per-step? Useful edge case: "work" in native (needs filesystem), "review" in none (just reading output).

6. **What happens to `network` config?** — Cook's current `network.mode` and `network.allowedHosts` settings only make sense in Docker mode. In native mode, network restrictions are delegated to the agent's own sandbox. Do we deprecate the cook-level network config, or keep it as a Docker-only option?

7. **Migration path** — Existing users have `.cook.config.json` with no `sandbox` field. What's the upgrade story? Default to native (breaking change but better UX) or default to docker (backward compat)?

## Agent Config Research

### Claude Code

**Settings mechanism:** Layered JSON settings files.

**File locations (in precedence order, highest last):**
- Managed: `/etc/claude-code/managed-settings.json` (Linux), `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS)
- User: `~/.claude/settings.json`
- Project: `.claude/settings.json` (committed to repo)
- Local: `.claude/settings.local.json` (gitignored)
- CLI override: `--settings <path-or-json>`

**Key finding: `--settings` flag exists.** Claude Code supports `--settings ./path/to/file.json` or `--settings '{"json":"inline"}'` to load additional settings.

**Also available:** `--allowedTools` and `--disallowedTools` CLI flags for per-invocation tool control, and `--permission-mode` to set the mode.

**Critical finding: Permission arrays concatenate, not replace.** Claude Code's settings layers merge permission arrays across scopes via concatenation and deduplication. If cook passes `--settings` with an allowlist, and the user's `~/.claude/settings.json` has additional `allow` entries (e.g., `Bash(rm -rf *)`), **both lists are active**. Cook cannot prevent user settings from expanding the allowlist via `--settings` alone.

Precedence order: managed > CLI args (`--settings`) > local project > shared project > user. But arrays at different scopes are concatenated, not replaced. Only scalar values follow strict precedence.

There is also [an open bug (issue #17017)](https://github.com/anthropics/claude-code/issues/17017) where project-level permissions sometimes replace rather than merge with global permissions — but this inconsistent behavior can't be relied upon for safety.

**Mitigation options for config isolation:**
1. **Set `CLAUDE_CONFIG_DIR` to a cook-managed temp directory** — `CLAUDE_CONFIG_DIR` is supported (since v1.0.30+) and redirects where Claude looks for global config (`settings.json`, credentials, etc.). Cook can create a temp directory, copy only the auth credentials into it, and set `CLAUDE_CONFIG_DIR` to that path. Claude won't find the user's `~/.claude/settings.json`. This is the cleanest option — it isolates config while preserving auth.
2. **Set `HOME` to a temp directory** — prevents Claude from finding `~/.claude/settings.json`. Simple but heavy-handed — may break auth and other tools that depend on `HOME`.
3. **Use managed settings path** — write to the managed settings location (`/etc/claude-code/managed-settings.json` on Linux). Managed settings can't be overridden. But requires elevated permissions and affects all Claude sessions system-wide.
4. **Accept the merge and rely on headless blocking** — in non-interactive mode, even if extra tools are "allowed," the agent still can't do anything truly dangerous without a TTY for approval of tools that aren't in cook's allowlist. But this is weaker: the user's personal settings could explicitly allow destructive tools.
5. **Use `--disallowedTools` CLI flag** — pass an explicit deny list via CLI. Since deny > allow in evaluation order, this would override any user-level allows. But this brings back the "incomplete deny list" problem.

**Recommended: Option 1 (`CLAUDE_CONFIG_DIR`).** Cook creates a temp directory per run, copies auth credentials from `~/.claude/` (or `~/.config/claude/`), writes cook's settings file into it, and sets `CLAUDE_CONFIG_DIR` to that path. This achieves full isolation from user settings while preserving API authentication.

**Auth credential files to copy (verified):**
- `.credentials.json` — contains `claudeAiOauth` (OAuth tokens). This is the **only** file needed for authentication.

**Files explicitly excluded (stay in user's real `~/.claude/`):**
- `settings.json` — user preferences/permissions (this is what we're isolating from)
- `history.jsonl`, `stats-cache.json`, `file-history/`, `session-env/`, `projects/`, `cache/`, `todos/`, `plugins/`, `debug/`, `backups/`, `downloads/`, `paste-cache/`, `shell-snapshots/`, `tasks/`, `telemetry/`, `ide/` — session/state data not needed for autonomous runs

**Temp directory contents (exactly two files):**
1. `.credentials.json` — copied from `~/.claude/.credentials.json`
2. `settings.json` — written by cook with its permissions config

**Temp directory lifecycle:**
- Created in `NativeRunner` on first Claude `runAgent()` call, under `os.tmpdir()` with a `cook-` prefix (e.g., `cook-claude-config-XXXXXX`)
- Deleted in `AgentRunner.cleanup()`
- OS cleans up stale temp dirs on reboot as a safety net for crashes

**Settings format:**
```json
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Edit(/src/**)",
      "Write(/src/**)",
      "Bash(npm run test *)",
      "Bash(npm run build *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ]
  }
}
```
Allowlist-only approach: unlisted tools default to `ask`, which blocks in non-interactive/headless mode. No `deny` list needed — anything not explicitly allowed simply can't be used.

**Permission pattern syntax:**
- `Tool` — matches all uses of that tool
- `Tool(specifier)` — pattern matching with `*` wildcards
- `Bash(command *)` — matches shell commands (space-sensitive: `Bash(ls *)` matches `ls -la`)
- `Read(/path/**)` — gitignore-style path patterns; `/path` = project root, `//path` = absolute, `~/path` = home
- Evaluation order: deny > ask > allow (first match wins)

**How to invoke for cook:**
```bash
claude --settings .cook/agents/claude.json --model "$MODEL" -p < prompt.txt
```
No `--dangerously-skip-permissions` needed — the settings file pre-approves the right tools.

### Codex CLI

**Settings mechanism:** TOML config files with layered precedence.

**File locations:**
- User: `~/.codex/config.toml`
- Project: `.codex/config.toml` (requires project trust)
- CLI override: `--config key=value` (individual keys) or `--profile name`

**Sandbox modes (OS-level, not Docker):**
- `read-only` — file reading and queries only; approval needed for edits/commands/network
- `workspace-write` — read/edit in workspace; network off by default; approval for out-of-workspace edits
- `danger-full-access` — no sandbox, no approvals

**OS mechanisms:** macOS uses Seatbelt (`sandbox-exec`), Linux uses Landlock + seccomp, Windows uses WSL.

**Approval policies:**
- `untrusted` — auto-approve safe reads; ask for state-mutating commands
- `on-request` — ask before edits outside workspace or network access
- `never` — no approval prompts (for automation)

**Key config fields for cook:**
```toml
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false
writable_roots = []
```

**How to invoke for cook:**
```bash
codex exec --sandbox workspace-write --ask-for-approval never --model "$MODEL" - < prompt.txt
```
Alternatively, with a config file:
```bash
codex exec --config sandbox_mode=workspace-write --config approval_policy=never --model "$MODEL" - < prompt.txt
```

**Key finding:** Codex's `--sandbox` and `--ask-for-approval` CLI flags let us set sandbox mode without a config file. For the zero-config default, we can pass these flags directly. For `cook init`, we can generate a `.codex/config.toml` or use `--config` overrides.

**Config isolation finding:** CLI flags (`--sandbox`, `-a`/`--ask-for-approval`) fully override their corresponding config file values for that invocation. `--config key=value` overrides individual keys. However, there is no flag to skip loading `~/.codex/config.toml` entirely — other config values from the user's config (beyond sandbox/approval) would still be loaded.

**`CODEX_HOME` env var:** Codex stores all state under `CODEX_HOME` (defaults to `~/.codex`). Setting `CODEX_HOME` to a cook-managed temp directory would fully isolate from user config, same pattern as `CLAUDE_CONFIG_DIR`. For the critical settings (sandbox_mode, approval_policy, network_access), CLI flags are sufficient since they override config values. But for full isolation, `CODEX_HOME` is available if needed.

**Assessment:** Unlike Claude Code where permission arrays concatenate dangerously, Codex's security-critical settings (`--sandbox`, `-a`) are scalar values where CLI flags win outright. The user's `~/.codex/config.toml` cannot weaken cook's sandbox or approval settings when passed via CLI flags.

**Decided: CLI flags only, no `CODEX_HOME` isolation.** Since Codex's security-critical settings are scalars fully overridden by CLI flags, there is no security benefit to redirecting `CODEX_HOME`. Unlike Claude's array concatenation problem, user config cannot weaken cook's sandbox or approval settings. Adding `CODEX_HOME` isolation would mean another temp directory to manage, auth credentials to discover/copy, and cleanup to handle — all for no security gain. Keep it simple.

**Note:** Codex also supports `--full-auto` which combines `on-request` approvals + `workspace-write` sandbox. Close to what we want but not quite locked down enough (it still allows approval prompts, which won't work headless). We want `approval_policy = "never"` with explicit sandbox restrictions.

### OpenCode

**Settings mechanism:** JSON/JSONC config files, merged in precedence order.

**File locations:**
- Global: `~/.config/opencode/opencode.json`
- Custom: `OPENCODE_CONFIG` env var → any path
- Project: `opencode.json` in project root
- Inline: `OPENCODE_CONFIG_CONTENT` env var → JSON string

**Key finding: `OPENCODE_CONFIG` env var exists.** Cook can set this to point to a cook-managed config file without touching the user's global config.

**Critical finding: Config layers deep-merge, not replace.** OpenCode uses `remeda.mergeDeep()` to combine configs across layers. For nested objects like `permission.bash`, keys from all layers are combined. If a user's global config has `"rm *": "allow"` and cook's config has `"*": "deny"`, **both keys survive the merge** — and since last-match-wins applies to pattern evaluation, the user's `"rm *": "allow"` could override cook's `"*": "deny"` depending on key ordering.

**Config loading order (later overrides earlier for conflicting keys):**
1. Remote config (from `.well-known/opencode`)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json` in project root)
5. Runtime overrides (`OPENCODE_CONFIG_CONTENT` env var)

Since `OPENCODE_CONFIG` is priority 3 and global is priority 2, cook's config values override global for conflicting keys. But deep merge means non-conflicting keys from global survive. A user's bash permission rules that don't conflict with cook's rules would persist.

**Available env vars:** `OPENCODE_CONFIG` (custom config file path), `OPENCODE_CONFIG_DIR` (custom config directory for agents/commands/modes/plugins), `OPENCODE_CONFIG_CONTENT` (inline JSON config, highest priority), `OPENCODE_TUI_CONFIG` (TUI config).

**No equivalent of `CLAUDE_CONFIG_DIR` or `CODEX_HOME`.** There is no env var to redirect where OpenCode looks for `~/.config/opencode/opencode.json`. `OPENCODE_CONFIG_DIR` only controls agents/commands/modes/plugins, not the main config. Full isolation from user config is **not possible** via documented env vars alone.

**Mitigation for config isolation:** Since Decision 10 already blocks OpenCode from `sandbox: "agent"` mode (no OS sandbox), and OpenCode in `sandbox: "docker"` mode runs inside a container where user config doesn't exist, the merge problem is moot for Docker. For `sandbox: "none"`, the user explicitly opts out of isolation — config merging is acceptable since they're taking responsibility. If full isolation is ever needed, cook could set `HOME` to a temp directory or manipulate `XDG_CONFIG_HOME`.

**Headless behavior: `opencode run` auto-rejects "ask" permissions.** Since PR #11814, `opencode run` is always non-interactive — tool calls that would trigger a permission prompt are automatically rejected. This means cook's `"*": "deny"` + specific allows pattern works correctly: denied commands are blocked, allowed commands proceed, and any "ask" commands are auto-rejected. No hanging.

**Permission system:**
```json
{
  "permission": {
    "edit": "allow",
    "bash": {
      "*": "deny",
      "npm run test *": "allow",
      "npm run build *": "allow",
      "git status *": "allow",
      "git diff *": "allow",
      "git log *": "allow",
      "git add *": "allow",
      "git commit *": "allow"
    },
    "webfetch": "deny"
  }
}
```

**Permission values:** `"allow"`, `"ask"`, `"deny"`
**Bash patterns:** glob-style, last matching rule wins (opposite of Claude's first-match-wins).

**How to invoke for cook:**
```bash
OPENCODE_CONFIG=.cook/agents/opencode.json opencode run -m "$MODEL" "$(cat prompt.txt)"
```

## System Architecture

### Related Components

**Sandbox system** (`src/sandbox.ts`, 413 lines):
- `Sandbox` class manages the full Docker lifecycle
- `runAgent()` and `runCommandForAgent()` — agent invocation commands
- Network setup, auth credential copying

**Config system** (`src/config.ts`, 87 lines):
- `CookConfig` type — needs new `sandbox` field
- `loadConfig()` — needs to handle missing config (zero-config defaults)

**Agent loop** (`src/loop.ts`, 102 lines):
- `agentLoop()` — currently receives `Sandbox` instance, needs to accept an abstracted runner

**CLI** (`src/cli.ts`, 555 lines):
- `cook doctor` — needs mode-aware checks
- `cook init` — needs to generate agent config files
- `runLoop()` — needs to create the right runner based on sandbox mode

### Data Flow

**Native mode (new default):**
```
CLI → resolve sandbox="agent" from config (or default)
  → create NativeRunner(agentConfigs)
  → agentLoop(runner, ...)
    → runner.runAgent("claude", model, prompt)
      → spawn: claude --settings .cook/agents/claude.json -p < prompt
      → stream output back
```

**Docker mode (secondary):**
```
CLI → resolve sandbox="docker" from config
  → create DockerSandbox(config)  # current Sandbox class
  → agentLoop(runner, ...)
    → runner.runAgent("claude", model, prompt)
      → docker exec: claude --dangerously-skip-permissions -p < prompt
      → stream output back
```

**None mode (pre-isolated VMs):**
```
CLI → resolve sandbox="none" from config
  → create BareRunner()
  → agentLoop(runner, ...)
    → runner.runAgent("claude", model, prompt)
      → spawn: claude --dangerously-skip-permissions -p < prompt  # no sandbox, trusts environment
      → stream output back
```

### Constraints

- **Safe by default** — Zero-config runs (no `cook init`) must use locked-down hardcoded settings. No destructive operations, no network, no out-of-workspace writes.
- **No TTY** — All modes pipe prompts via stdin. Agents run non-interactively. Permission systems must be pre-configured to avoid interactive approval prompts.
- **Agent CLI required on host** — In native mode, the agent CLI must be installed locally. `cook doctor` must verify this.
- **Cross-platform** — Native sandbox mechanisms differ by OS (Seatbelt on macOS, Landlock on Linux). This is the agent's problem, not cook's — but cook should be aware of it for doctor/diagnostics.
- **Don't touch user's own settings** — Cook must not overwrite `.claude/settings.local.json` or `~/.codex/config.toml`. Use CLI flags (`--settings`) or env vars (`OPENCODE_CONFIG`) to inject cook-specific config.

## Proposed Default Configs

### Decision 14: Single set of default permissions

**Decided:** One set of defaults used everywhere — both zero-config (no `cook init`) and `cook init` generated configs use the same permission set. The original two-tier design (locked-down zero-config vs permissive `cook init`) was collapsed because:

1. The agent's OS-level sandbox (Seatbelt/Landlock) already restricts filesystem access to the project directory. A permission like `Bash(mkdir *)` doesn't let the agent escape — the OS sandbox blocks operations outside the project.
2. The overly restrictive zero-config tier would cause most real tasks to fail, training users to always run `cook init` first and making the zero-config path pointless.
3. Having one set of defaults is simpler to maintain and reason about.

### Default configs (used for both zero-config and `cook init`)

For zero-config runs (no `.cook/` directory), these are hardcoded. For `cook init`, these are written to `.cook/agents/` as editable files. Same permissions either way.

**Claude — `--settings` JSON (hardcoded or `.cook/agents/claude.json`):**
```json
{
  "permissions": {
    "allow": [
      "Read", "Glob", "Grep", "Edit", "Write",
      "Bash(npm *)", "Bash(npx *)", "Bash(node *)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git checkout *)",
      "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
      "Bash(wc *)", "Bash(find *)", "Bash(grep *)",
      "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)"
    ]
  }
}
```
Allowlist-only. Anything not listed (rm, curl, sudo, git push, etc.) hits `ask` and blocks in headless mode. The agent's OS sandbox (Seatbelt/Landlock) restricts filesystem operations to the project directory, so broad patterns like `Bash(mkdir *)` are safe.

**Codex — CLI flags (hardcoded) or `.cook/agents/codex.toml`:**
```toml
# Codex config for autonomous cook runs
# See: https://developers.openai.com/codex/config-reference/

sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false
```
(Network off by default in workspace-write, approval off for headless.)

**OpenCode — `OPENCODE_CONFIG_CONTENT` (hardcoded) or `.cook/agents/opencode.json`:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "allow",
    "bash": {
      "*": "deny",
      "npm *": "allow",
      "npx *": "allow",
      "node *": "allow",
      "git status *": "allow",
      "git diff *": "allow",
      "git log *": "allow",
      "git add *": "allow",
      "git commit *": "allow",
      "git checkout *": "allow",
      "ls *": "allow",
      "cat *": "allow",
      "find *": "allow",
      "grep *": "allow",
      "mkdir *": "allow",
      "cp *": "allow",
      "mv *": "allow"
    },
    "webfetch": "deny"
  }
}
```
Uses `"*": "deny"` as base with explicit allows (last-match-wins). `webfetch` explicitly denied since OpenCode doesn't have an implicit ask/block for headless mode.

## Prior Art

### Agent Sandbox Mechanisms

| Agent | OS Sandbox | Config Override Mechanism | Network Control |
|-------|-----------|--------------------------|----------------|
| Claude Code | Seatbelt (macOS), Landlock (Linux) | `--settings <path>` flag | Via `sandbox.network` in settings |
| Codex | Seatbelt (macOS), Landlock+seccomp (Linux) | `--sandbox`, `--config` flags; `.codex/config.toml` | `sandbox_workspace_write.network_access` |
| OpenCode | None built-in (relies on Docker for isolation) | `OPENCODE_CONFIG` env var | `webfetch` permission |

### Key Differences in Agent Config Injection

- **Claude:** `--settings` flag loads additional settings that merge with existing ones. Clean, non-destructive.
- **Codex:** `--config key=value` overrides individual keys. `--sandbox` and `--ask-for-approval` flags set the two most important options directly. Can also use project `.codex/config.toml`.
- **OpenCode:** `OPENCODE_CONFIG` env var points to a config file. `OPENCODE_CONFIG_CONTENT` injects JSON inline. Merges with other config sources.

### Other Orchestrators

- **Aider** — Runs agents directly on host, no sandboxing. Relies on user trust.
- **Continue.dev** — IDE-based, inherits IDE's permission model.
- **Cursor** — IDE sandbox with permission prompts.

## Decisions to Make

### Decision 1: Sandbox mode names

**Decided:** `sandbox: "agent" | "docker" | "none"`

- `"agent"` — Use the agent's own native sandbox. This is the default.
- `"docker"` — Use cook's Docker container. Falls back to `--dangerously-skip-permissions`.
- `"none"` — No sandbox at all. Agent runs bare on host with `--dangerously-skip-permissions`. For pre-isolated VMs.

`"agent"` chosen over `"native"` — more specific about *whose* sandbox is being used.

### Decision 2: Agent config file location

**Decided:** `.cook/agents/<agent-name>.<ext>`

```
.cook/
  agents/
    claude.json       # Claude Code settings
    codex.toml        # Codex config
    opencode.json     # OpenCode config
  config.json         # cook's own config
  Dockerfile          # Docker sandbox image (for sandbox: "docker")
  logs/
```

Everything lives in `.cook/`. Committed to repo, clearly cook-managed. Users edit agent configs to customize autonomous behavior.

### Decision 3: Config reference in `.cook/config.json`

**Proposed:** Agent configs are at well-known paths by convention. If a user wants to override:

```json
{
  "sandbox": "agent",
  "agents": {
    "claude": { "settings": ".cook/agents/claude.json" },
    "codex": { "settings": ".cook/agents/codex.toml" },
    "opencode": { "settings": ".cook/agents/opencode.json" }
  }
}
```

The `agents.<name>.settings` field is optional — if omitted, cook looks at the conventional path. If that doesn't exist, uses the hardcoded locked-down default.

### Decision 4: `cook init` changes

**Decided:** `cook init` generates everything into `.cook/`:

- `COOK.md` — still in project root (visible, important)
- `.cook/config.json` — cook config (moved from `.cook.config.json`)
- `.cook/Dockerfile` — Docker sandbox image (moved from `.cook.Dockerfile`)
- `.cook/agents/claude.json` — new
- `.cook/agents/codex.toml` — new
- `.cook/agents/opencode.json` — new
- `.cook/logs/` — unchanged

Dockerfile always generated (with comments explaining it's for `sandbox: "docker"` mode). Default `sandbox` value in generated config: `"agent"`.

### Decision 5: Interface abstraction

```typescript
interface AgentRunner {
  runAgent(agent: string, model: string, prompt: string): Promise<PassThrough>
  cleanup(): Promise<void>
}

class NativeRunner implements AgentRunner { ... }   // new default
class DockerSandbox implements AgentRunner { ... }   // current Sandbox, renamed
class BareRunner implements AgentRunner { ... }      // no sandbox
```

### Decision 6: CLI flag for sandbox override

```bash
cook --sandbox agent "refactor auth"     # explicit agent sandbox
cook --sandbox docker "refactor auth"    # force Docker mode
cook --sandbox none "refactor auth"      # no sandbox
```

### Decision 7: `cook doctor` changes

Doctor should be mode-aware:
- **agent mode:** Check agent CLI is installed, check version, verify auth, check for cook agent config (warn if missing → will use locked-down defaults)
- **docker mode:** Check Docker is running, check base image exists, verify auth files
- **none mode:** Check agent CLI is installed, verify auth, warn about no isolation

### Decision 8: Migration / backward compatibility

**Decision: Default to `"agent"` for everyone.** This is a breaking change but the right one. cook currently has a single user (rjcorwin), so there's no migration burden. The new default is strictly better — no Docker dependency, proper agent-level sandboxing instead of blanket `--dangerously-skip-permissions`. No need for backward-compat shims or auto-detection logic.

### Decision 9: What happens to `network` config and Docker-specific settings?

Cook's `network.mode` and `network.allowedHosts` only apply to Docker's iptables. In agent mode, network control is delegated to the agent's own config files. These Docker-specific settings don't belong in the main cook config anymore.

**Option A: Separate Docker config file**
```
.cook/
  config.json          # cook config (sandbox mode, agent, model, steps, etc.)
  docker.json          # Docker-specific: network rules, Dockerfile path, etc.
  Dockerfile
  agents/
```
`docker.json` would contain:
```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": ["registry.npmjs.org"]
  }
}
```
Clean separation — Docker settings only loaded when `sandbox: "docker"`. Main config stays agent-agnostic.

**Option B: Nest under `docker` key in main config**
```json
{
  "sandbox": "agent",
  "agent": "claude",
  "docker": {
    "network": { "mode": "restricted", "allowedHosts": [] }
  }
}
```
Fewer files but pollutes the main config with mode-specific settings.

**Option C: Keep `network` in main config, ignore in non-docker modes**
Current structure, just document it as Docker-only. Simplest but confusing — users see `network` config that silently does nothing in agent mode.

**Decided: Option A — `.cook/docker.json`.** Clean separation. Docker settings only loaded when `sandbox: "docker"`. Main config stays agent-agnostic. The `network` field moves out of `.cook/config.json` entirely.

### Decision 10: OpenCode incompatible with agent sandbox mode

OpenCode has no OS-level sandbox (no Seatbelt, no Landlock). Its permission system controls what the agent *chooses* to do, but doesn't enforce isolation at the OS level. Unlike Claude Code and Codex, which have real OS-enforced sandboxes, OpenCode's "permissions" are advisory.

**Decided:** If a user requests `sandbox: "agent"` with OpenCode, cook must **warn and exit** with a clear error message explaining that OpenCode lacks a native sandbox. OpenCode can be used with `sandbox: "docker"` (full isolation) or `sandbox: "none"` (explicitly opting out of isolation, user takes responsibility). This prevents a false sense of security.

### Decision 11: No config merging — cook provides isolated config

Cook must not merge with or inherit from the user's personal agent settings (`~/.claude/settings.json`, `~/.codex/config.toml`, etc.). Cook's agent config is the **only** config for that run.

**Research findings:**
- **Claude Code:** `--settings` does NOT replace user settings — permission arrays are **concatenated** across scopes. A user's personal `allow` rules would expand cook's intended allowlist. This is a real security gap.
- **Codex:** CLI flags (`--sandbox`, `--ask-for-approval`) fully override their config file counterparts — these are scalar values, not arrays, so no concatenation problem. User's `~/.codex/config.toml` cannot weaken sandbox or approval settings passed via CLI. `CODEX_HOME` env var is available for full isolation if needed, but CLI flag overrides are sufficient for security-critical settings.
- **OpenCode:** `OPENCODE_CONFIG` deep-merges with global config (`~/.config/opencode/opencode.json`) — non-conflicting keys from user config survive. No env var exists to redirect the global config location. However, this is **moot in practice**: Decision 10 blocks OpenCode from `sandbox: "agent"` mode, Docker mode runs in a container without user config, and `sandbox: "none"` is an explicit opt-out of isolation.

**Decided: Use `CLAUDE_CONFIG_DIR` for Claude Code isolation.** Cook creates a temporary config directory per run, copies only auth credentials from the user's Claude config, and writes cook's settings into it. Sets `CLAUDE_CONFIG_DIR` to this temp directory so Claude only sees cook's config. This achieves full isolation without breaking authentication. See the Claude Code section above for the full analysis of options.

### Decision 12: Allowlist-only permissions approach

Instead of maintaining both allow and deny lists, cook uses an **allowlist-only** approach for agent permissions:

- **Claude Code:** Only specify `permissions.allow`. Unlisted tools default to `ask`, which blocks in headless/non-interactive mode (no TTY to prompt). No deny list needed.
- **Codex:** Already allowlist-style via `sandbox_mode = "workspace-write"` with `network_access = false`. No explicit permission rules needed.
- **OpenCode:** Uses `"*": "deny"` as base rule with specific allows after (last-match-wins). Explicit deny needed because OpenCode lacks an implicit ask/block for headless mode.

This eliminates the problem of incomplete deny lists — you don't need to enumerate every dangerous command when only safe commands are allowed.

### Decision 13: Per-step sandbox modes

**Decided:** Sandbox mode is per-step, not global. Cook already supports per-step `agent` and `model` overrides. Sandbox mode follows the same pattern.

```json
{
  "sandbox": "agent",
  "steps": [
    { "prompt": "implement the feature", "agent": "claude", "sandbox": "agent" },
    { "prompt": "review the changes", "agent": "claude", "sandbox": "none" }
  ]
}
```

The top-level `sandbox` is the default. Each step can override it. This enables patterns like "work in a sandbox, review without one" or "use Docker for OpenCode steps, native for Claude steps."

Validation still applies per-step: OpenCode + `sandbox: "agent"` is an error regardless of whether it's set at the top level or step level.
