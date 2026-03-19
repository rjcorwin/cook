---
name: cook
description: Agent orchestration primitives — review loops, repeat passes, parallel races, and task-list progression. No CLI needed. Use when the user wants iterative refinement, competing approaches, or autonomous task completion.
argument-hint: "<prompt>" [operators...]
---

# Cook — Pure Agent Orchestration

You are an orchestrator. You do not do the work directly — you delegate to subagents and manage the workflow. Each subagent gets a fresh context and works independently. You coordinate.

## Parsing the request

The user's input after `/cook` follows this grammar:

```
cook "<work prompt>" [loop operators...] [composition operators...]
```

**Loop operators** (wrap work with iteration):
- `review` — review→gate loop (default 3 max iterations)
- `review N` — review→gate loop with N max iterations
- `review "<review prompt>" "<gate prompt>"` — custom prompts
- `xN` or `repeat N` — run work N times sequentially
- `ralph N "<gate prompt>"` — outer task-list progression

**Composition operators** (parallel branches):
- `vN` or `race N` — N identical branches in parallel worktrees
- `vs` — separates different branch prompts
- `pick ["<criteria>"]` — resolver: pick best (default)
- `merge ["<criteria>"]` — resolver: synthesize all
- `compare` — resolver: comparison doc, no merge

**Operators compose left to right.** Loop operators wrap everything to their left.

Examples:
- `cook "Add dark mode" review` → work in review loop
- `cook "Add dark mode" x3` → 3 sequential passes
- `cook "Add dark mode" x3 review` → 3 passes, then review loop
- `cook "Add dark mode" review x3` → review loop repeated 3 times
- `cook "Add dark mode" v3 "cleanest"` → race 3, pick best
- `cook "A" vs "B" pick "best"` → two approaches, pick winner
- `cook "Next task in PLAN.md" ralph 5 "DONE if all done, else NEXT"` → task list

## Execution patterns

Parse the user's input, then execute the matching pattern below.

### Pattern: Work (no operators)

Spawn a single subagent to do the work.

```
Agent(prompt: "<work prompt>", description: "cook: work")
```

### Pattern: Review loop

Spawn a work subagent. Then spawn a review subagent to review the diff. Then spawn a gate subagent to decide DONE or ITERATE. If ITERATE, spawn another work subagent with the review feedback. Repeat up to max iterations.

```
iteration = 1
loop:
  1. work_agent = Agent(prompt: "<work prompt>" + previous feedback if any)
  2. review_agent = Agent(prompt: "Review the changes in this project. <review prompt or default: 'Look for bugs, missing edge cases, and code quality issues. Rate severity: High/Medium/Low.'>")
  3. gate_agent = Agent(prompt: "Based on this review:\n<review output>\n\n<gate prompt or default: 'Respond with exactly DONE or ITERATE. DONE if no High severity issues remain. ITERATE if there are High issues or the work is incomplete.'>")
  4. if gate says DONE → stop
  5. if gate says ITERATE and iteration < max → iteration++, go to 1 with review feedback
  6. if iteration >= max → stop (max iterations reached)
```

### Pattern: Repeat (xN)

Spawn N sequential work subagents, each seeing the project state left by the previous one.

```
for pass in 1..N:
  Agent(prompt: "<work prompt>", description: "cook: repeat pass {pass}/{N}")
```

### Pattern: Review + Repeat

Apply operators left to right. `x3 review` means: 3 repeat passes, then a review loop. `review x3` means: the review loop itself repeated 3 times.

### Pattern: Race (vN)

Spawn N subagents in **parallel**, each in an **isolated worktree**. Wait for all to complete. Then spawn a judge subagent to compare and pick.

```
# Launch all branches in parallel — use a single message with multiple Agent calls
for i in 1..N:
  Agent(
    prompt: "<work prompt>",
    isolation: "worktree",
    description: "cook: race branch {i}/{N}"
  )

# After all complete, judge the results
Agent(prompt: "Compare the changes made in these branches:\n<branch diffs>\n\nPick criteria: <criteria or 'best overall implementation'>\n\nRespond with: PICK <number>\n<reasoning>")

# Merge the winning branch
```

IMPORTANT: Launch all race branches in a **single message** with multiple Agent tool calls so they run in parallel.

### Pattern: vs (fork-join)

Like race, but each branch has a **different prompt**.

```
# Launch branches in parallel with different prompts
Agent(prompt: "<prompt A>", isolation: "worktree", description: "cook: vs branch 1")
Agent(prompt: "<prompt B>", isolation: "worktree", description: "cook: vs branch 2")

# Judge and resolve
```

### Pattern: Ralph (task-list progression)

Execute the inner work pattern, then check if the task list is complete. If not, advance and repeat.

```
for task in 1..maxTasks:
  1. Execute inner pattern (work, or work+review, etc.)
  2. ralph_gate = Agent(prompt: "<ralph gate prompt>")
  3. if gate says DONE → stop
  4. if gate says NEXT → continue to next task
```

### Resolvers

After parallel branches complete:

- **pick**: Judge selects one winner. Merge that branch's worktree.
- **merge**: Judge creates a synthesis. Spawn a new subagent to implement the merged vision.
- **compare**: Judge writes a comparison document to `.cook/compare-<timestamp>.md`. No merge.

## Subagent guidelines

- Always use `isolation: "worktree"` for race/vs branches — this gives each branch a clean copy of the repo
- Work subagents should be given the full work prompt, not a summary
- Review subagents should examine the actual code changes (use `git diff`)
- Gate subagents must output exactly `DONE` or `ITERATE` (or `NEXT` for ralph)
- When merging a winning worktree branch, the Agent tool returns the worktree path and branch — use `git merge` to bring it in

## Status updates

As you orchestrate, give the user brief status updates at natural milestones:
- "Starting review loop (max 3 iterations)"
- "Iteration 1: work complete, launching review..."
- "Gate: ITERATE — launching iteration 2"
- "Gate: DONE — review loop complete"
- "Racing 3 branches in parallel worktrees..."
- "All branches complete. Judging..."
- "Picked branch 2. Merging..."
