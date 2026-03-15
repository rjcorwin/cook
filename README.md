# cook

Do you often find yourself in this loop with claude, codex, or opencode?

```
You:   Hey Agent, implement dark mode.
Agent: Done! I added the thing.

You:   Hey Agent, review your work.
Agent: Found a few issues.

You:   Hey Agent, fix your work.
Agent: Fixed! 
```

__Let it cook__, reviewing and iterating until actually done:

```sh
cook "Implement dark mode"
```

Run parallel cook loops, AI picks the best:

```sh
cook "Implement dark mode" x3 "pick least code, cleanest implementation"
```

Compare two approaches, merge the best of both:

```sh
cook "Implement dark mode with CSS variables" vs "Implement dark mode with Tailwind" merge "cleanest implementation"
```

Define the review and done criteria:

```sh
cook \
  "Implement dark mode" # work prompt \
  "Review the implementation. Categorize findings by High/Medium/Low." # review prompt \
  "Reply DONE if no High findings remain; otherwise ITERATE." # gate prompt \
  5 # max iterations
```

Ralph loop through a 3 step plan.

```sh
# Ralph loop for a 3 step plan with an embedded cook loop.
for step in {1..3}; do cook "Implement step $step in plan.md"; done
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

Race 3 parallel runs and let a judge pick the best:

```sh
cook "Refactor the checkout flow to reduce steps" x3 "fewest lines changed, cleanest diff"
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

## Race mode

Race N parallel runs of the same task in isolated git worktrees, then let a judge agent pick the best result and merge it:

```sh
cook "Add dark mode" x3
```

Add custom judging criteria after the multiplier:

```sh
cook "Add dark mode" x3 "least code wins"
```

All the usual flags work alongside `x3`:

```sh
cook "Add dark mode" x3 "least code wins" --agent codex --max-iterations 5
```

There's also an explicit syntax:

```sh
cook race 3 "Add dark mode"
```

Each run gets its own git worktree branched from HEAD. After all runs complete, a judge agent reads every session log side-by-side and responds with `PICK N`. The winning branch is merged into your current branch, and the worktrees are cleaned up.

## Fork-join mode

Fork-join runs two or more different approaches in parallel, then combines the results. Use `vs` to separate branches:

```sh
cook "Implement auth with JWT" vs "Implement auth with sessions" merge "best security and simplicity"
```

Each branch gets its own git worktree and runs the full work→review→gate loop independently. After all branches complete, a join strategy combines the results.

### Join strategies

**merge** (default) — Synthesizes the best parts of all branches into a new implementation. A merge agent reads the diffs and logs from every branch, then produces a combined result in its own worktree. The merge runs its own work→review→gate loop.

```sh
cook "Approach A" vs "Approach B" merge "combine the strongest elements" 5
```

The trailing number sets max iterations for the merge loop (default: 3).

**judge** — Picks a single winner. A judge agent reads all branch logs and diffs, then responds with `PICK N`. The winning branch is merged into your current branch.

```sh
cook "Approach A" vs "Approach B" judge "fewest lines changed, cleanest diff"
```

**summarize** — Produces a comparison document without picking a winner or merging. The branches are preserved for manual inspection.

```sh
cook "Approach A" vs "Approach B" summarize
```

The comparison is written to `.cook/fork/comparison-<session>.md`.

### Per-branch prompts

Each branch can have its own work, review, and gate prompts (as a triple), and its own max iterations:

```sh
cook "Build with React" "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" "Check bundle size" "DONE if under 50kb" 5 \
  judge "best developer experience"
```

### Meta-parallelism

Add `xN` after the join strategy to run N independent fork-join instances in parallel. A meta-judge then picks the best instance:

```sh
cook "Approach A" vs "Approach B" judge "cleanest code" x3 "most thorough result"
```

This runs 3 complete fork-join instances (each with 2 branches), then a meta-judge compares the 3 winners and picks the best. The first quoted string after `xN` is the meta-judge criteria.

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
| **Docker** | `--sandbox docker` | Runs agents inside a Docker container with network restrictions. Full isolation. See Docker mode details in Configuration for network and image options. |
| **None** | `--sandbox none` | Spawns agents natively with all safety bypassed (`--dangerously-skip-permissions` etc.). Use with caution. |

You can also set the sandbox mode per-step in `.cook/config.json` (see Configuration below).

> **Note:** OpenCode is only supported in Docker mode — it has no OS-level sandbox.

## Configuration

Run `cook init` in your project root to scaffold the configuration files:

```sh
cook init
```

This creates:

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

## COOK.md

`COOK.md` lives in your project root and does two things: it holds project-level instructions for the agent, and it defines the template used to construct the prompt sent to the agent at each step.

When `cook` runs, it renders `COOK.md` as a JavaScript template literal, injecting these variables:

| Variable | Description |
|----------|-------------|
| `${step}` | Current step name: `work`, `review`, or `gate` |
| `${prompt}` | The prompt for this step (work/review/gate) |
| `${lastMessage}` | Output from the previous step (empty on first work step) |
| `${iteration}` | Current iteration number |
| `${maxIterations}` | Max iterations configured |
| `${logFile}` | Path to the session log file |

The default template (used when no `COOK.md` exists):

```md
# COOK.md

## Project Instructions

## Agent Loop

Step: **${step}** | Iteration: ${iteration}/${maxIterations}

### Task
${prompt}

${lastMessage ? '### Previous Output\n' + lastMessage : ''}

### History
Session log: ${logFile}
Read the session log for full context from previous steps.
```

Edit the `## Project Instructions` section to give the agent context about your project — stack, conventions, constraints, etc. The `## Agent Loop` section controls the structure of the prompt sent at each step.

Backticks and bare `$` in your `COOK.md` are escaped automatically so they don't break the template. To emit a literal `${...}` in the rendered output, write `\${...}` in `COOK.md`.

## Options

```
cook "prompt"                   Run the work/review/gate loop
cook "prompt" 5                 Run with 5 max iterations
cook "prompt" x3                Race 3 parallel runs, judge the best
cook "prompt" x3 "criteria"    Race with custom judge instructions
cook race 3 "prompt"            Race (explicit syntax)
cook "A" vs "B" merge "criteria"          Fork-join with merge synthesis
cook "A" vs "B" judge "criteria"          Fork-join with judge pick
cook "A" vs "B" summarize                 Fork-join with comparison doc
cook "A" vs "B" judge "c" x3 "meta-c"    Fork-join with meta-parallelism
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
