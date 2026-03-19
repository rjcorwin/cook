---
name: cook
description: Orchestrate coding agents with review loops, parallel races, repeat passes, and task-list progression. Use when: the user asks to "cook" something, wants iterative refinement, wants to race multiple approaches, or needs to work through a task list.
allowed-tools: Bash(cook *)
argument-hint: "<prompt>" [operators...] [flags...]
---

# Cook — Agent Orchestration CLI

`cook` wraps your coding agent (Claude Code, Codex, OpenCode) in composable workflows: review loops, repeat passes, parallel races, and task-list orchestration.

**Important: Never use `--sandbox none`.** The default sandbox mode (`agent`) is correct when running as a skill. It preserves the parent agent's security boundaries.

## Quick reference

```sh
# Single work call
cook "Implement dark mode"

# Review loop (work → review → gate, repeat until DONE)
cook "Implement dark mode" review

# Repeat 3 times
cook "Improve the design" x3

# Race 3 versions, pick the best
cook "Implement dark mode" v3 pick "cleanest implementation"

# Two approaches, pick the winner
cook "Auth with JWT" vs "Auth with sessions" pick "best security"

# Work through a task list
cook "Do the next task in PLAN.md" \
     ralph 5 "DONE if all tasks complete, else NEXT"

# Everything composes
cook "Implement dark mode" review v3 "cleanest result"
```

## Operators

Operators compose left to right. Loop operators wrap everything to their left.

### Loop operators

| Operator | Effect |
|----------|--------|
| `review` | Add a review→gate loop (up to 3 iterations by default) |
| `review N` | Review loop with up to N iterations |
| `xN` / `repeat N` | Run work N times sequentially |
| `ralph N "gate"` | Outer gate for task-list progression (DONE/NEXT) |

Custom review/gate prompts (positional shorthand):
```sh
cook "work prompt" "review prompt" "gate prompt"
cook "work prompt" "review prompt" "gate prompt" "iterate prompt" N
```

### Composition operators

| Operator | Effect |
|----------|--------|
| `vN` / `race N` | N identical runs in parallel worktrees |
| `vs` | 2+ different runs in parallel worktrees |
| `pick ["criteria"]` | Resolver: pick one winner (default) |
| `merge ["criteria"]` | Resolver: synthesize all results |
| `compare` | Resolver: write comparison doc, no merge |

### Composition examples

```sh
cook "A" vs "B" pick "criteria"          # two approaches, pick winner
cook "A" vs "B" merge "best of both"     # synthesize both
cook "A" vs "B" compare                  # comparison doc only
cook "A" v3 "criteria"                   # race 3, implicit pick
cook "A" x3 vs "B" x3 pick "best"       # per-branch loop operators
```

## Flags

```
--max-iterations N             Max review iterations
--work-agent AGENT             Per-step agent override
--review-agent AGENT
--work-model MODEL             Per-step model override
--review-model MODEL
--hide-request                 Hide the templated request panel
```

## Prerequisites

Before running cook:
1. The project must have `cook init` run (creates COOK.md, .cook/config.json)
2. For composition operators (vs, vN), the working tree must be clean (commit first)

## When to use cook vs doing the work directly

Use cook when:
- The user explicitly asks to "cook" or "let it cook"
- Multiple iterations of refinement are needed (review loops)
- Multiple competing approaches should be tried (races, vs)
- A task list needs sequential progression (ralph)
- The user wants autonomous completion without manual review cycles

Do the work directly when:
- It's a simple, one-shot change
- The user wants to review each step interactively
