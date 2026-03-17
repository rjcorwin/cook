# cook CLI Specification

## Primitives

Cook is built from three categories of operators:

**Work** — the core unit: a single LLM call that does work.

**Loop operators** wrap work with iteration:
- **review** — adds a review→gate loop around work, iterating until quality passes
- **Ralph** — adds an outer gate for sequential task progression

**Composition operators** run multiple cooks in parallel and resolve them:
- **race** — N identical cooks in parallel worktrees
- **vs** — 2+ different cooks in parallel worktrees
- **resolvers** (`pick`, `merge`, `compare`) — determine the outcome of a composition

```
cook "<work>" [review ["<r>"] ["<g>"] ["<i>"] [max-iterations]] \
     [ralph [N] "<ralph-gate>"] \
     [race N | vs ... ] [resolver] ["<criteria>"] \
     [race N] [resolver] ["<criteria>"]
```

---

## The Cook

A cook with no operators is a single LLM call:

```sh
cook "Implement dark mode"
```

That's it — one agent call, done.

---

## review

The `review` keyword adds a review→gate loop. After work completes, a reviewer checks quality and a gate decides DONE or ITERATE. On ITERATE, the iterate step runs (defaults to the work prompt), then review→gate repeats.

```
Pass 1:  work → review → gate
Pass 2+: iterate → review → gate   (if gate said ITERATE)
         exit                       (if gate said DONE)
```

### Shorthand: positional prompts

When review/gate/iterate prompts are given as positional args right after work (without the `review` keyword), cook treats them as shorthand for a review loop:

```sh
cook "<work>" "<review>" "<gate>" ["<iterate>"] [max-iterations]
```

Duck-typed: a bare number is `max-iterations`; any other string fills the next prompt slot.

```sh
# Shorthand — positional prompts imply review loop
cook "Implement dark mode" "Review for accessibility" "DONE if no High issues, else ITERATE"
cook "Implement dark mode" "Review for accessibility" "DONE if no High issues, else ITERATE" "Fix the High issues" 5

# Explicit — review keyword with default prompts
cook "Implement dark mode" review

# Explicit — review keyword with custom prompts
cook "Implement dark mode" review "Review for accessibility" "DONE if no High issues, else ITERATE"
cook "Implement dark mode" review "Review for accessibility" "DONE if no High issues, else ITERATE" "Fix the High issues" 5
```

When the `review` keyword is used with no prompts, defaults are applied:

- **review prompt**: `Review the work done in the previous step. Check the session log for what changed. Identify issues categorized as High, Medium, or Low severity.`
- **gate prompt**: `Based on the review, respond with exactly DONE or ITERATE on its own line, followed by a brief reason. DONE if: the work is complete and no High severity issues remain. ITERATE if: there are High severity issues or the work is incomplete.`
- **iterate**: reuses the work prompt
- **max-iterations**: 3

---

## Ralph

Ralph wraps a cook with an outer gate. After the cook completes (either a single work call or after review says DONE), the ralph gate decides NEXT or DONE. The work prompt is self-directing — it reads project state to pick the next task on each ralph iteration.

```sh
cook "<work>" [review ...] ralph [N] "<ralph-gate>"
```

The ralph gate prompt is required. `N` sets the max number of tasks (default: 3).

### Ralph without review

```sh
cook "Read plan.md, do the next incomplete task" \
     ralph 5 \
     "If all tasks in plan.md are [done] say DONE, else say NEXT"
```

```
Task 1:  work → ralph gate (NEXT)
Task 2:  work → ralph gate (NEXT)
...
Task N:  work → ralph gate (DONE) → exit
```

### Ralph with review

```sh
cook "Read plan.md, do the next incomplete task" \
     review "Code review marking issues high/medium/low" \
       "If no high/medium issues, mark task [done] and say DONE, else say ITERATE" \
       "Fix the high/medium issues" \
     ralph 5 \
     "If all tasks in plan.md are [done] say DONE, else say NEXT"
```

