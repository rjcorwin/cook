# Let it cook.

Reviewing your coding agent's first pass is often a waste of your time. Cook puts your preferred agent in a "cook loop" (work→review→gate→iterate) and doesn't let it finish until actually done.

```
npm install -g @let-it-cook/cli
cook "Implement dark mode" \
     "Code review the implementation" \               # review prompt
     "If no major issues say DONE, else say ITERATE" \ # gate prompt
     "Fix the issues identified in the review"          # iterate prompt
```

By default, cook uses your local Claude Code instance for all the work, but you can also use codex or opencode.

```
cook "Implement dark mode" --agent opencode --agent-model z-ai/glm-4.7
cook "Implement dark mode" --agent codex
```

Run parallel versions in separate git worktrees, AI picks the best:

```sh
cook "Implement dark mode" v3 "pick least code, cleanest implementation"
```

Explore multiple directions in separate worktrees with `vs`:

```sh
cook "Implement dark mode with CSS" vs "Implement dark mode with Tailwind"
```

Embed cook loops in ralph loops to work through a task list:

```sh
cook "Work on the next task in plan.md" ralph "DONE if all tasks done, else NEXT"
```

Everything is composable:

```sh
# Race 3 ralph loop executions — best overall wins
cook "Implement the next step in plan.md" ralph "DONE if all tasks done, else NEXT" v3 "most complete"

# Race each task 3 ways as ralph advances
cook "Implement the next step in plan.md" v3 "most complete" ralph "DONE if all tasks done, else NEXT"
```

Override the default prompts and set your own defaults:

```sh
cook init   # creates COOK.md + .cook/config.json
```

