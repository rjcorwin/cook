# cook

A sandboxed agent loop for Claude Code. Runs work-review-gate iterations inside a Docker container so the AI can operate with full autonomy while your host stays safe.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://docs.docker.com/get-docker/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)

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

## How it works

1. **Work** — Claude executes your prompt inside a Docker sandbox with the project bind-mounted.
2. **Review** — A second Claude pass reviews what changed and flags issues by severity.
3. **Gate** — A third pass decides PROCEED or ITERATE based on the review.

The loop repeats until the gate says PROCEED or max iterations are reached (default: 3).

A persistent status bar at the bottom of the terminal shows the current step, iteration, model, and elapsed time.

## Configuration

- `COOK.md` — Project instructions and agent loop template (JS template literal syntax).
- `.cook.config.json` — Network restrictions and environment variable passthrough.
- `.cook.Dockerfile` — Project-specific dependencies layered on top of the base sandbox image.

## Options

```
cook "prompt"                   Run the work/review/gate loop
cook "prompt" 5                 Run with 5 max iterations
cook init                       Set up COOK.md, config, and Dockerfile
cook rebuild                    Rebuild the sandbox Docker image

--work PROMPT                   Override work step prompt
--review PROMPT                 Override review step prompt
--gate PROMPT                   Override gate step prompt
--max-iterations N              Max review iterations (default: 3)
--model MODEL                   Claude model (default: opus)
```
