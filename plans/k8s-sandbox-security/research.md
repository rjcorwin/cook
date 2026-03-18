# Research: Sandbox Security When Cook Runs as a Subagent Skill

**Requester:** rj
**Date:** 2026-03-18

## Requirements

### Original Request
When cook is installed as a Claude Code skill (`/cook`), does `--sandbox none` constitute a privilege escalation? If we add a config-based lock (`sandboxLock` in `.cook/config.json`), can the agent just modify the config to bypass it? How do we guarantee the child process can't escalate beyond the parent's permissions?

### Context
Cook spawns coding agents (claude, codex) as child processes. The three sandbox modes differ in what flags are passed to the child:

| Mode | Claude flags | Effect |
|------|-------------|--------|
| `agent` | `--permission-mode acceptEdits -p` | Native OS sandbox, auto-accept edits |
| `none` | `--permission-mode acceptEdits -p --dangerously-skip-permissions` | OS sandbox, skip ALL prompts |
| `docker` | `--dangerously-skip-permissions` (inside container) | Full isolation via Docker |

All three use pipe mode (`-p`) with `stdio: ['pipe', 'pipe', 'pipe']` — there is no TTY.

## System Architecture

### Two Independent Security Layers

1. **OS-level sandbox** (Seatbelt on macOS, Landlock/bubblewrap on Linux): Kernel-enforced on the entire process tree. Child processes inherit restrictions and **cannot escape** regardless of flags.

2. **Permission prompting** (`--dangerously-skip-permissions`): Controls whether Claude Code prompts the user before taking actions. This is an application-level check, not an OS enforcement.

### How Native Claude Code Subagents Work

When Claude Code spawns a native subagent (via the Agent tool):
- **Foreground subagents**: Permission prompts pass through to the user
- **Background subagents**: Permissions are collected **upfront** (broad capability approval), then auto-deny anything not pre-approved
- In both cases, subagents can take actions (file edits, Bash commands) without per-action user approval once the broad capability is granted

### How Cook's Child Processes Work

Cook spawns `claude` as a bare CLI process via `spawn()`. This is different from native subagents:
- The child `claude` process is a completely separate process with its own permission model
- With `--sandbox agent`: child runs with `--permission-mode acceptEdits` (auto-accept edits, but Bash commands would need prompting — **however, there's no TTY**, so unpromptable actions may auto-deny or hang)
- With `--sandbox none`: child runs with `--dangerously-skip-permissions` (all actions auto-approved)

### The Pipe Mode Problem

Both `agent` and `none` modes run with `stdio: ['pipe', 'pipe', 'pipe']` — no TTY. In `agent` mode, if the child `claude` process needs to run a Bash command that requires user approval, it **cannot prompt** because there's no terminal. This means:
- `--sandbox agent` may be overly restrictive (Bash-dependent tasks could fail or hang)
- `--sandbox none` is needed for cook to actually work, since the child process needs to edit files AND run commands without prompting

**This is a fundamental tension**: cook needs `--dangerously-skip-permissions` to function in pipe mode, but that flag skips all permission checks.

## Attack Vectors

### Attack 1: Config-based lock is bypassable

If we add `"sandboxLock": "agent"` to `.cook/config.json`, the agent can simply:
```
Edit(.cook/config.json) → remove sandboxLock → run cook --sandbox none
```
The agent has file write access — that's its job. **Config-based enforcement is security theater.**

### Attack 2: Agent ignores skill instructions

The skill says "use --sandbox agent" but the agent can construct any command:
```
Bash(cook "do something" --sandbox none)
```
Skill instructions are advisory, not enforced. **Prompt-based enforcement is unreliable.**

### Attack 3: Agent doesn't need cook at all

The agent could bypass cook entirely:
```
Bash(claude --dangerously-skip-permissions -p "delete everything")
```
**Cook is not the only escalation path** — any agent with Bash access can spawn a permissionless child process.

### Attack 4: Agent modifies cook's source code

If cook is installed globally, the agent could modify `dist/cli.js` or `node_modules` to bypass any hardcoded checks. Less likely but possible.

## Analysis

### What does cook actually add over direct `claude --dangerously-skip-permissions`?

Cook adds structure (review loops, races, ralph) but from a security perspective, it's equivalent to the agent running `claude --dangerously-skip-permissions` directly. The escalation is not cook-specific — it's inherent to any agent with Bash access.

### Does `--sandbox agent` actually work in pipe mode?

This needs testing. If the child `claude` process in `acceptEdits` mode can't run Bash commands (because it can't prompt), then `--sandbox agent` would make cook unable to do useful work. The child agent needs to:
1. Edit files (covered by `acceptEdits`)
2. Run Bash commands (requires either `--dangerously-skip-permissions` or user approval — no TTY means no approval possible)

If Bash commands auto-deny in pipe mode without `--dangerously-skip-permissions`, then `--sandbox agent` makes cook a file-editor-only tool, which is likely too restrictive.

### The real security boundary

The parent Claude Code agent's permission system is the security boundary, not cook. If the parent agent is:
- **Allowed to run Bash**: It can already spawn `claude --dangerously-skip-permissions` without cook
- **Not allowed to run Bash**: It can't run cook at all
- **Allowed to run specific Bash commands (e.g., `cook *`)**: This IS a potential escalation — cook becomes a vehicle to run permissionless child processes. But this is an unusual config.

## Open Questions

1. **Does `--permission-mode acceptEdits` auto-deny Bash commands in pipe mode, or does it hang?** This determines whether `--sandbox agent` is viable at all.

2. **Can Claude Code's permission system restrict specific Bash commands (e.g., allow `cook *` but deny `claude --dangerously-skip-permissions *`)?** If yes, cook could be an escalation vector for that specific config.

3. **Should cook even offer `--sandbox none` in the skill, or should the skill always use `--sandbox agent` and let the user run `--sandbox none` manually from their terminal?**

4. **Is the right answer to simply document the security model rather than trying to enforce it in code?** Given that config-based and prompt-based enforcement are both bypassable, maybe transparency is better than false security.

## Prior Art

- Claude Code's own subagent system has similar properties — background subagents get broad upfront approval and don't prompt per-action
- Docker mode is the only true isolation boundary — it's a process-level sandbox the child can't escape
- `--dangerously-skip-permissions` is intentionally named to signal danger, but in pipe mode it's arguably necessary for any non-interactive workflow