Edit `COOK.md` to customize the meta-prompt template, and `.cook/config.json` to set default agent, model, sandbox, and per-step overrides. See [Configuration](#configuration) for details.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- An agent CLI on your PATH: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)
- [Docker](https://docs.docker.com/get-docker/) (only needed for `--sandbox docker`)

## Install

```sh
npm install -g @let-it-cook/cli
```

## Cook loop

The core loop runs **work → review → gate → iterate** until the gate says DONE or max iterations are reached (default: 3).

```sh
cook "Add dark mode"                    # single work call (no loop)
cook "Add dark mode" review             # review loop, all defaults
cook "Add dark mode" 5                  # review loop, up to 5 iterations
```

Override individual step prompts positionally or with flags:

```sh
# Positional: work, review, gate, iterate
cook "Add dark mode" "Review for accessibility" "DONE if WCAG AA, else ITERATE" "Fix the a11y issues"

# Flags (mix and match with positional)
cook "Add dark mode" --review "Review for accessibility" --iterate "Fix the a11y issues" 5
```

Use different agents or models per step:

```sh
cook "Add dark mode" \
  --work-agent codex --work-model gpt-5-codex \
  --review-agent claude --review-model opus
```

## Vs mode

Run different approaches in parallel git worktrees, then combine the results. Each branch gets its own full cook loop.

```sh
cook "Implement dark mode with CSS variables" vs "Implement dark mode with Tailwind"
```

### Join strategies

After all branches complete, a join strategy combines the results. Specify it after the last `vs` branch:

**pick** (default) — Picks a single winner. A judge agent reads all branch logs and diffs, then responds with `PICK N`. The winning branch is merged into your current branch.

```sh
cook "Approach A" vs "Approach B" pick "fewest lines changed"
```

**merge** — Synthesizes the best parts of all branches into a new implementation. The merge agent reads diffs and logs from every branch, then produces a combined result with its own cook loop.

```sh
cook "Approach A" vs "Approach B" merge "combine the strongest elements" 5
```

**compare** — Produces a comparison document without picking or merging. Branches are preserved for manual inspection.

```sh
cook "Approach A" vs "Approach B" compare
```

### Per-branch overrides

Each branch can have its own review, gate, and iteration limit:

```sh
cook "Build with React" "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" "Check bundle size" "DONE if under 50kb" 5 \
  pick "best developer experience"
```

## Repeat mode

Run the same task N times in sequence. Useful for accumulating work before review or looping for variety.

```sh
cook "Add dark mode" x3              # repeat 3 times
cook "Add dark mode" repeat 3        # long-form alias
cook "Add dark mode" x3 review       # 3 work passes, then a review loop
cook "Add dark mode" review x3       # review loop repeated 3 times
```

## Race mode

Race N identical runs in parallel git worktrees, then let a judge pick the best:

```sh
cook "Add dark mode" v3                           # race 3 versions
cook "Add dark mode" v3 "least code wins"         # custom pick criteria
cook "Add dark mode" race 3 "least code wins"     # long-form alias
```

All the usual flags work alongside race:

```sh
cook "Add dark mode" v3 "cleanest diff" --agent codex --max-iterations 5
```

Each run gets its own worktree branched from HEAD. After all runs complete, a judge agent reads every session log and responds with `PICK N`. The winning branch is merged into your current branch.

## Ralph loop

Ralph puts the cook loop inside an outer loop that advances through a task list. When the ralph gate says NEXT, work continues with the same prompt for the next task. When it says DONE, the loop exits.

```sh
cook "Work on the next task in plan.md" ralph "DONE if all tasks complete, else NEXT"
cook "Work on the next task in plan.md" ralph 5 "DONE if all tasks complete, else NEXT"  # up to 5 tasks
```

Add a review loop inside ralph for per-task quality gates:

```sh
cook "Work on the next task in plan.md" review ralph 5 "DONE if all tasks complete, else NEXT"
```

The inner cook loop gate decides **DONE** (pass to ralph gate) or **ITERATE** (loop back and fix). The ralph gate decides **DONE** (all tasks complete, exit) or **NEXT** (advance to next task, reset iteration counter).

### Composing ralph with race

Keywords compose right-to-left — the rightmost keyword is the outermost wrapper:

```sh
# Race each task 3 ways as ralph advances through the list
cook "Next task in plan.md" v3 "cleanest" ralph 5 "DONE if all tasks done, else NEXT"

# Race 3 complete ralph runs against each other
cook "Next task in plan.md" ralph 5 "DONE if all tasks done, else NEXT" v3 "most complete"
```

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
| `${step}` | Current step name: `work`, `review`, `gate`, `iterate`, or `ralph` |
| `${prompt}` | The prompt for this step |
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
cook "prompt"                             Single work call
cook "prompt" review                      Review loop (default prompts)
cook "prompt" 5                           Review loop, up to 5 iterations
cook "prompt" "review" "gate"            Review loop, custom prompts
cook "prompt" "review" "gate" "iterate"  Full prompt set
cook "prompt" xN                          Repeat N times in sequence
cook "prompt" xN review                   N work passes then review loop
cook "prompt" vN                          Race N parallel versions, pick the best
cook "prompt" vN "criteria"             Race with custom pick criteria
cook "prompt" race N "criteria"          Long-form race syntax
cook "A" vs "B" pick "criteria"          Fork-join with pick
cook "A" vs "B" merge "criteria"         Fork-join with merge
cook "A" vs "B" compare                  Fork-join with comparison doc
cook "prompt" ralph N "gate prompt"      Ralph outer loop, N max tasks
cook init                                 Set up COOK.md, config, and Dockerfile
cook doctor                               Check agent CLI, Docker, + auth readiness

--work PROMPT               Override work step prompt
--review PROMPT             Override review step prompt
--gate PROMPT               Override gate step prompt
--iterate PROMPT            Override iterate step prompt
--max-iterations N          Max review iterations (default: 3)
--agent AGENT               Default agent (claude|codex|opencode)
--model MODEL               Default model (for default agent)
--sandbox MODE              Sandbox mode (agent|docker|none, default: agent)
--work-agent AGENT          Work step agent override
--review-agent AGENT        Review step agent override
--gate-agent AGENT          Gate step agent override
--iterate-agent AGENT       Iterate step agent override
--ralph-agent AGENT         Ralph step agent override
--work-model MODEL          Work step model override
--review-model MODEL        Review step model override
--gate-model MODEL          Gate step model override
--iterate-model MODEL       Iterate step model override
--ralph-model MODEL         Ralph step model override
--hide-request              Hide the templated request for each step
```
