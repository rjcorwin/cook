# cook

Do you often find yourself in this loop?

```
You:   Hey Agent, implement dark mode.
Agent: Done! I added the thing.

You:   Hey Agent, review your work.
Agent: Found a few issues.

You:   Hey Agent, fix your work.
Agent: Fixed! 
```

Issue the task once and __let it cook__:

```sh
cook "Implement dark mode"
```


`cook` runs Claude, Codex, or OpenCode in a work → review → gate loop, iterating automatically until the agent is satisfied or your max iterations are hit. Agents run natively by default, using their own OS-level sandboxes — no Docker required. Get even fancier by defining what to review and the criteria for done:

```sh
cook "Implement dark mode" # Work prompt \
  "Review the implementation. Check for visual regressions and missing theme variables. Categorize findings by High/Medium/Low." # review prompt \
  "Reply DONE if no High findings remain; otherwise ITERATE." # gate prompt \
  5 # max iterations
```


## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- An agent CLI on your PATH: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)
- [Docker](https://docs.docker.com/get-docker/) (only needed for `--sandbox docker`)

## Install

```sh
npm install -g @let-it-cook/cli
```

## Quick start

```sh
cd your-project
cook init                      # creates COOK.md + .cook/ config directory
cook doctor                    # checks Docker + auth readiness
cook "Add dark mode"           # runs the agent loop
cook "Fix the login bug" 5     # runs with up to 5 iterations
```

## Examples

Basic run:

```sh
cook "Create a space cat themed todo app in a single index.html"
```

Per-step agent/model overrides (for one run):

```sh
cook "Implement auth flow" \
  --agent opencode --model gpt-5 \
  --work-agent codex --work-model gpt-5-codex \
  --review-agent claude --review-model opus
```

Doctor checks using the same override logic:

```sh
cook doctor --work-agent codex --review-agent claude
```

## How it works

1. **Work** — The selected agent executes your prompt in your project directory.
2. **Review** — A second pass reviews what changed and flags issues by severity.
3. **Gate** — A third pass decides DONE or ITERATE based on the review.

The loop repeats until the gate says DONE or max iterations are reached (default: 3).

A persistent status bar at the bottom of the terminal shows the current step, iteration, model, and elapsed time.

## Sandbox modes

Cook supports three sandbox modes via `--sandbox`:

| Mode | Flag | Description |
|------|------|-------------|
| **Agent** (default) | `--sandbox agent` | Spawns agents natively. Agents use their own OS-level sandboxes (Claude's Seatbelt/Landlock, Codex's workspace sandbox). No Docker required. |
| **Docker** | `--sandbox docker` | Runs agents inside a Docker container with network restrictions. Full isolation. |
| **None** | `--sandbox none` | Spawns agents natively with all safety bypassed (`--dangerously-skip-permissions` etc.). Use with caution. |

You can also set the sandbox mode per-step in `.cook/config.json` (see Configuration below).

> **Note:** OpenCode is only supported in Docker mode — it has no OS-level sandbox.

### Docker mode details

When using `--sandbox docker`, the agent runs inside a Docker container — it can freely read and write your project files, but it cannot touch anything else on your host machine.

Network access is restricted by default using `iptables` inside the container. Only outbound HTTPS to the agent's API endpoint is allowed (e.g. `api.anthropic.com` for Claude). Everything else — including Google, npm, GitHub, etc. — is blocked unless explicitly added to `allowedHosts`.

To allow additional hosts, create `.cook/docker.json`:

```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": ["registry.npmjs.org", "api.github.com"]
  }
}
```

To disable network restrictions entirely (not recommended):

```json
{
  "network": {
    "mode": "unrestricted"
  }
}
```

## Configuration

All config lives in the `.cook/` directory (created by `cook init`):

- `COOK.md` — Project instructions and agent loop template (JS template literal syntax). Lives in the project root for visibility.
- `.cook/config.json` — Default agent/model/sandbox, per-step overrides, and environment variable passthrough.
- `.cook/docker.json` — Docker-only config: network mode and allowed hosts. Only needed when using `--sandbox docker`.
- `.cook/Dockerfile` — Project-specific dependencies layered on top of the base sandbox image (Docker mode only).
- `.cook/logs/` — Session logs (gitignored by `.cook/.gitignore`).

Example `.cook/config.json`:

```json
{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work": {
      "agent": "codex",
      "model": "gpt-5-codex"
    },
    "review": {
      "agent": "claude",
      "model": "opus"
    },
    "gate": {
      "sandbox": "docker"
    }
  },
  "env": ["CLAUDE_CODE_OAUTH_TOKEN"]
}
```

The `env` array controls which environment variables from your host are forwarded to the agent process. In Docker mode, these are injected into the container; in agent/none mode, they're passed to the spawned process. Auth tokens like `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` need to be listed here for agents to authenticate.

CLI defaults (`--agent`, `--model`, `--sandbox`) override config defaults for a single run. Step flags (`--work-agent`, `--review-agent`, `--gate-agent`, `--work-model`, `--review-model`, `--gate-model`) override both. Per-step `sandbox` in config overrides the global sandbox mode.

## Options

```
cook "prompt"                   Run the work/review/gate loop
cook "prompt" 5                 Run with 5 max iterations
cook init                       Set up COOK.md, config, and Dockerfile
cook rebuild                    Rebuild the sandbox Docker image
cook doctor                     Check agent CLI, Docker, + auth readiness

--work PROMPT                   Override work step prompt
--review PROMPT                 Override review step prompt
--gate PROMPT                   Override gate step prompt
--max-iterations N              Max review iterations (default: 3)
--agent AGENT                   Default agent (claude|codex|opencode)
--model MODEL                   Default model (for default agent)
--sandbox MODE                  Sandbox mode (agent|docker|none, default: agent)
--work-agent AGENT              Work step agent override
--review-agent AGENT            Review step agent override
--gate-agent AGENT              Gate step agent override
--work-model MODEL              Work step model override
--review-model MODEL            Review step model override
--gate-model MODEL              Gate step model override
--hide-request                  Hide the templated request for each step
```
