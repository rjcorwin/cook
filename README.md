# Let it cook.

Do you often find yourself in this loop with claude, codex, or opencode?

```
You:   Hey Agent, implement dark mode.
Agent: Done! I added the thing.

You:   Hey Agent, review your work.
Agent: Found a few issues.

You:   Hey Agent, fix your work.
Agent: Fixed!
```

**Let it cook** — add a review loop and let it finish the job:

```sh
cook "Implement dark mode" review
```

Or build more complex workflows from composable primitives:

```sh
# Review loop with custom prompts
cook "Implement dark mode" \
     "Review the implementation" \
     "DONE if no High issues, else ITERATE"

# Repeat 3 times, each pass refining the last
cook "Implement dark mode" x3

# Race 3 versions in parallel, pick the best
cook "Implement dark mode" v3 "least code, cleanest implementation"

# Two different approaches, pick the winner
cook "Auth with JWT" vs "Auth with sessions" pick "best security"

# Work through a task list with a review gate on each task
cook "Work on the next task in plan.md" review \
     ralph 5 "DONE if all tasks complete, else NEXT"

# Everything composes
cook "Implement dark mode" review v3 "cleanest result"
```

## Two ways to cook

### Skill (experimental)

Cook is a vocabulary for describing agent workflows. You describe what you want, the agent confirms the plan using cook's primitives, you approve, the agent executes — no script, no CLI, no dependencies.

```sh
mkdir -p .claude/skills
cp -r skill-pure .claude/skills/cook
```

That's it. One file. Your agent now speaks cook. Tell it what you want in natural language and it will orchestrate subagents using review loops, parallel races, and task progression.

### CLI

For a standalone tool you can run from your terminal or CI:

```sh
npm install -g @let-it-cook/cli
```

Add the `/cook` skill to Claude Code so your agent can invoke the CLI:

```sh
mkdir -p .claude/skills
cp -r $(npm root -g)/@let-it-cook/cli/skill .claude/skills/cook
```

#### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- An agent CLI on your PATH: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)
- [Docker](https://docs.docker.com/get-docker/) (only needed for `--sandbox docker`)

## Primitives

Cook is built from three categories of operators:

**Work** — the core unit: a single LLM call that does work.

**Loop operators** wrap work with iteration:
- `xN` / `repeat N` — run work N times sequentially
- `review` — add a review→gate loop
- `ralph` — add an outer gate for task-list progression

**Composition operators** run multiple cooks in parallel:
- `vN` / `race N` — N identical cooks in parallel worktrees
- `vs` — 2+ different cooks in parallel worktrees
- resolvers (`pick`, `merge`, `compare`) — determine the outcome

Operators compose left to right. Loop operators wrap everything to their left.

## Work

A cook with no operators is a single LLM call:

```sh
cook "Implement dark mode"
```

One agent call, done.

## Loop operators

### repeat (xN)

`xN` (shorthand for `repeat N`) runs work N times sequentially, each pass seeing the previous output.

```sh
cook "Add dark mode" x3           # 3 sequential passes
cook "Add dark mode" repeat 3     # long-form
```

`xN` wraps everything to its left, so nesting is natural:

```sh
cook "Add dark mode" x3 review    # 3 passes, then a review loop
cook "Add dark mode" review x3    # review loop repeated 3 times
```

### review

`review` adds a review→gate loop. After work, a reviewer checks quality and a gate decides DONE or ITERATE. On ITERATE, the iterate step runs (defaults to the work prompt), then review→gate repeats.

```sh
cook "Add dark mode" review           # default prompts, up to 3 iterations
cook "Add dark mode" review 5         # up to 5 iterations
```

Provide custom prompts after `review`, or use positional shorthand (2–4 strings right after work):

```sh
# Explicit
cook "Add dark mode" review "Review for accessibility" "DONE if WCAG AA, else ITERATE"

# Shorthand — same result
cook "Add dark mode" "Review for accessibility" "DONE if WCAG AA, else ITERATE"

# With iterate and max-iterations
cook "Add dark mode" "Review for accessibility" "DONE if WCAG AA, else ITERATE" "Fix the issues" 5
```

Use different agents or models per step:

```sh
cook "Add dark mode" review \
  --work-agent codex --work-model gpt-5-codex \
  --review-agent claude --review-model opus
```

### ralph

Ralph wraps a cook with an outer gate for working through a task list. After the cook completes, the ralph gate decides NEXT (advance to next task, reset iterations) or DONE (all done, exit). The work prompt is self-directing — it reads project state to pick the next task each time.

```sh
cook "Work on the next task in plan.md" ralph "DONE if all tasks complete, else NEXT"
cook "Work on the next task in plan.md" ralph 5 "DONE if all tasks complete, else NEXT"
```

Ralph with repeat and review:

```sh
# x3 passes per task, then ralph advances
cook "Work on the next task in plan.md" x3 \
     ralph 5 "DONE if all tasks complete, else NEXT"

# review gate per task, then ralph advances
cook "Work on the next task in plan.md" \
     review "Code review" "DONE if no High issues, else ITERATE" "Fix the issues" \
     ralph 5 "DONE if all tasks complete, else NEXT"
```

The review gate decides DONE (pass to ralph) or ITERATE (fix and retry). The ralph gate decides DONE (exit) or NEXT (advance to next task, reset iterations).

## Composition operators

Composition operators run multiple cooks in parallel isolated git worktrees, then combine the results with a resolver.

### versions (vN / race N)

`vN` runs N identical cooks in parallel worktrees, then resolves. `pick` is the default resolver.

```sh
cook "Add dark mode" v3                       # 3 runs, pick the best
cook "Add dark mode" v3 "least code wins"     # with pick criteria
cook "Add dark mode" race 3 "least code wins" # long-form alias
```

Composes with loop operators:

```sh
cook "Add dark mode" review v3 "cleanest"         # race 3, each with a review loop
cook "Add dark mode" x3 v3 "most complete"        # race 3, each with 3 passes
```

Ralph composes with versions:

```sh
# Race 3 complete ralph-with-review runs against each other
cook "Work on next task in plan.md" review \
     ralph 5 "DONE if all tasks done, else NEXT" \
     v3 "most complete"

# Same but without review — 3 plain ralph runs racing
cook "Work on next task in plan.md" \
     ralph 5 "DONE if all tasks done, else NEXT" \
     v3 "most complete"
```

### vs

`vs` runs two or more different cooks in parallel worktrees. Each branch is a full cook — it can have its own loop operators.

```sh
cook "Implement auth with JWT" vs "Implement auth with sessions" pick "best security"
```

Per-branch loop operators:

```sh
cook "JWT auth" x3 vs "Session auth" x5 pick "best security"

cook "Build with React" review "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" review "Check bundle size" "DONE if under 50kb" 5 \
  merge "best developer experience"
```

### Resolvers

Resolvers determine the outcome of a `vN`, `race N`, or `vs` composition.

| Resolver | Behavior |
|----------|----------|
| `pick ["<criteria>"]` | Agent picks one winner. The winning branch is merged into your current branch. Default when no resolver is specified. |
| `merge ["<criteria>"]` | Agent synthesizes all results into a new implementation in a fresh worktree. |
| `compare` | Agent writes a comparison doc to `.cook/compare-<session>.md`. No branch is merged. |

```sh
cook "Approach A" vs "Approach B" pick "fewest lines changed"
cook "Approach A" vs "Approach B" merge "cleanest implementation"
cook "Approach A" vs "Approach B" compare
```

### Second-level composition

After a resolver, the result can be versioned again with `vN`:

```sh
cook "A" vs "B" pick "cleanest" v3 pick "most thorough"
```

Runs 3 independent `vs` instances, then picks the best of the 3 winners.

## Sandbox modes

Cook supports two sandbox modes via `--sandbox`:

| Mode | Flag | Description |
|------|------|-------------|
| **Agent** (default) | `--sandbox agent` | Spawns agents natively. Agents use their own OS-level sandboxes (Claude's Seatbelt/Landlock, Codex's workspace sandbox). No Docker required. |
| **Docker** | `--sandbox docker` | Runs agents inside a Docker container with network restrictions. Full isolation. |

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
- `.cook/Dockerfile` — Project-specific dependencies layered on top of the base sandbox image (Docker mode only).
- `.cook/logs/` — Session logs (gitignored by `.cook/.gitignore`).

Example `.cook/config.json`:

```json
{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work":    { "agent": "codex",  "model": "gpt-5-codex" },
    "review":  { "agent": "claude", "model": "opus" },
    "gate":    {},
    "iterate": {},
    "ralph":   {}
  },
  "env": ["CLAUDE_CODE_OAUTH_TOKEN"]
}
```

The `env` array controls which environment variables from your host are forwarded to the agent process. Auth tokens like `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` need to be listed here for agents to authenticate.

CLI defaults (`--agent`, `--model`, `--sandbox`) override config defaults for a single run. Step flags override both. Per-step `sandbox` in config overrides the global sandbox mode.

### Docker mode details

When using `--sandbox docker`, the agent runs inside a Docker container — it can freely read and write your project files, but cannot touch anything else on your host machine.

Network access is restricted by default using `iptables`. Only outbound HTTPS to the agent's API endpoint is allowed. To allow additional hosts, create `.cook/docker.json`:

```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": ["registry.npmjs.org", "api.github.com"]
  }
}
```

## COOK.md

`COOK.md` lives in your project root and does two things: it holds project-level instructions for the agent, and it defines the template used to construct the prompt sent to the agent at each step.

When `cook` runs, it renders `COOK.md` as a JavaScript template literal, injecting these variables:

| Variable | Description |
|----------|-------------|
| `${step}` | Current step: `work`, `review`, `gate`, `iterate`, or `ralph` |
| `${prompt}` | The prompt for this step |
| `${lastMessage}` | Output from the previous step |
| `${iteration}` | Current review iteration number |
| `${maxIterations}` | Max review iterations |
| `${ralphIteration}` | Current ralph task number (ralph only) |
| `${maxRalph}` | Max ralph tasks (ralph only) |
| `${repeatPass}` | Current repeat pass number (repeat only) |
| `${maxRepeatPasses}` | Total repeat passes (repeat only) |
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

Edit the `## Project Instructions` section to give the agent context about your project. The `## Agent Loop` section controls the prompt structure sent at each step.

Backticks and bare `$` in your `COOK.md` are escaped automatically. To emit a literal `${...}` in the rendered output, write `\${...}` in `COOK.md`.

## Options

```
--work PROMPT           Override work step prompt
--review PROMPT         Override review step prompt
--gate PROMPT           Override gate step prompt
--iterate PROMPT        Override iterate step prompt
--max-iterations N      Max review iterations (default: 3)
--agent AGENT           Default agent (claude|codex|opencode)
--model MODEL           Default model
--sandbox MODE          Sandbox mode (agent|docker, default: agent)
--work-agent AGENT      Work step agent override
--review-agent AGENT    Review step agent override
--gate-agent AGENT      Gate step agent override
--iterate-agent AGENT   Iterate step agent override
--ralph-agent AGENT     Ralph gate step agent override
--work-model MODEL
--review-model MODEL
--gate-model MODEL
--iterate-model MODEL
--ralph-model MODEL
--hide-request          Hide the templated request for each step
```

