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


`cook` runs Claude, Codex, or OpenCode in a sandboxed work → review → gate loop, iterating automatically until the agent is satisfied or your max iterations are hit. Get even fancier by defining what to review and the criteria for done:

```sh
cook "Implement dark mode" \
  --review "Review the implementation. Check for visual regressions and missing theme variables. Categorize findings by High/Medium/Low." \
  --gate "Reply DONE if no High findings remain; otherwise ITERATE." \
  --max-iterations 5
```


## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://docs.docker.com/get-docker/)

## Install

```sh
npm install -g @let-it-cook/cli
```

## Quick start

```sh
cd your-project
cook init                      # creates COOK.md, .cook.config.json, .cook.Dockerfile
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

1. **Work** — The selected agent executes your prompt inside a Docker sandbox with the project bind-mounted.
2. **Review** — A second pass reviews what changed and flags issues by severity.
3. **Gate** — A third pass decides DONE or ITERATE based on the review.

The loop repeats until the gate says DONE or max iterations are reached (default: 3).

A persistent status bar at the bottom of the terminal shows the current step, iteration, model, and elapsed time.

## Sandbox security

The agent runs inside a Docker container — it can freely read and write your project files, but it cannot touch anything else on your host machine.

Network access is restricted by default using `iptables` inside the container. Only outbound HTTPS to the agent's API endpoint is allowed (e.g. `api.anthropic.com` for Claude). Everything else — including Google, npm, GitHub, etc. — is blocked unless explicitly added to `allowedHosts`.

To allow additional hosts:

```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": ["registry.npmjs.org", "api.github.com"]
  }
}
```

To disable restrictions entirely (not recommended):

```json
{
  "network": {
    "mode": "unrestricted"
  }
}
```

## Configuration

- `COOK.md` — Project instructions and agent loop template (JS template literal syntax).
- `.cook.config.json` — Default agent/model, per-step agent/model overrides, network restrictions, and environment variable passthrough.
- `.cook.Dockerfile` — Project-specific dependencies layered on top of the base sandbox image.

Example `.cook.config.json`:

```json
{
  "agent": "opencode",
  "model": "gpt-5",
  "steps": {
    "work": {
      "agent": "codex",
      "model": "gpt-5-codex"
    },
    "review": {
      "agent": "claude",
      "model": "opus"
    },
    "gate": {}
  },
  "network": {
    "mode": "restricted",
    "allowedHosts": []
  },
  "env": ["CLAUDE_CODE_OAUTH_TOKEN"]
}
```

CLI defaults (`--agent`, `--model`) override config defaults for a single run. Step flags (`--work-agent`, `--review-agent`, `--gate-agent`, `--work-model`, `--review-model`, `--gate-model`) override both.

## Options

```
cook "prompt"                   Run the work/review/gate loop
cook "prompt" 5                 Run with 5 max iterations
cook init                       Set up COOK.md, config, and Dockerfile
cook rebuild                    Rebuild the sandbox Docker image
cook doctor                     Check Docker + auth readiness

--work PROMPT                   Override work step prompt
--review PROMPT                 Override review step prompt
--gate PROMPT                   Override gate step prompt
--max-iterations N              Max review iterations (default: 3)
--agent AGENT                   Default agent (claude|codex|opencode)
--model MODEL                   Default model (for default agent)
--work-agent AGENT              Work step agent override
--review-agent AGENT            Review step agent override
--gate-agent AGENT              Gate step agent override
--work-model MODEL              Work step model override
--review-model MODEL            Review step model override
--gate-model MODEL              Gate step model override
```
