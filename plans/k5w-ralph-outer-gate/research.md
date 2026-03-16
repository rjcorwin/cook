# Research: Ralph Outer Gate

**Requester:** rjcorwin
**Date:** 2026-03-16

## Requirements

### Original Request

Redesign the ralph loop so that task sequencing is handled by a dedicated outer gate step rather than by the inner gate. The canonical usage:

```
cook "Read plan.md, mark the next incomplete task as [in progress], and implement it" \
     "Code review marking issues high/medium/low" \
     "If no high/medium issues, say DONE and mark item in plan.md as [done], else say ITERATE" \
     "Fix medium/high issues identified in code review" \
     ralph 5 \
     "If all items in plan.md are marked [done] say DONE, else say NEXT"
```

The ralph string param is now the **ralph gate prompt** — a separate agent step that runs after the inner gate says DONE, deciding whether to advance (NEXT) or finish (DONE).

### Context

Current ralph design has the inner gate return DONE/NEXT/ITERATE. The problem: in ralph context, the gate cannot know whether there are more tasks remaining because each task runs in an isolated `agentLoop`. It sees the current task as complete and says DONE, which exits the ralph loop prematurely.

The root cause is a conflation of two concerns:
- **Inner gate**: quality control — "is this task done correctly?"
- **Outer gate (ralph)**: orchestration — "is there more work to do overall?"

The proposed fix separates them. The inner gate only deals with DONE/ITERATE. The ralph outer gate only deals with NEXT/DONE and runs in the project context with full visibility into overall state (e.g., plan.md, a checklist file, whatever the user defines).

### Open Questions

- What is the default ralph gate prompt when the user doesn't provide one?
- Does the ralph gate run as a new agent invocation (expensive) or can it be lightweight?
- Does the ralph gate share the session log with the inner loop, or does it get fresh context?
- What step config (agent, model, sandbox) does the ralph gate use? Same as inner gate? Separately configurable?
- What happens to the existing `-n` / `--next` inline-next feature? It's unrelated to ralph and should stay, but needs to be clearly separated.
- What happens to `maxNexts`? It currently limits NEXT transitions — does it become the ralph loop limit (max tasks)?
- Should the ralph gate step be visible in the TUI?

## System Architecture

### Related Components

**`src/cli.ts`**
- `cmdKeywordSegments`: parses `ralph N "prompt"` keyword segment. Currently sets `ralphSegment.stringParam` as the next-task work prompt and wires it into `nextPrompt`. This needs to change: `stringParam` becomes the ralph gate prompt.
- `resolveIterateNext`: helper that resolves iterate/next config. The "next" concept in the ralph path diverges from inline-next and may need to be separated.
- `DEFAULT_GATE_PROMPT_WITH_NEXT`, `DEFAULT_NEXT_PROMPT`: used to inject NEXT into the inner gate when ralph is present. Both become unnecessary in the ralph path.

**`src/ralph.ts`**
- `runRalph`: loops up to `maxNexts` times. Each iteration runs `agentLoop`. On DONE → exits. On NEXT/MAX_ITERATIONS → advances.
- Currently no "ralph gate" step exists. The NEXT verdict comes from the inner gate, which is the problem.

**`src/loop.ts`**
- `agentLoop`: runs work → review → gate. Returns `LoopResult` with verdict DONE/ITERATE/NEXT/MAX_ITERATIONS/ERROR.
- `parseGateVerdict`: parses DONE/ITERATE/NEXT from gate output. In the new design, ralph's inner gate never returns NEXT, so this parsing is still correct but NEXT from the inner gate in ralph context becomes a no-op or treated as DONE.

**`src/race.ts`**
- `runRace`: unaffected by this change. Race with ralph composition is also affected — when ralph wraps race, the ralph gate should run after each race result.

### Data Flow (current)

```
cmdKeywordSegments
  → ralphSegment.stringParam → nextPrompt (next-task work prompt)
  → effectiveGatePrompt = DEFAULT_GATE_PROMPT_WITH_NEXT
  → runRalph(maxNexts, ..., { nextPrompt, gatePrompt: effectiveGatePrompt })
      → agentLoop({ workPrompt (task 1), gatePrompt: WITH_NEXT })
          → gate returns DONE/NEXT/ITERATE
          → if NEXT → agentLoop returns { verdict: 'NEXT' }
      → ralph sees NEXT → runs agentLoop({ workPrompt: nextPrompt (task 2), ... })
      → ralph sees DONE → exits
```

### Data Flow (proposed)

```
cmdKeywordSegments
  → ralphSegment.stringParam → ralphGatePrompt (outer gate prompt)
  → gatePrompt = DEFAULT_GATE_PROMPT (DONE/ITERATE only)
  → runRalph(maxNexts, ..., { ralphGatePrompt, gatePrompt })
      → agentLoop({ workPrompt, gatePrompt: DONE/ITERATE only })
          → gate returns DONE or ITERATE only
          → on DONE → agentLoop returns { verdict: 'DONE' }
      → ralph sees DONE → runs ralph gate step (new agent invocation)
          → ralph gate reads project state (plan.md, etc.)
          → ralph gate returns NEXT or DONE
          → if NEXT → loop continues (same workPrompt)
          → if DONE → ralph exits
      → ralph sees MAX_ITERATIONS → advances (same as today)
```

### Constraints

- **Backward compat for `-n`**: inline-next (`-n`/`--next`) is a separate, unrelated feature and must not be broken. Its code path goes through `runLoop` directly, not `runRalph`.
- **Backward compat for `cook ralph` with no string param**: `cook "work" ralph 3` (no ralph gate prompt) needs a sensible default.
- **Ralph + race composition**: `cook "work" race 3 ralph 5 "gate prompt"` — the ralph outer gate should still run after each race result resolves. `runRalph` already calls `runRace` internally; the ralph gate step would run after `runRace` returns.
- **Cost**: the ralph gate is an additional LLM call per ralph iteration. This is intentional but should be noted. If the user omits the ralph gate prompt and no default is needed, there's an option to skip the step — but a default prompt is cleaner.

## Prior Art

### Inline-next (`-n`)

Already implemented in `agentLoop`. The gate returns NEXT, the loop switches the work prompt to `nextPrompt` and continues. This handles a different use case (mid-loop task switching) and is unrelated to ralph's sequential task orchestration.

### Current ralph

`runRalph` in `src/ralph.ts` already runs tasks sequentially with the same `agentLoop`. The outer loop structure is there; it just lacks the separate outer gate step.

### CONTRIBUTING.md RPI workflow

The proposed ralph usage mirrors the RPI workflow directly: the work step picks the next task from plan.md, the gate reviews quality, and the ralph gate checks if the plan is complete. This is the motivating use case.
