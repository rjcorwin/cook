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
- `vN` or `race N` — N identical branches in parallel
- `vs` — separates different branch prompts
- `pick ["<criteria>"]` — resolver: pick best (default)
- `merge ["<criteria>"]` — resolver: synthesize all
- `compare` — resolver: comparison doc, no merge

**Operators compose left to right.** Each wraps everything to its left.

Examples:
- `cook "Add dark mode" review` → work in review loop
- `cook "Add dark mode" x3` → 3 sequential passes
- `cook "Add dark mode" x3 review` → 3 passes, then review loop
- `cook "Add dark mode" review x3` → review loop repeated 3 times
- `cook "Add dark mode" v3 "cleanest"` → race 3, pick best
- `cook "A" vs "B" pick "best"` → two approaches, pick winner
- `cook "Next task in PLAN.md" ralph 5 "DONE if all done, else NEXT"` → task list

## Confirming the plan

Before executing, confirm the plan with the user. Example:

```
User: /cook "Implement dark mode" x3 review
You:  Plan: 3 repeat passes, then a review loop (max 3 iterations).
      Work prompt: "Implement dark mode"
      Proceed?
```

Wait for user confirmation before executing.

## Execution patterns

### Pattern: Work (no operators)

Spawn a single subagent to do the work.

```
Agent(prompt: "<work prompt>")
```

Report what the subagent did.

### Pattern: Review loop

Iterate: work → review → gate. Stop on DONE or max iterations.

```
iteration = 1, max = 3 (or user-specified N)
loop:
  1. Agent(prompt: "<work prompt>" + previous review feedback if any)
  2. Agent(prompt: "Review the changes just made in this project.
       <review prompt or default:
       'Look for bugs, missing edge cases, and code quality issues.
       Rate severity: High/Medium/Low.'>
       Use git diff to see what changed.")
  3. Parse the review. If no High severity issues → DONE. Stop.
     If High issues and iteration < max → ITERATE with feedback.
     If iteration >= max → stop (max iterations reached).
```

For the gate decision, you make the call yourself based on the review output — no need for a separate gate subagent. Read the review, apply the gate criteria, decide DONE or ITERATE.

### Pattern: Repeat (xN)

Spawn N sequential work subagents. Each sees the project state left by the previous.

```
for pass in 1..N:
  Agent(prompt: "<work prompt>")
  Report: "Pass {pass}/{N} complete."
```

### Pattern: Ralph (task-list progression)

Execute the inner pattern, then check if the task list is complete.

```
for task in 1..maxTasks:
  1. Execute inner pattern (work, or work+review, etc.)
  2. Agent(prompt: "<ralph gate prompt>")
  3. Parse response: DONE → stop. NEXT → continue.
```

### Pattern: Race (vN) and vs

Race N identical approaches or fork different approaches, then resolve.

**Step 1: Create branches.** Use Bash to create git worktrees for each branch:

```sh
# For each branch i:
git branch cook-race-{session}-{i}
git worktree add .cook/race/{session}/run-{i} cook-race-{session}-{i}
```

**Step 2: Run branches in parallel.** Spawn subagents simultaneously — each working in its own worktree directory:

```
# Launch ALL branches in a single message (parallel execution):
Agent(prompt: "You are working in .cook/race/{session}/run-1. <work prompt>")
Agent(prompt: "You are working in .cook/race/{session}/run-2. <work prompt>")
Agent(prompt: "You are working in .cook/race/{session}/run-3. <work prompt>")
```

For `vs`, each branch gets a different prompt.

IMPORTANT: Send all Agent calls in a **single message** so they run in parallel.

**Step 3: Resolve.** After all branches complete:

For `pick`:
```
# Get diffs from each branch
git -C .cook/race/{session}/run-1 diff master
git -C .cook/race/{session}/run-2 diff master
# etc.

# Judge: spawn agent to compare diffs and pick winner
Agent(prompt: "Compare these implementations:\n\nBranch 1 diff:\n...\nBranch 2 diff:\n...\n\nCriteria: <criteria>\nRespond with PICK <number> and reasoning.")

# Merge winner
git merge cook-race-{session}-{winner}
```

For `merge`: spawn a subagent to synthesize the best parts of all branches into a new implementation.

For `compare`: spawn a subagent to write a comparison doc. No merge.

**Step 4: Clean up.**

```sh
# Remove worktrees and branches
git worktree remove .cook/race/{session}/run-1
git branch -D cook-race-{session}-1
# etc.
```

### Composition: Operators compose

`x3 review` → 3 repeat passes, then a review loop.
`review x3` → the review loop repeated 3 times.
`review v3 pick` → race 3 branches, each running a review loop.

Apply left to right: each operator wraps the accumulated pattern so far.

## Status updates

Give brief updates at milestones:
- "Starting review loop (max 3 iterations)"
- "Iteration 1: work complete, reviewing..."
- "Gate: ITERATE — starting iteration 2 with feedback"
- "Gate: DONE — review loop complete"
- "Racing 3 branches..."
- "All branches complete. Comparing diffs..."
- "Picked branch 2. Merging..."
- "Ralph task 1/5: complete. Gate: NEXT"
