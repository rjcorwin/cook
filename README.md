# cook

A simple CLI for orchestrating Claude Code, Codex, and OpenCode.

```sh
# review loop
cook "Implement dark mode" review

# 3 passes
cook "Implement dark mode" x3

# race 3, pick best
cook "Implement dark mode" v3 "least code"

# two approaches, pick one
cook "Auth with JWT" vs "Auth with sessions" pick "best security"

# task list
cook "Work on next task in plan.md" review ralph 5 "DONE if all tasks complete, else NEXT"
```

Two ways to get it:

**Skill (no CLI)** — your agent orchestrates subagents directly:

```sh
mkdir -p .claude/skills/cook && curl -fsSL https://raw.githubusercontent.com/rjcorwin/cook/main/no-code/SKILL.md -o .claude/skills/cook/SKILL.md
```

**CLI** — standalone tool for terminal or CI:

```sh
npm install -g @let-it-cook/cli
mkdir -p .claude/skills && cp -r $(npm root -g)/@let-it-cook/cli/skill .claude/skills/cook
```

Requires Node.js 20+ and [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode).

### Docker network

By default, Docker sandbox restricts outbound traffic to only what each agent requires. Configure in `.cook/config.json`:

```json
{
  "docker": {
    "network": {
      "mode": "restricted",
      "allowedHosts": ["api.mycompany.com"]
    }
  }
}
```

| `mode` | Behavior |
|--------|----------|
| `"restricted"` (default) | Blocks all outbound traffic except DNS and HTTPS to a whitelist of required agent hosts |
| `"unrestricted"` | No network restrictions |

`allowedHosts` adds extra hosts to the whitelist when mode is `"restricted"`.

## Commands

```sh
cook init                           # Set up COOK.md, config, and Dockerfile
cook rebuild                        # Rebuild the sandbox Docker image
cook doctor                         # Check Docker + auth readiness
cook shell / sandbox                # Interactive shell in Docker sandbox
cook shell <command>                # Run a command in the sandbox
cook shell --unrestricted           # Shell with unrestricted networking
```

## Primitives

**Work** — a prompt string. One agent call.

**Loop operators** wrap work with iteration:
- `xN` — N sequential passes
- `review` — review → gate → iterate loop (up to 3 by default)
- `ralph N "<gate>"` — repeat until a gate says DONE

**Composition operators** run parallel branches then resolve:
- `vN` — N identical branches, pick the best
- `vs` — two different branches, pick the best
- `pick`, `merge`, `compare` — resolvers

Operators compose left to right. Each wraps everything to its left.

```sh
cook "work" x3 review       # 3 passes, then review loop
cook "work" review x3       # review loop, repeated 3 times
cook "work" review v3       # race 3, each with a review loop
```

## Review loop

```sh
cook "Add dark mode" review                    # default prompts, up to 3 iterations
cook "Add dark mode" review 5                  # up to 5 iterations
cook "Add dark mode" "Review for accessibility" "DONE if WCAG AA, else ITERATE"
cook "Add dark mode" review --work-agent codex --review-agent claude --review-model opus
```

## Rate-limit recovery

When an agent hits a token quota or rate limit, cook automatically waits and retries instead of bailing. A countdown is shown in the TUI. Enabled by default.

```sh
cook "Build the feature" review --no-wait   # disable: fail immediately on rate limit
```

Configure in `.cook/config.json`:

```json
{
  "retry": {
    "enabled": true,
    "pollIntervalMinutes": 5,
    "maxWaitMinutes": 360
  }
}
```

## Configuration

```sh
cook init
```

Creates `COOK.md` (project instructions + prompt template) and `.cook/config.json`:

```json
{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work":   { "agent": "codex", "model": "gpt-5-codex" },
    "review": { "agent": "claude", "model": "opus" }
  },
  "env": ["CLAUDE_CODE_OAUTH_TOKEN"]
}
```

### Custom agent CLI flags

Pass extra flags to the agent CLI on every step via `agentArgs` in `.cook/config.json`:

```json
{
  "agent": "claude",
  "agentArgs": {
    "claude": ["--mcp-config", ".cook/mcp.json", "--add-dir", "../shared"],
    "codex":  ["--profile", "fast"]
  }
}
```

Flags are appended to every invocation (work, review, gate, iterate, ralph, race, judge). Common use-cases:

- **`--mcp-config <path>`** — load extra Model Context Protocol servers (Figma, Jira, internal tools).
- **`--add-dir <path>`** — grant Claude access to a sibling directory (e.g. a shared file bus).
- **`--permission-mode <mode>`** — override the runner default (last flag wins).

For one-off overrides without editing config, use the env-var form (space-separated, shell-style quoting):

```sh
COOK_AGENT_ARGS_CLAUDE="--add-dir /tmp/bus" cook "fix the bug" review
```

**Docker sandbox caveat:** any path you pass via `agentArgs` must be reachable from inside the container. The project root is bind-mounted automatically; paths outside it need `network.allowedHosts` (for URLs) or a custom Dockerfile bind-mount.
