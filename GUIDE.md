# Choosing the right cook command

Cook has many operators that compose freely — which is powerful but can make it hard to know where to start. This guide helps you pick the right command for your situation.

> For a quick flag reference, run `cook --help`.

## Start simple, escalate when needed

The most important rule: **use the simplest command that could work.** Only add operators when you have a specific reason. Here's the progression from simplest to most powerful:

### Level 0 — Single shot

```sh
cook "Implement dark mode support"
```

One agent call. The agent does the work and you're done.

**Use this when:** The task is well-scoped, you trust the agent to get it right in one pass, or you just want a first draft to iterate on manually.

**Step up when:** The output is consistently incomplete or you find yourself running the same command again.

### Level 1 — Blind multi-pass (`xN`)

```sh
cook "Implement dark mode support" x3
```

The agent runs 3 times sequentially. Each pass sees the output of the previous pass, so the agent can notice what it missed and fill in gaps.

**Use this when:** The task is too big for one pass — many files to touch, lots of edge cases — and you want the agent to keep polishing without you checking in between.

**Step up when:** You want to stop early if the result is already good, or you need a quality bar more specific than "keep going."

### Level 2 — Quality-gated review (`review`)

```sh
cook "Implement dark mode support" review
```

After work completes, a separate review step checks quality and a gate decides DONE or ITERATE. If it iterates, the agent fixes the issues, then review checks again. Up to 3 iterations by default.

**Use this when:** You have a clear definition of "done" — passing tests, no lint errors, meeting accessibility standards — and you want the loop to stop as soon as quality is met rather than always running a fixed number of passes.

**Step up when:** A single review loop isn't producing good enough results, or you have a backlog of sequential tasks.

### Level 3 — Repeated review loops (`review xN`)

```sh
cook "Implement dark mode support" review x3
```

Runs the entire review loop (work → review → gate → iterate) 3 times using the same prompts each round. Each round must reach DONE before the next begins.

Note: if you want each round to have a different goal — say, first implement, then harden, then document — chain separate commands instead:

```sh
cook "Add dark mode" review && \
cook "Harden dark mode for edge cases" review && \
cook "Document the dark mode API" review
```

**Step up when:** You have multiple distinct tasks that should each be quality-gated independently.

### Level 4 — Task list execution (`ralph`)

```sh
cook "Read plan.md, do the next incomplete task" \
     review ralph 5 "DONE if all tasks complete, else NEXT"
```

Ralph wraps the entire cook with an outer gate that advances through a task list. After each task passes its review loop, ralph decides whether to move on to the next task or stop. `N` sets the maximum number of tasks (default: 100) — omit it to let ralph run until the gate says DONE.

**Use this when:** You have a predefined list of tasks (in a plan file, issue tracker, TODO list) and you want the agent to work through them sequentially, each with its own quality gate.

**Step up when:** You want to explore multiple approaches to the same problem in parallel.

### Level 5 — Parallel versions (`vN`)

```sh
cook "Implement dark mode support" v3 "least code wins"
```

Runs 3 identical cooks in parallel git worktrees, then a judge picks the best result. Same prompt, but LLM non-determinism means each run takes a different approach.

**Use this when:** You're not sure which direction the agent will take and you want multiple shots. Good for tasks where there are many valid approaches and you want to select the best execution.

### Level 6 — Competing approaches (`vs`)

```sh
cook "Auth with JWT" vs "Auth with sessions" pick "best security"
```

Runs two different cooks in parallel git worktrees with different prompts, then resolves the results. Each branch can have its own loop operators.

**Use this when:** You have specific alternative approaches in mind and want to compare them or let a judge decide. Good for architectural decisions where the right path isn't obvious.

---

## Decision flowchart

Start here and follow the arrows:

```
How many tasks do you have?
│
├─ ONE TASK
│  │
│  ├─ Do you want to explore multiple approaches?
│  │  │
│  │  ├─ Yes, I have specific alternatives ──────► vs
│  │  │  "Approach A" vs "Approach B" pick "criteria"
│  │  │
│  │  ├─ Yes, just want multiple shots ──────────► vN
│  │  │  "prompt" v3 "selection criteria"
│  │  │
│  │  └─ No, one approach is fine
│  │     │
│  │     ├─ Do you need quality gating?
│  │     │  │
│  │     │  ├─ Yes, I can define "done" ─────────► review
│  │     │  │  "prompt" review
│  │     │  │
│  │     │  └─ No, just want more passes ────────► xN
│  │     │     "prompt" x3
│  │     │
│  │     └─ One pass is fine ────────────────────► bare work
│  │        "prompt"
│  │
│  └─ (Any of the above can combine with vN or vs)
│
└─ MULTIPLE SEQUENTIAL TASKS
   │
   ├─ Each task needs quality gating ────────────► review + ralph
   │  "Do next task" review ralph N "gate"
   │
   └─ Just plow through them ────────────────────► ralph (no review)
      "Do next task" ralph N "gate"
```

---

## Head-to-head comparisons

### `xN` vs `review` — Two kinds of iteration

Both make the agent iterate. The difference is **who decides when to stop.**

| | `xN` (repeat) | `review` |
|---|---|---|
| **Iterations** | Always exactly N | 1 to max-iterations (default 3) |
| **Stop condition** | Counter reaches N | Gate says DONE |
| **Quality check** | None — agent refines blindly | Separate review step evaluates work |
| **Early stopping** | No — always runs all N passes | Yes — stops as soon as quality is met |
| **Cost** | Predictable: exactly N agent calls | Variable: 1 call minimum (first pass perfect), up to 6 calls at default max-iterations of 3 |
| **Best for** | Big tasks where more passes = more complete | Tasks with a clear "done" definition |

**Use `xN` when** you know multiple passes will help and you don't want the overhead of review/gate steps. Common for large refactors, initial implementations of complex features, or when you'll review the result yourself anyway.

**Use `review` when** you can define quality criteria — tests passing, no high-severity issues, meeting a spec — and you want to stop early once they're met. Common for features with acceptance criteria, bug fixes with reproduction steps, or tasks where over-iteration wastes tokens.

**Use both** (`x3 review`) when you want 3 refinement passes followed by a quality gate, or (`review x3`) when you want 3 independent quality-gated rounds.

### `vN` vs `vs` — Two kinds of parallelism

Both run multiple cooks in parallel git worktrees. The difference is **same prompt or different prompts.**

`vN` is shorthand for `race N` — both are equivalent:
```sh
cook "Implement dark mode" v3 "least code"
cook "Implement dark mode" race 3 "least code"   # same thing
```

| | `vN` (versions) | `vs` |
|---|---|---|
| **Prompts** | Same prompt, N times | Different prompt per branch |
| **Why it works** | LLM non-determinism means each run takes a different path | You explicitly define competing approaches |
| **Branch count** | N (any number) | 2+ (one per `vs` separator) |
| **Good for** | "Give me the best execution" | "Which approach is better?" |
| **Typical use** | `"Implement X" v3 "cleanest"` | `"X with JWT" vs "X with sessions" pick "most secure"` |

**Use `vN` when** you don't have a strong opinion about the approach and want to let the agent explore. The same prompt will naturally produce different implementations — different file structures, different algorithms, different trade-offs. The judge picks the best one.

**Use `vs` when** you have specific competing approaches in mind. Each branch gets a different prompt, so you can compare fundamentally different strategies — different libraries, different architectures, different algorithms.

### `pick` vs `merge` vs `compare` — Three resolvers

After parallel branches finish, the resolver determines what happens with the results.

| | `pick` | `merge` | `compare` |
|---|---|---|---|
| **Result** | One winning branch merged | New implementation synthesized from all branches | Comparison document written |
| **Code changes** | Winner's branch merged into yours | Fresh implementation committed | None — `.cook/compare-<session>.md` only |
| **Cost** | 1 judge call | 1 judge call + 1 full implementation | 1 judge call |
| **Best for** | When any single branch should be a complete solution | When branches each got different parts right | When you need to present options to the team |

**Use `pick` (default) when** you want the simplest outcome: one winner, merged. This is the right choice most of the time. Each branch attempted the full task independently, and the judge selects the best execution.

**Use `merge` when** you suspect different branches will have complementary strengths — for example, one branch might handle the UI well while another gets the data layer right. The merge resolver reads all branches and creates a fresh implementation that cherry-picks the best ideas. This costs an extra full agent call.

