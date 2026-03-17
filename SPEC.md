# cook CLI Specification

## Primitives

Cook is built from two categories of operators:

**Loop operators** run a loop:
- **Cook** — the core unit of work: an LLM runs a task, reviews it, and gates on quality
- **Ralph** — extends a cook with an outer gate for sequential task progression

**Composition operators** run multiple loops in parallel and resolve them with a resolver:
- **race** — N identical loops in parallel worktrees
- **vs** — 2+ different loops in parallel worktrees
- **resolvers** (`pick`, `merge`, `compare`) — determine the outcome of a composition

---

## The Loop

The loop runs up to `max-iterations` times (default: 3):

```
Pass 1:  work → review → gate
Pass 2+: iterate → review → gate   (if gate said ITERATE)
         exit                       (if gate said DONE)
```

Positional args, in order:

```sh
cook "<work>" ["<review>"] ["<gate>"] ["<iterate>"] [max-iterations]
```

Duck-typed: a bare number is `max-iterations`; any other string fills the next prompt slot.

```sh
cook "Implement dark mode"
cook "Implement dark mode" 5
cook "Implement dark mode" "Review for accessibility issues" "DONE if no High issues, else ITERATE"
cook "Implement dark mode" "Review for accessibility issues" "DONE if no High issues, else ITERATE" "Fix the High issues found in the review" 5
```

When `iterate` is omitted, the work prompt is reused on ITERATE passes.

---

## Ralph

Ralph wraps a loop with an outer gate. After the loop's inner gate says DONE, the ralph gate runs and decides whether to continue (NEXT) or stop (DONE). The loop's work prompt is self-directing — it reads project state to pick the next task on each iteration.

```sh
cook "<work>" ["<review>"] ["<gate>"] ["<iterate>"] [max-iterations] ralph [N] "<ralph-gate>"
```

The ralph gate prompt is required. `N` sets the max number of tasks (default: 3).

```sh
cook "Read plan.md, mark the next incomplete task [in progress] and implement it" \
     "Code review marking issues high/medium/low" \
     "If no high/medium issues, mark [in progress] task as [done] in plan.md and say DONE, else say ITERATE" \
     "Fix the high/medium issues found in the review for the [in progress] task" \
     ralph 5 \
     "If all tasks in plan.md are marked [done] say DONE, else say NEXT"
```

The loop structure with ralph:

```
Task 1:  work → review → gate (DONE) → ralph gate (NEXT)
Task 2:  work → review → gate (DONE) → ralph gate (NEXT)
...
Task N:  work → review → gate (DONE) → ralph gate (DONE) → exit
```

If the inner gate says ITERATE, the loop iterates before the ralph gate is consulted.

---

## Race

Race runs N identical sessions in parallel worktrees, then resolves with a terminator.

```sh
cook "<loop>" race N [terminator]
cook "<loop>" xN [terminator]           # shorthand
```

```sh
cook "Implement dark mode" race 3 pick "least lines changed"
cook "Implement dark mode" x3 pick "least lines changed"
cook "Implement dark mode" x3                               # pick is the default terminator
```

Ralph sessions compose with race:

```sh
cook "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" race 3 pick "cleanest result"
```

---

## Fork-join (vs)

`vs` runs two or more different sessions in parallel worktrees, then resolves with a terminator.

```sh
cook "<loop-A>" vs "<loop-B>" [vs "<loop-C>" ...] terminator
```

Each branch can be a full loop definition (4 prompts + max-iterations):

```sh
cook "Implement auth with JWT" vs "Implement auth with sessions" pick "best security and simplicity"
```

```sh
cook "Build with React" "Check accessibility" "DONE if WCAG AA" 3 \
  vs \
  "Build with Vue" "Check bundle size" "DONE if under 50kb" 5 \
  merge "best developer experience"
```

Ralph sessions compose with vs:

```sh
cook "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" \
  vs \
  "Read plan.md and implement the next task" ralph 5 "DONE if plan complete, else NEXT" \
  pick "most complete result"
```

---

## Terminators

Terminators resolve parallel sessions (race or vs) into a result.

| Terminator | Behavior |
|------------|----------|
| `pick ["<criteria>"]` | Agent reads all results and picks one winner. The winning branch is merged into the current branch. |
| `merge ["<criteria>"]` | Agent synthesizes all results into a new implementation in a fresh worktree, running its own work→review→gate loop. |
| `summary` | Agent writes a comparison document to `.cook/summary-<session>.md`. No branch is merged. Terminal — cannot be composed further. |

`pick` is the default terminator when none is specified.

```sh
cook "Approach A" vs "Approach B" pick "fewest lines changed"
cook "Approach A" vs "Approach B" merge "cleanest implementation"
cook "Approach A" vs "Approach B" summary
cook "Approach A" x3                        # pick with no criteria
```

---

## Composition

Race and vs can be chained. `xN` after a terminator reruns the entire expression N times and applies a second terminator to the results:

```sh
cook "A" vs "B" pick "cleanest" x3 pick "most thorough"
```

This runs 3 independent fork-join instances, then picks the best of the 3 winners.

---

## Options

```
--work PROMPT           Override work step prompt
--review PROMPT         Override review step prompt
--gate PROMPT           Override gate step prompt
--iterate PROMPT        Override iterate step prompt
--max-iterations N      Max inner loop iterations (default: 3)
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
| `${iteration}` | Current inner loop iteration number |
| `${maxIterations}` | Max inner loop iterations |
| `${ralphIteration}` | Current ralph task number (ralph loops only) |
| `${maxRalph}` | Max ralph tasks (ralph loops only) |
| `${logFile}` | Path to the session log file |
