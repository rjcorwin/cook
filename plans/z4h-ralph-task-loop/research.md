# Research: Ralph Task Loop

**Requester:** rjcorwin
**Date:** 2026-03-17

## Requirements

### Original Request

Extend the cook from 3 prompts (work, review, gate) to 4 (work, review, gate, iterate), and add a `ralph` keyword that wraps the cook with an outer gate for task progression. `race` and `vs` are composition operators that run multiple loops — bare cook or ralph-extended — in parallel. The canonical ralph usage:

```sh
cook "Read plan.md, mark the next incomplete task [in progress] and implement it" \
     "Code review marking issues high/medium/low" \
     "If no high/medium issues, mark [in progress] task as [done] in plan.md and say DONE, else say ITERATE" \
     "Iterate on implementation for [in progress] task in plan.md, fixing high/medium issues per prior review" \
     ralph 5 \
     "If all tasks in plan.md are marked [done] say DONE, else say NEXT"
```

The positional grammar is `cook <work> [review] [gate] [iterate] [max-iterations] ralph N "gate-prompt" [xN]`. Arguments before `ralph` are duck-typed: a number is `max-iterations`, any other string is the next positional prompt. `xN` after `ralph` races N ralph loops in parallel. `vs` between two full loop definitions (with or without ralph) runs them in parallel.

### The 4-prompt cook

The cook is the core primitive: work → review → gate, with iterate as the step used in place of work when the gate says ITERATE.

```
Pass 1:    work → review → gate
Pass 2+:   iterate → review → gate   (if gate said ITERATE)
           exit                       (if gate said DONE)
```

The iterate prompt is task-aware — in the ralph context it references the `[in progress]` marker in project state so it knows which task to fix without re-picking.

### Ralph outer gate

The cook's gate handles quality control (DONE/ITERATE only). It cannot handle task orchestration — it runs in an isolated context and cannot see the task queue. Ralph adds an outer gate step that runs after the cook's gate says DONE. The ralph gate reads overall project state and returns NEXT (more tasks remain) or DONE (all complete).

The work prompt is self-directing — it picks the next incomplete task from project state on each ralph iteration. The cook's gate also does state management (marking the in-progress task as `[done]` before saying DONE), leaving the ralph gate to check overall completion.

### Context

The cook's gate cannot distinguish "this task is done" from "all tasks are done" because it has no visibility into the task queue. The ralph outer gate solves this: after the cook's gate says DONE, a separate ralph gate agent step runs with full project context and decides whether to advance (NEXT) or stop (DONE).

### Open Questions

These require explicit decisions before planning:

1. ~~**Iterate prompt: in scope?**~~ **Resolved: yes.** The cook loop is extended to 4 prompts as part of this plan.

2. **Inline-next (`-n`/`--next`): in scope?** A feature where the inner gate can return NEXT to switch the work prompt mid-loop without a ralph outer gate. This handles a different use case (ad-hoc task switching within one loop run) and is unrelated to ralph. Decision needed: include it here or defer?

3. ~~**Race + ralph composition: in scope?**~~ **Resolved: yes.** Ralph is an extension of the cook. Race and vs are composition operators that work on any loop — bare cook or ralph. `cook w r g ralph 4 "gp" x3` races 3 ralph loops; `cook w r g ralph 4 "gp" vs w r g ralph 4 "gp"` runs two ralph loops in parallel. `runRace` and vs dispatch need to accept a loop execution function rather than calling `cookLoop` directly.

4. ~~**`race` keyword segment generalization: in scope?**~~ **Resolved: yes, required.** For `xN` to compose with ralph, the arg parser must detect both `ralph` and `xN` in the same invocation and produce a composed execution. The existing `extractRaceMultiplier` path needs to cooperate with ralph detection rather than run as a separate branch.

5. **MAX_ITERATIONS behavior in ralph context**: When the cook loop hits its iteration limit without DONE, should ralph advance to the next task or stop entirely? Advancing means a task may be only partially complete; stopping is more conservative.

6. **p7x plan-002 bug fixes: in scope?** Three fixes apply to the current main codebase regardless of ralph:
   - **M5**: `extractRaceMultiplier` consumes boolean flag args as values (e.g. `cook "w" x3 --hide-request "criteria"` silently eats `"criteria"`)
   - **M7**: `confirm`/`pickOne` in `race.ts` hang on non-interactive stdin (no `isTTY` guard)
   - **L7**: iterate/next resolution logic is duplicated in three places in `cli.ts`
   Decision needed: include these here or track separately?

