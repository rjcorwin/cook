# Let it cook. 

Reviewing your coding agent's first pass is often a waste of your time. Cook puts your preferred agent in a "cook loop" (work->review->gate->iterate) and doesn't let it finish until until actually done.

```
npm install -g @let-it-cook/cli
cook "Implement dark mode" \ # work prompt
     "Code review the implementation" # review prompt
     "If no major issues say DONE, else say ITERATE" # gate prompt
     "Fix the issues identified in the review" # iterate prompt
```

By default, cook uses your local Claude Code instance for all the work, but you can also use codex or opencode.

```
cook "Implement dark mode" --agent opencode --agent-model z-ai/glm-4.7
cook "Implement dark mode" --agent codex
```

Run parallel cook loops in separate work trees, AI picks the best:

```sh
cook "Implement dark mode" x3 "pick least code, cleanest implementation"
```

Explore multiple directions in separate work trees with `vs`:

```sh
cook "Implement dark mode with CSS" vs "Implement dark mode with Tailwind"
```

Embed cook loops in ralph loops to work through a task list:

```sh
cook "Work on the next task in plan.md" ralph
```

Everything is composable:

```sh
# Race 3 copies of a ralph loop — best overall plan execution wins
cook "Implement the next step in plan.md" ralph x3 "most complete"
```

or race each task in the ralph loop, then race the whole ralph loop:

```sh
cook "Implement the next step in plan.md" x3 "most complete" ralph x3 "cleanest implementation wins"
```

Override the default prompts and set your own defaults:

```sh
cook init   # creates COOK.md + .cook/config.json
```

Edit `COOK.md` to customize the meta-prompt template, and `.cook/config.json` to set default agent, model, sandbox, and per-step overrides. See [Configuration](#configuration) for details.

## Cook loop

The core loop runs work → review → gate → iterate until the gate says DONE or max iterations are reached (default: 3).

```sh
cook "Add dark mode"                    # all defaults
cook "Add dark mode" 5                  # up to 5 iterations
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

**merge** (default) — Synthesizes the best parts of all branches into a new implementation. The merge agent reads diffs and logs from every branch, then produces a combined result with its own cook loop.

```sh
cook "Approach A" vs "Approach B" merge "combine the strongest elements" 5
```

**judge** — Picks a single winner (like race, but with distinct prompts per branch).

```sh
cook "Approach A" vs "Approach B" judge "fewest lines changed"
```

**summarize** — Produces a comparison document without picking or merging. Branches are preserved for manual inspection.

```sh
cook "Approach A" vs "Approach B" summarize
```

### Per-branch overrides

Each branch can have its own review, gate, and iteration limit:

```sh
cook "Build with React" "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" "Check bundle size" "DONE if under 50kb" 5 \
  judge "best developer experience"
```

## Race mode

Race N identical runs in parallel git worktrees, then let a judge pick the best:

```sh
cook "Add dark mode" race 3
cook "Add dark mode" race 3 "least code wins"      # custom judge criteria
cook "Add dark mode" x3 "least code wins"           # shorthand (same thing)
```

All the usual flags work alongside race:

```sh
cook "Add dark mode" race 3 "cleanest diff" --agent codex --max-iterations 5
```

Each run gets its own worktree branched from HEAD. After all runs complete, a judge agent reads every session log and responds with `PICK N`. The winning branch is merged into your current branch.

## Ralph loop

Ralph puts the cook loop inside an outer loop that advances through a task list. When the gate says NEXT (current task is done, more to do), the iteration counter resets and work continues with the ralph prompt. When the gate says DONE (all tasks complete), the loop exits.

```sh
cook "Work on the next task in plan.md" ralph
cook "Work on the next task in plan.md" ralph 5                     # up to 5 task transitions
cook "Build the auth module" ralph "Continue to the next task" 5    # custom ralph prompt
```

On the first pass, the original work prompt is used. On subsequent NEXT transitions, the ralph prompt takes over (default: "The previous task passed review. Continue to the next task.").

The gate now has three possible verdicts:
- **DONE** — all tasks complete, exit
- **ITERATE** — fix issues, counts against `--max-iterations`
- **NEXT** — task is good, advance to next, resets iteration counter, counts against ralph limit

### Composing ralph with race

Keywords compose right-to-left — the rightmost keyword is the outermost wrapper:

```sh
# Ralph through tasks, race each task 3 ways
cook "Next task in plan.md" race 3 "cleanest" ralph 5

# Race 3 complete ralph runs against each other
cook "Next task in plan.md" ralph 5 race 3 "most complete"
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

