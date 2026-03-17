# Research: Ralph Task Loop

**Requester:** rjcorwin
**Date:** 2026-03-17

## Requirements

### Original Request

Add a `ralph` keyword to the cook CLI that runs the inner work→review→gate loop repeatedly to work through a task list. The canonical usage:

```sh
cook "Read plan.md, mark the next incomplete task [in progress] and implement it" \
     "Code review marking issues high/medium/low" \
     "If no high/medium issues, mark [in progress] task as [done] in plan.md and say DONE, else say ITERATE" \
     "Iterate on implementation for [in progress] task in plan.md, fixing high/medium issues per prior review" \
     ralph 5 \
     "If all tasks in plan.md are marked [done] say DONE, else say NEXT"
```

The positional grammar is `cook <work> [review] [gate] [iterate] [max-iterations] ralph N "gate-prompt"`. Arguments before `ralph` are duck-typed: a number is `max-iterations`, any other string is the next positional prompt.

The work prompt is self-directing — it picks the next incomplete task from project state on each iteration. The inner gate does both quality control and state management (marking the in-progress task as `[done]` before saying DONE). After the inner gate says DONE, a separate **ralph gate** agent step reads overall project state and returns NEXT (more tasks remain) or DONE (all complete). This cleanly separates quality control (inner gate) from orchestration (ralph gate).

An optional **iterate prompt** (4th positional) overrides the work prompt on fix-up passes when the inner gate says ITERATE. It is task-aware by referencing the `[in progress]` marker in project state, so it knows which task to fix without re-picking.

### Context

Two prior plans explored this space:

**p7x-iterate-next-ralph** (implemented, then superseded): Added iterate prompt, NEXT as an inner gate verdict, `ralph` keyword, and race+ralph composition. The core problem: the inner gate runs in an isolated agentLoop and cannot see the task queue. When a task completes, the gate correctly says DONE — but ralph interprets DONE as "all work finished" and exits. The gate has no reliable way to distinguish "this task is done" from "all tasks are done."

**k5w-ralph-outer-gate** (planned, never implemented): Redesigned ralph around a dedicated outer gate step. The inner gate returns only DONE/ITERATE. After inner DONE, ralph runs a separate ralph gate agent call that reads overall project state. The ralph string param becomes the ralph gate prompt (not a next-task work prompt). This design was established as the correct architecture but was never implemented before the branch was shelved.

This plan starts from the current main branch (no ralph code) and implements the k5w architecture cleanly, incorporating what is useful from p7x without the parts that led to the design problem.

### What We Are Not Carrying Forward

- **NEXT as an inner gate verdict in ralph context**: The inner gate does not return NEXT when ralph is active. The ralph gate handles advancement.
- **The next-task work prompt**: In k5w, the work prompt is the same for every ralph iteration. It is self-directing; it reads project state to find the next task.
- **The `DEFAULT_GATE_PROMPT_WITH_NEXT` injection into the inner gate**: Not needed when the inner gate stays at DONE/ITERATE.

### Open Questions

These require explicit decisions before planning:

1. ~~**Iterate prompt: in scope?**~~ **Resolved: yes.** The canonical example includes it as the 4th positional arg. It is implemented as part of this plan.

2. **Inline-next (`-n`/`--next`): in scope?** A related feature from p7x: the inner gate can return NEXT to switch the work prompt mid-loop without a separate ralph gate step. This handles a different use case (ad-hoc task switching within one loop run) and was kept separate in k5w. Decision needed: include it here or defer?

3. **Race + ralph composition: in scope?** p7x planned `cook "w" race 3 ralph 5 "gate"` — ralph wrapping race, or race wrapping ralph. k5w did not address this. It requires the keyword segment parser (see below) and refactoring `runRace` to accept an inner execution function. Decision needed: in scope or defer to a separate plan?

4. **`race` keyword segment generalization: in scope?** Currently `extractRaceMultiplier` scans for `xN` (e.g. `x3`). The p7x keyword segment parser replaces this with a general `race` / `ralph` keyword parser supporting duck-typed params (`cook "w" race 3 "criteria"`). This is a prereq for race+ralph composition but also useful on its own (cleaner syntax). Decision needed: migrate `race` to keyword syntax here, or just add `ralph` as a standalone keyword?

