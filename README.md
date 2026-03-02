# cook

A sandboxed multi-agent loop (Claude, Codex, or OpenCode). Runs work-review-gate iterations inside a Docker container so the AI can operate with full autonomy while your host stays safe.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://docs.docker.com/get-docker/)

## Install

```sh
npm install -g @rjcorwin/cook
```

## Quick start

```sh
cd your-project
cook init                      # creates COOK.md, .cook.config.json, .cook.Dockerfile
cook "Add dark mode"           # runs the agent loop
cook "Fix the login bug" 5     # run with up to 5 iterations
```

## Example

Build a space cat themed todo app from scratch with code review:

```sh
cook "Create a space cat themed todo app in a single index.html" \
     "Plz code review. Split issues into high/medium/low." \
     "Say DONE if all high and medium issues are addressed, else say ITERATE and describe the work that needs to be done" \
     5
```

The four arguments map to: **work** prompt, **review** prompt, **gate** prompt, and **max iterations**. Cook will iterate until the gate says DONE or max iterations are reached.

## How it works

1. **Work** — The selected agent executes your prompt inside a Docker sandbox with the project bind-mounted.
2. **Review** — A second pass reviews what changed and flags issues by severity.
3. **Gate** — A third pass decides PROCEED or ITERATE based on the review.

The loop repeats until the gate says PROCEED or max iterations are reached (default: 3).

A persistent status bar at the bottom of the terminal shows the current step, iteration, model, and elapsed time.

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
    "mode": "default",
    "allowedHosts": []
  },
  "env": []
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