**Use `compare` when** you're not ready to commit to any approach. You want a written analysis of trade-offs — maybe for a team decision, an architecture review, or when you want to understand the solution space before choosing. No code is merged; you get a document.

---

## Recipes

### "I need a feature implemented"

**Simple feature, trust the agent:**
```sh
cook "Add a /health endpoint that returns 200 OK"
```

**Feature that benefits from refinement:**
```sh
cook "Implement user avatar upload with S3 storage" x3
```
Three passes. First pass builds the core, second catches edge cases, third polishes.

**Feature with specific acceptance criteria:**
```sh
cook "Implement dark mode" review \
     "Check that all components respect the theme, no hardcoded colors remain" \
     "DONE if no hardcoded colors found, else ITERATE"
```
Iterates until the acceptance criteria are met.

### "I need a high-quality result and I'm willing to spend tokens"

**Review loop with parallel versions:**
```sh
cook "Implement the caching layer" review v3 "most performant"
```
Runs 3 independent review-gated implementations in parallel, then picks the best.

**Different strategies, each quality-gated:**
```sh
cook "Implement caching with Redis" review \
  vs \
  "Implement caching with in-memory LRU" review \
  pick "best latency and simplicity trade-off"
```

### "I need to refactor a large codebase"

**Multi-pass refactor:**
```sh
cook "Migrate all class components to functional components with hooks" x5
```
Five passes. Each pass catches files and patterns the previous pass missed.

**Refactor with quality gate:**
```sh
cook "Migrate all class components to functional components with hooks" x3 review
```
Three refinement passes, then a review loop to verify nothing broke.

### "I'm exploring architectural options"

**Compare without committing:**
```sh
cook "Implement auth with JWT and refresh tokens" \
  vs \
  "Implement auth with server-side sessions" \
  compare
```
Writes a comparison document to `.cook/compare-<session>.md`. No code merged. Read the document, then decide.

**Let the judge decide:**
```sh
cook "Implement auth with JWT" \
  vs \
  "Implement auth with sessions" \
  pick "best security, simplest to maintain"
```
The judge reads both implementations and picks a winner based on your criteria.

### "I have a list of tasks to work through"

**Task list with quality gating per task:**
```sh
cook "Read plan.md. Find the next task marked [ ], implement it, mark it [x]" \
     review \
     "Review the implementation for correctness and edge cases" \
     "DONE if implementation is correct, else ITERATE" \
     ralph \
     "Read plan.md. If all tasks are [x] say DONE, else say NEXT"
```
Ralph advances through the list. Each task gets a full review loop. Omitting `N` uses the default max of 100 tasks.

**Task list without review (faster, cheaper):**
```sh
cook "Read plan.md. Find the next task marked [ ], implement it, mark it [x]" \
     ralph \
     "Read plan.md. If all tasks are [x] say DONE, else say NEXT"
```

### "I want to fix a bug"

**Simple bug fix:**
```sh
cook "Fix the off-by-one error in pagination — page 2 shows the same results as page 1"
```

**Bug fix with verification:**
```sh
cook "Fix the off-by-one error in pagination" review \
     "Run the test suite and check that pagination tests pass" \
     "DONE if all pagination tests pass, else ITERATE"
```

### "I want the best of N attempts"

```sh
cook "Write comprehensive tests for the auth module" v3 "best coverage"
```
Three parallel attempts at writing tests. The judge picks the one with the best coverage.

---

## Understanding operator order

Cook operators compose left to right — **each operator wraps everything to its left.** This means order changes the execution shape significantly. This is the most common source of confusion, so let's walk through it.

### `xN` and `review` ordering

```sh
cook "work" x3 review
```
**Reads as:** Do work 3 times, then run a review loop on the result.
```
work → work → work → review → gate → (iterate if needed)
                      ↑ reviews the accumulated result of all 3 passes
```

```sh
cook "work" review x3
```
**Reads as:** Do a review loop, then repeat that whole thing 3 times.
```
Round 1: work → review → gate → (iterate until DONE)
Round 2: work → review → gate → (iterate until DONE)
Round 3: work → review → gate → (iterate until DONE)
         ↑ each round is a full independent review-gated cycle
```