5. **MAX_ITERATIONS behavior in ralph context**: When the inner agentLoop hits its iteration limit without DONE, should ralph advance to the next task (same behavior as today's p7x code) or stop entirely? The two behaviors have different tradeoffs: advancing means a task may be only partially done; stopping is more conservative.

6. **p7x plan-002 bug fixes: in scope?** Three fixes from plan-002 apply to the current main codebase regardless of ralph:
   - **M5**: `extractRaceMultiplier` consumes boolean flag args as values (e.g. `cook "w" x3 --hide-request "criteria"` silently eats `"criteria"`)
   - **M7**: `confirm`/`pickOne` in `race.ts` hang on non-interactive stdin (no `isTTY` guard)
   - **L7**: iterate/next resolution logic is duplicated in three places in cli.ts
   Decision needed: include these bug fixes here, or track them separately?

## System Architecture

### Current State (main branch)

The codebase has no ralph-specific code. The current loop:

- `src/loop.ts`: `agentLoop()` runs work→review→gate in a for loop, returns `Promise<void>`. `parseGateVerdict()` returns `'DONE' | 'ITERATE'`. Gate is always the last step; DONE exits, ITERATE continues.
- `src/cli.ts`: `extractRaceMultiplier()` scans for `xN` pattern. `hasForkJoinSyntax()` routes `vs`-containing args to fork-join. Default case: if `xN` found → `cmdRaceFromMultiplier`, else → `runLoop`.
- `src/config.ts`: `StepName = 'work' | 'review' | 'gate'`. No ralph step. `CookConfig.steps` is `Record<StepName, StepAgentConfig>`.
- `src/race.ts`: `runRace()` creates worktrees, runs agentLoop in parallel. `confirm()` and `pickOne()` use readline with no TTY guard.
- No `src/ralph.ts` exists.

### Components That Need to Change

| File | Change |
|------|--------|
| `src/loop.ts` | Return `LoopResult` with verdict from `agentLoop`; add `iteratePrompt` (optional) to `LoopConfig` — when set, ITERATE passes use this prompt instead of `workPrompt` |
| `src/ralph.ts` | New file: `runRalph()` outer loop, ralph gate agent call |
| `src/cli.ts` | Keyword segment parser (replacing or extending `extractRaceMultiplier`), ralph dispatch, flag support |
| `src/config.ts` | Add `'ralph'` to `StepName`; add ralph step config to `CookConfig.steps` |

### Data Flow (proposed)

```
cli.ts parses args
  → if vs-syntax → fork-join (unchanged)
  → if ralph keyword present
      → cmdRalph(workPrompt, reviewPrompt, gatePrompt, ralphGatePrompt, maxNexts, ...)
          → runRalph(maxNexts, ralphGatePrompt, ralphStepConfig, agentLoopConfig)
              loop n = 1..maxNexts:
                → agentLoop(agentLoopConfig) → LoopResult { verdict: 'DONE' | ... }
                → if DONE → run ralph gate step
                    → if NEXT → continue loop (same workPrompt)
                    → if DONE → exit
                → if MAX_ITERATIONS → [advance or stop: open question]
  → else → existing runLoop / cmdRaceFromMultiplier (unchanged)
```

### Constraints

- **No behavior change to existing commands**: `cook "w" "r" "g" 5`, `cook "w" x3 "criteria"`, `cook "w" vs "w"` must all work identically.
- **Inline-next unaffected**: If included, `-n`/`--next` goes through `runLoop` only, never through `runRalph`.
- **Ralph gate prompt is required**: Missing prompt is an error with a helpful example, not a silent default.
- **Session log is shared**: Ralph gate receives the same session log as the inner loop for full context.
- **Ralph gate falls back to gate step config**: If no `steps.ralph` config is set, use the gate step's agent/model/sandbox.

## Prior Art

### k5w data flow diagram

The k5w plan includes a precise before/after data flow that resolves the core design question. The proposed architecture is taken directly from k5w's "Data Flow (proposed)" section — this is the established decision.

### p7x keyword segment parser

p7x designed a `KeywordSegment` interface and duck-typing rules (number = count/limit; other string = prompt) for parsing keyword params in any order. This parser design is sound and reusable for `ralph` regardless of whether `race` is migrated to the same system.

### `parseForkJoinArgs()` in cli.ts

The existing fork-join arg parser is a good model for left-to-right positional parsing with duck-typed params. The ralph keyword parser should follow the same style.

### agentLoop return value

Currently `agentLoop` returns `void`. For ralph to work, it needs to return a result so the outer wrapper knows whether the inner loop ended with DONE, MAX_ITERATIONS, or ERROR. The return type `LoopResult { verdict: 'DONE' | 'ITERATE' | 'MAX_ITERATIONS' | 'ERROR', iterations: number }` from p7x is the right shape.
