# Plan: Gate Verdict Parsing Fix + NEXT Keyword

**Status:** Draft
**Author:** rjcorwin + Claude
**Created:** 2026-03-07

## Summary

Fix `parseGateVerdict()` to detect keywords anywhere in the output (not just at line starts) and add NEXT as a new continue-loop keyword. Update default prompts and COOK.md template to document all three verdicts.

## Motivation

A bug causes gate verdicts wrapped in markdown (e.g. `**DONE**`) to be missed, resulting in runaway iteration loops. Additionally, the ITERATE keyword conflates "fix this work" with "move to next phase" — adding NEXT gives agents clearer guidance.

## Goals

- Fix `parseGateVerdict()` to use `includes` on the full output instead of `startsWith` per line
- Add NEXT to the iterate keyword list
- Update `DEFAULT_GATE_PROMPT` to explain DONE, ITERATE, and NEXT
- Update `DEFAULT_COOK_MD` to include a gate verdicts reference section

## Non-Goals

- Adding a separate return type for NEXT (it's semantically different but functionally identical to ITERATE)
- Migrating existing user COOK.md files

## Technical Design

### `src/loop.ts` changes

1. Add `'NEXT'` to `ITERATE_KEYWORDS`
2. Rewrite `parseGateVerdict()`:
   - Convert full output to uppercase once
   - Check `DONE_KEYWORDS` with `includes` (first match wins)
   - Check `ITERATE_KEYWORDS` with `includes`
   - Default to `'ITERATE'` if nothing matches

```ts
export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' {
  const upper = output.toUpperCase()
  if (DONE_KEYWORDS.some(kw => upper.includes(kw))) return 'DONE'
  if (ITERATE_KEYWORDS.some(kw => upper.includes(kw))) return 'ITERATE'
  return 'ITERATE'
}
```

### `src/cli.ts` changes

Update `DEFAULT_GATE_PROMPT` to describe all three verdicts:
- DONE — work complete, no High severity issues
- ITERATE — High severity issues need fixing in the work just done
- NEXT — current step is good, continue to next phase

### `src/template.ts` changes

Add a "Gate Verdicts" reference section to `DEFAULT_COOK_MD` so agents always have the verdict definitions in context, regardless of the gate prompt.

## Implementation Approach

1. Update `src/loop.ts` — add NEXT keyword, rewrite parseGateVerdict
2. Update `src/cli.ts` — revise DEFAULT_GATE_PROMPT
3. Update `src/template.ts` — add verdicts section to DEFAULT_COOK_MD
4. Type-check and verify build

All three files are independent edits, no ordering dependency.

## Alternatives Considered

**Strip formatting characters before `startsWith`** — Would fix the immediate bug but is fragile. New formatting patterns could break it again. `includes` on the full output is simpler and more robust.

**Make NEXT a separate return type** — Adds complexity to `agentLoop()` for no functional benefit. Both NEXT and ITERATE continue the loop. The distinction is purely semantic guidance for the agent.