## System Architecture

### Current State (main branch)

The codebase has no ralph-specific code. The current cook loop:

- `src/loop.ts`: `cookLoop()` (currently named `agentLoop`) runs work→review→gate in a for loop, returns `Promise<void>`. `parseGateVerdict()` returns `'DONE' | 'ITERATE'`. Gate is always the last step; DONE exits, ITERATE continues. No iterate prompt exists.
- `src/cli.ts`: `extractRaceMultiplier()` scans for `xN` pattern. `hasForkJoinSyntax()` routes `vs`-containing args to fork-join. Default case: if `xN` found → `cmdRaceFromMultiplier`, else → `runLoop`.
- `src/config.ts`: `StepName = 'work' | 'review' | 'gate'`. No ralph or iterate step.
- `src/race.ts`: `runRace()` creates worktrees, calls `cookLoop` directly. `confirm()` and `pickOne()` use readline with no TTY guard.
- No `src/ralph.ts` exists.

### Components That Need to Change

| File | Change |
|------|--------|
| `src/loop.ts` | Rename `agentLoop` → `cookLoop`; add `iteratePrompt` to `LoopConfig`; return `CookLoopResult` with verdict |
| `src/ralph.ts` | New file: `runRalph(ralphConfig, loopFn)` — outer loop and ralph gate agent call |
| `src/race.ts` | Accept a loop function `() => Promise<CookLoopResult>` instead of calling `cookLoop` directly |
| `src/fork-join.ts` | Same refactor as race: accept loop functions to support ralph loops in vs |
| `src/cli.ts` | Parse ralph keyword and xN together; build composed execution; update fork-join segment parsing |
| `src/config.ts` | Add `'ralph'` to `StepName`; add `iteratePrompt` to loop config types; add ralph step config |

### Execution model

The composable unit is a **loop**: either a bare `cookLoop` or a `runRalph` wrapping one. Race and vs operate on loops.

```
loop = cookLoop(config)                         // bare cook
     | runRalph(ralphConfig, cookLoop(config))  // ralph-extended cook
```

Composition:
```
race N  → runRace(N, () => loop)       // N loops in parallel worktrees
vs      → runVs([loop, loop, …])       // N loops in parallel, resolved
```

### Data Flow (proposed)

```
cli.ts parses args
  → if vs-syntax
      → parse each vs-segment as a loop config (cookConfig + optional ralphConfig)
      → runVs(segments.map(s => () => s.ralph ? runRalph(s, cookLoop) : cookLoop(s)))
  → else
      → parse loopConfig from base positional args
      → parse optional ralphConfig (ralph keyword)
      → parse optional raceN (xN)
      → if ralph + race → runRace(N, () => runRalph(ralphConfig, cookLoop(loopConfig)))
      → if ralph only   → runRalph(ralphConfig, cookLoop(loopConfig))
      → if race only    → runRace(N, () => cookLoop(loopConfig))
      → else            → cookLoop(loopConfig)

runRalph(ralphConfig, loopFn):
  loop n = 1..maxNexts:
    → sessionFn() → CookLoopResult
    → if DONE → run ralph gate step
        → if NEXT → continue (same workPrompt)
        → if DONE → exit
    → if MAX_ITERATIONS → [advance or stop: open question #5]
```

### Constraints

- **No behavior change to existing commands**: `cook "w" "r" "g" 5`, `cook "w" x3 "criteria"`, `cook "w" vs "w"` must all work identically.
- **Inline-next unaffected**: If included, `-n`/`--next` goes through `runLoop` only, never through `runRalph`.
- **Ralph gate prompt is required**: Missing prompt is an error with a helpful example, not a silent default.
- **Session log is shared**: Ralph gate receives the same session log as the cook for full context.
- **Ralph gate falls back to gate step config**: If no `steps.ralph` config is set, use the gate step's agent/model/sandbox.

## Prior Art

### Keyword segment parsing

The `parseForkJoinArgs()` function in `cli.ts` is a good model for left-to-right positional parsing with duck-typed params. The ralph keyword parser should follow the same style. Duck-typing rules: a positive integer → numeric param (count/limit); any other string → string param (prompt); `--flags` are not consumed as keyword params.

### cookLoop return value

Currently `cookLoop` (named `agentLoop`) returns `void`. For ralph to work, it needs to return a result so the outer wrapper knows how the loop ended. The return type should be `CookLoopResult { verdict: 'DONE' | 'MAX_ITERATIONS' | 'ERROR', iterations: number }`.
