# Plan: Ralph Outer Gate

**Status:** Draft
**Author:** rjcorwin + Claude
**Created:** 2026-03-17
**Source:** plans/k5w-ralph-outer-gate/research.md

## Summary

Replace ralph's reliance on the inner gate's NEXT verdict with a dedicated outer gate step. After the inner gate says DONE, ralph runs a separate agent call — the ralph gate — which reads overall project state and returns NEXT (more tasks remain) or DONE (all complete). The inner gate returns only DONE/ITERATE; it no longer needs to know about remaining tasks.

## Motivation

In testing, the ralph loop exits prematurely because the inner gate says DONE when a task is complete — correctly, from its perspective — but ralph interprets DONE as "all work finished" and exits before remaining tasks run. The gate has no visibility into the task queue, so it cannot distinguish "this task is done" from "everything is done." Separating these concerns fixes the problem cleanly.

## Goals

- Inner gate only returns DONE/ITERATE in ralph context
- Ralph gate is a separate, dedicated agent step returning NEXT or DONE
- Ralph gate prompt is required (no silent default); missing prompt is an error with a helpful suggestion
- Ralph gate uses the shared session log for context
- Ralph gate step is separately configurable (agent, model, sandbox)
- Ralph gate is visible as a log line (not a full TUI step)

## Non-Goals

- Changing the `-n`/`--next` inline-next feature (unrelated, unaffected)
- Changing race behavior
- Supporting multiple ralph gate prompts or conditional branching

## Technical Design

### New loop structure

```
work → review → gate
                  ↓ ITERATE → iterate prompt → work
                  ↓ DONE → ralph gate
                              ↓ NEXT → work (same prompt, next ralph iteration)
                              ↓ DONE → exit ralph
```

### `ralphSegment.stringParam` changes meaning

Currently: next-task work prompt (used as `workPrompt` for task 2+).
After: ralph gate prompt (run after inner gate says DONE).

The work prompt is the same for every ralph iteration. It is self-directing — designed to pick the next incomplete task from project state on each run.

### Ralph gate prompt is required

If `ralphSegment` is present but has no `stringParam`, exit with an error:

```
Error: ralph requires a gate prompt.
  Example: cook "..." ralph 5 "If all tasks in plan.md are marked [done] say DONE, else say NEXT"
```

### Ralph gate step config

`StepName` gains `'ralph'`. The `steps.ralph` entry in `.cook/config.json` and new CLI flags `--ralph-agent`, `--ralph-model` configure the ralph gate's agent and model. Sandbox inherits from the ralph step config, falling back to the default sandbox. If no ralph step config is provided, falls back to the gate step config (same agent/model/sandbox as gate).

### Session log

The ralph gate receives the same session log path as the inner loop. It has full context of what was done in the completed task.

### Ralph gate verdict parsing

Reuses `parseGateVerdict` from `loop.ts`. NEXT → continue loop. DONE → exit. ITERATE is treated as DONE (the ralph gate is not an iterating step).

### NEXT removed from ralph's inner gate

`effectiveGatePrompt` in `cmdKeywordSegments` no longer switches to `DEFAULT_GATE_PROMPT_WITH_NEXT` when ralph is present. The inner gate uses `DEFAULT_GATE_PROMPT` (DONE/ITERATE only) in all ralph paths.

## Implementation Approach

### 1. `src/config.ts`

- Add `'ralph'` to `StepName` union type
- Add `ralph: StepAgentConfig` to `CookConfig.steps` default and parser

### 2. `src/cli.ts`

- Add `'--ralph-agent'` and `'--ralph-model'` to `VALUE_FLAGS`
- Add parsing for `--ralph-agent` and `--ralph-model` in `parseArgs` (stored on `ParsedArgs`)
- Update `resolveAgentPlan` to resolve the `ralph` step config using `--ralph-agent`/`--ralph-model`, falling back to gate step config
- In `cmdKeywordSegments`:
  - `ralphSegment.stringParam` → `ralphGatePrompt` (required; error if absent)
  - Remove the `nextPrompt` resolution block for the ralph path (and the `?? DEFAULT_NEXT_PROMPT` fallback)
  - Remove `effectiveGatePrompt` switching for ralph (inner gate always uses `DEFAULT_GATE_PROMPT`)
  - Pass `ralphGatePrompt` and ralph step config into `runRalph`
- Remove `nextPrompt` from `RalphConfig` (was the next-task work prompt; no longer needed)

### 3. `src/ralph.ts`

- Add `ralphGatePrompt: string` to `RalphConfig`
- Add `ralphStepConfig: StepSelection` to `RalphConfig`
- Remove `nextPrompt` from `RalphConfig`
- In `runRalph`, after inner gate returns DONE (i.e. `agentLoop` returns `{ verdict: 'DONE' }`):
  - Log: `▸ ralph gate — checking for more tasks...`
  - Run ralph gate agent call using `pool.get(ralphStepConfig.sandbox)` and `runner.runAgent(ralphStepConfig.agent, ralphStepConfig.model, ralphGatePrompt, ...)`
  - Parse verdict with `parseGateVerdict`; NEXT → continue loop, DONE → exit
- All ralph iterations use the same `workPrompt` (no task switching)
- `MAX_ITERATIONS` from inner loop still advances to next ralph iteration (unchanged)

### 4. Cleanup

- Remove `DEFAULT_GATE_PROMPT_WITH_NEXT` usage from the ralph code path in `cmdKeywordSegments`
- The constant itself can stay (still used by inline-next via `resolveIterateNext`)
- Confirm `-n`/`--next` inline-next path is unaffected (it goes through `runLoop`, not `runRalph`)

## Alternatives Considered

- **Option C (run N times unconditionally):** Simpler — no ralph gate step, just loop maxNexts times. Rejected because it removes early-exit capability and doesn't address the core design problem.
- **Shared gate prompt (no separate ralph gate):** Teach the inner gate about task count via prompt engineering. Rejected because the gate has no reliable way to inspect overall state on its own.
- **Inner gate returns NEXT, outer loop interprets it:** Current design. Rejected because it requires the gate to know about remaining tasks, which it cannot in an isolated agentLoop.