```sh
cook "work" x3 review x3
```
**Reads as:** Do work 3 times then review — and repeat that whole process 3 times.
```
Round 1: work → work → work → review loop
Round 2: work → work → work → review loop
Round 3: work → work → work → review loop
```

### Composition wraps everything

```sh
cook "work" review v3
```
**Reads as:** A review-gated cook, raced 3 times in parallel.
```
Branch 1: work → review → gate → (iterate until DONE)  ─┐
Branch 2: work → review → gate → (iterate until DONE)  ─┤─► judge picks best
Branch 3: work → review → gate → (iterate until DONE)  ─┘
```

```sh
cook "work" x3 v3
```
**Reads as:** 3-pass work, raced 3 times in parallel.
```
Branch 1: work → work → work  ─┐
Branch 2: work → work → work  ─┤─► judge picks best
Branch 3: work → work → work  ─┘
```

### The rule of thumb

Read the command left to right. Each operator captures everything before it as its "inner" operation:

- `"work"` → a single call
- `"work" x3` → that single call, repeated 3 times
- `"work" x3 review` → that repeated call, wrapped in a review loop
- `"work" x3 review v3` → that review-wrapped-repeated call, raced 3 times

If you're unsure what a command does, read it as nested parentheses from left to right:

```
"work" x3 review v3
→ (((work) x3) review) v3
→ race 3 copies of: review loop around: 3 passes of: work
```

---

## Mixing agents and models

Cook lets you use different agents or models for different steps. This is configured via CLI flags or `.cook/config.json`.

### When to mix agents

**Use a fast/cheap model for gate decisions:**
The gate step only needs to output DONE or ITERATE — it doesn't write code. A smaller, faster model handles this well and saves tokens.
```sh
cook "Implement feature" review --gate-model haiku
```

**Use a strong model for review:**
Review benefits from careful analysis. Pairing a fast worker with a thorough reviewer can be cost-effective.
```sh
cook "Implement feature" review --work-model sonnet --review-model opus
```

**Use different agents for different strengths:**
If one agent is better at code generation and another at code review, split the work.
```sh
cook "Implement feature" review --work-agent codex --review-agent claude
```

### When NOT to mix agents

- **Simple tasks** — the overhead of configuring per-step agents isn't worth it. Just use the defaults.
- **When you haven't benchmarked** — don't guess which agent is "better" at what. Try the default first, then experiment if results are unsatisfying.

---

## Sandbox modes

| Mode | When to use |
|---|---|
| `--sandbox agent` (default) | Most of the time. Each agent uses its own built-in sandboxing. No setup required. |
| `--sandbox docker` | When you want stronger isolation: no allowlist of permitted commands needed, environment variables are not exposed to the agent, network is restricted, and the environment is fully reproducible. Required for OpenCode. Also the right choice for CI/CD. |

If you're just getting started, don't set a sandbox mode — the default (`agent`) works out of the box.

---

## Rate-limit recovery

Cook automatically retries when agents hit rate limits or token quotas. This is on by default.

**Leave it on when:** You're running long jobs (ralph, compositions) where a rate limit in the middle would waste all prior work.

**Turn it off (`--no-wait`) when:** You're iterating quickly and would rather fail fast than wait. You can rerun the command yourself when the limit resets.

---

## Common mistakes

**Using `v3` when `x3` would suffice:**
`v3` runs 3 parallel branches in separate git worktrees with a judge step. If you don't need parallel exploration, `x3` is simpler, cheaper, and produces the same kind of iterative refinement — just sequentially.

**Putting `review` before `xN` when you meant after:**
`cook "work" review x3` runs 3 independent review loops. `cook "work" x3 review` runs work 3 times then reviews once. If you want "refine then check quality," the review goes after the repeats.

**Using `ralph` for a single task:**
Ralph is for task-list progression. If you have one task, just use `review`. Ralph adds an outer gate that only makes sense when there's a "next task" to advance to.

**Writing overly complex commands on day one:**
Start with `cook "prompt"`. If the result isn't good enough, add `review`. If you want more refinement passes, add `x3`. Only reach for `vN`, `vs`, or `ralph` when the simpler operators aren't solving your problem. Build up, don't start at the top.
