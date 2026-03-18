# Research: Sandbox Security When Cook Runs as a Subagent Skill

**Requester:** rj
**Date:** 2026-03-18

## Requirements

### Original Request
When cook is installed as a Claude Code skill (`/cook`), does `--sandbox none` constitute a privilege escalation? Can the agent bypass config-based locks? How do we guarantee the child process can't escalate beyond the parent's permissions?

### Decision
Remove `--sandbox none` entirely. If you need more control, configure it explicitly rather than blanket-disabling all safety.

## System Architecture

### Two Independent Security Layers

1. **OS-level sandbox** (Seatbelt on macOS, Landlock/bubblewrap on Linux): Kernel-enforced on the entire process tree. Child processes inherit restrictions and **cannot escape** regardless of flags.

2. **Permission prompting** (`--dangerously-skip-permissions`): Controls whether Claude Code prompts the user before taking actions. Application-level check, not OS enforcement.

### How Cook's Three Sandbox Modes Work

| Mode | Claude flags | Effect |
|------|-------------|--------|
| `agent` | `--permission-mode acceptEdits -p` | Native OS sandbox, auto-accept edits |
| `none` | `--permission-mode acceptEdits -p --dangerously-skip-permissions` | OS sandbox, skip ALL prompts |
| `docker` | `--dangerously-skip-permissions` (inside container) | Full isolation via Docker |

All three use pipe mode (`-p`) with `stdio: ['pipe', 'pipe', 'pipe']` — no TTY.

## Testing Results (2026-03-18)

### `--sandbox agent` works in pipe mode

Tested with three scenarios:
1. **File creation**: Child agent created `index.html` (229 bytes) — works via `acceptEdits`
2. **Bash command**: Child ran `echo SANDBOX_TEST_PASSED > file` — Bash works in pipe mode
3. **OS sandbox enforcement**: Child tried to write to `/tmp` — **blocked by Seatbelt**. Child adapted and wrote to working directory instead.
4. **Full coding task**: "Create a todo app" — completed successfully (86-line index.html), child used both file edits and Bash within the project

**Conclusion**: `--sandbox agent` is fully viable for cook's use cases. The child agent can edit files, run Bash, and do real coding work — all confined to the project directory by the OS sandbox.

## Attack Vectors

### Attack 1: Config-based lock is bypassable
If `sandboxLock` is in `.cook/config.json`, the agent can modify the config. **Config-based enforcement is security theater.**

### Attack 2: Agent ignores skill instructions
The skill says "don't use --sandbox none" but the agent can construct `Bash(cook "x" --sandbox none)`. **Prompt-based enforcement is unreliable.**

### Attack 3: `--sandbox none` is a privilege escalation vector
If an agent is authorized to run `Bash(cook *)`, it can run `cook --sandbox none` to spawn a child `claude --dangerously-skip-permissions` process. This child skips all permission prompts, even ones the parent agent's config would normally require.

### Attack 4: Agent doesn't need cook
An agent with Bash access can run `claude --dangerously-skip-permissions` directly. But this is the parent's permission system's problem, not cook's.

## Analysis

### Why `--sandbox none` should be removed entirely

1. **`--sandbox agent` works** — proven by testing. Cook doesn't need `--dangerously-skip-permissions` to function.
2. **`--sandbox none` is a privilege escalation vector** — any agent authorized to run cook can use it to spawn permissionless children.
3. **Config/prompt enforcement doesn't work** — the only reliable enforcement is removing the capability from cook's code entirely.
4. **Docker mode exists for full isolation** — users who need maximum control can use `--sandbox docker`.

### What replaces `--sandbox none`?

Two modes remain:
- **`--sandbox agent`** (default): Child runs with native OS sandbox + `acceptEdits` permission mode. Safe, functional, no `--dangerously-skip-permissions`.
- **`--sandbox docker`**: Child runs in a Docker container with full isolation. Uses `--dangerously-skip-permissions` but it's safe because the container is the security boundary.

For users who previously needed `--sandbox none` because they're in an already-isolated environment (VM, container), `--sandbox agent` should work fine — the OS sandbox is additive and won't break anything in an already-permissive environment.

## Code Impact

### Files to modify
- `src/bare-runner.ts` — delete entirely
- `src/runner.ts` — remove `'none'` from `SandboxMode`
- `src/config.ts` — remove `'none'` from `isSandboxMode`
- `src/cli.ts` — remove `none` from help text, default config, sandbox references
- `src/native-runner.ts` — already correct (no bypass flags in base class)
- `README.md` — remove `none` from sandbox mode table
- `index.html` — remove `none` from sandbox mode table
- `skill/SKILL.md` — already correct (no `--sandbox none`)
- `tests/SPEC.md` — all tests currently use `--sandbox none`, need updating

### Test impact
All integration tests currently use `--sandbox none`. They will need to switch to `--sandbox agent`. Since we've proven `agent` mode works, this should be straightforward — but tests that write to `/tmp` may need adjustment (OS sandbox blocks it).
