# Research: Iterate Prompt, Next Prompt, and Ralph Loop

**Requester:** rjcorwin
**Date:** 2026-03-15

## Requirements

### Original Request

Add three new capabilities to the cook loop:

1. **Iterate prompt** — An optional prompt used when the gate says ITERATE, overriding the work prompt for fix-up passes.
2. **Next prompt** — A distinct prompt used when the gate says NEXT, meaning "the current work passed review, move on to the next task." After both ITERATE and NEXT, the loop returns to work → review → gate.
3. **Ralph loop** — A keyword-delimited mode (like `race`) that enables the NEXT mechanic. When the gate says NEXT, the iteration counter resets. A separate max-nexts limit prevents infinite looping.

Additionally, the `race` keyword syntax should be formalized to replace the `xN` shorthand, and both `race` and `ralph` should be composable in any order via right-to-left nesting.

### Context

- The `xN` race syntax (e.g., `cook "w" x3 "criteria"`) already exists but should migrate to `cook "w" race 3 "criteria"`.
- "Ralph loop" is a term for putting an LLM in a loop to work through a task list one item at a time.
- The user wants minimal typing — boolean flags (`-n`, `-i`) with sensible defaults, plus full `--option-name` support.

### Open Questions

- ~~Should `xN` syntax be removed or kept as an alias?~~ Keep as alias for backward compat.
- ~~Can race and ralph be combined?~~ Yes, they compose. Rightmost keyword = outermost wrapper.

## System Architecture

### Related Components

| File | Role | Changes needed |
|------|------|----------------|
| `src/cli.ts` | Arg parsing, command dispatch | New keyword parser, `--iterate`/`--next`/`-i`/`-n` flags, ralph dispatch |
| `src/loop.ts` | Core work→review→gate loop | Gate verdict gains NEXT, iterate prompt support, iteration reset on NEXT |
| `src/race.ts` | Race mode (worktree-based parallelism) | Accept ralph-wrapped configs, compose with ralph |
| `src/config.ts` | Config types and loading | New fields: `iterate`, `next`, `maxNexts` in config |
| `src/template.ts` | COOK.md template rendering | New context variables for iterate/next state |
| `src/ui/App.tsx` | TUI status bar | Display ralph step count, iterate vs next state |

### Data Flow

Current: `cli.ts` parses args → builds `LoopConfig` → calls `agentLoop()` which runs work→review→gate in a for loop.

Proposed: `cli.ts` parses args into segments (base prompts, then keyword segments) → if ralph keyword present, wraps `agentLoop` in an outer ralph loop → if race keyword present, wraps in race parallelism → keywords compose right-to-left.

### Constraints

- Backward compatibility: `cook "w" "r" "g" 5` and `cook "w" x3` must still work.
- Race and ralph keyword params are position-flexible (duck typed): `race 3 "criteria"` or `race "criteria" 3` both work — the number is the count, the string is the criteria/prompt.
- Full `--option-name` flags must also work for all new params.

## Prior Art

- Current `extractRaceMultiplier()` in cli.ts scans for `xN` pattern and splits args into before/after segments. The keyword parser generalizes this approach.
- The loop in `agentLoop()` is a simple for loop with DONE/ITERATE verdict parsing. Adding NEXT is a third verdict that triggers outer-loop advancement.