```
Task 1:  work → review → gate (DONE) → ralph gate (NEXT)
Task 2:  work → review → gate (DONE) → ralph gate (NEXT)
...
Task N:  work → review → gate (DONE) → ralph gate (DONE) → exit
```

If the review gate says ITERATE, the cook iterates before the ralph gate is consulted.

### Ralph with review (shorthand)

The positional shorthand still works with ralph:

```sh
cook "Read plan.md, do the next incomplete task" \
     "Code review marking issues high/medium/low" \
     "If no high/medium issues, mark task [done] and say DONE, else say ITERATE" \
     "Fix the high/medium issues" \
     ralph 5 \
     "If all tasks in plan.md are [done] say DONE, else say NEXT"
```

---

## race

Race runs N identical cooks in parallel worktrees, then resolves with a resolver.

```sh
cook "<work>" [review ...] [ralph ...] race N [resolver]
cook "<work>" [review ...] [ralph ...] xN [resolver]     # shorthand
```

```sh
cook "Implement dark mode" race 3 pick "least lines changed"
cook "Implement dark mode" x3 pick "least lines changed"
cook "Implement dark mode" x3                               # pick is the default resolver
```

Race with review:

```sh
cook "Implement dark mode" review race 3 pick "least lines changed"
```

Ralph composes with race:

```sh
cook "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" race 3 pick "cleanest result"
```

---

## vs

`vs` runs two or more different cooks in parallel worktrees, then resolves with a resolver.

```sh
cook "<cook-A>" vs "<cook-B>" [vs "<cook-C>" ...] [resolver]
```

Each branch is a full cook definition — work prompt, optionally with review and/or ralph:

```sh
cook "Implement auth with JWT" vs "Implement auth with sessions" pick "best security and simplicity"
```

```sh
cook "Build with React" review "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" review "Check bundle size" "DONE if under 50kb" 5 \
  merge "best developer experience"
```

Ralph composes with vs:

```sh
cook "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" \
  vs \
  "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" \
  pick "most complete result"
```

---

## Resolvers

Resolvers determine the outcome of a composition (`race` or `vs`).

| Resolver | Behavior |
|----------|----------|
| `pick ["<criteria>"]` | Agent reads all results and picks one winner. The winning branch is merged into the current branch. |
| `merge ["<criteria>"]` | Agent synthesizes all results into a new implementation in a fresh worktree, running its own cook. |
| `compare` | Agent writes a comparison document to `.cook/compare-<session>.md`. No branch is merged. Cannot be followed by a second composition. |

`pick` is the default resolver when none is specified.

```sh
cook "Approach A" vs "Approach B" pick "fewest lines changed"
cook "Approach A" vs "Approach B" merge "cleanest implementation"
cook "Approach A" vs "Approach B" compare
cook "Approach A" x3                        # pick with no criteria
```

---

## Second-level composition

After a resolver, the result can be raced again with `race N`:

```sh
cook "A" vs "B" pick "cleanest" race 3 pick "most thorough"
```

This runs 3 independent vs instances, then picks the best of the 3 winners.

---

## Options

```
--work PROMPT           Override work step prompt
--review PROMPT         Override review step prompt
--gate PROMPT           Override gate step prompt
--iterate PROMPT        Override iterate step prompt
--max-iterations N      Max review iterations (default: 3)
--agent AGENT           Default agent (claude|codex|opencode)
--model MODEL           Default model
--sandbox MODE          Sandbox mode (agent|docker|none, default: agent)
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

---

## Configuration

`.cook/config.json`:

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

`ralph` step config controls the ralph gate agent/model/sandbox. Falls back to `gate` config if not set.

---

## COOK.md template variables

| Variable | Description |
|----------|-------------|
| `${step}` | Current step: `work`, `review`, `gate`, `iterate`, or `ralph` |
| `${prompt}` | The prompt for this step |
| `${lastMessage}` | Output from the previous step |
| `${iteration}` | Current cook iteration number |
| `${maxIterations}` | Max cook iterations |
| `${ralphIteration}` | Current ralph task number (ralph only) |
| `${maxRalph}` | Max ralph tasks (ralph only) |
| `${logFile}` | Path to the session log file |
