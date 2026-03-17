# Research: Review Loop Primitive — Align Implementation to SPEC.md

**Requester:** rjcorwin
**Date:** 2026-03-17

## Requirements

### Original Request

Align the cook implementation to SPEC.md. The spec defines a composable grammar of primitives — work, xN (repeat), review, ralph, vN/race, vs, and resolvers — that compose left to right. The current implementation predates the spec and uses a different decomposition (race.ts, fork-join.ts with its own parser). The goal is to rewrite the CLI parser and execution engine so the implementation matches the spec exactly.

### Context

The spec (SPEC.md) was written as the canonical definition of how cook should work. It supersedes the ad-hoc grammar that evolved in the codebase. Key differences between spec and implementation:

1. **xN means repeat, not race.** The spec defines `xN` as sequential repetition (run work N times, each seeing prior output). The implementation treats `xN` as `race N` (parallel worktrees + judge). The spec uses `vN` / `race N` for parallel versions.

2. **`review` is an explicit keyword.** The spec has `cook "work" review` as a distinct form from `cook "work" "review" "gate"` (positional shorthand). The implementation has no `review` keyword — it always uses positional prompts.

3. **`iterate` is a 4th step.** The spec defines iterate as a separate step (distinct from work) used on ITERATE loops. The implementation reuses the work prompt.

4. **Resolvers are `pick`/`merge`/`compare`.** The spec uses `pick` (default), `merge`, and `compare`. The implementation uses `judge`/`merge`/`summarize`. `judge` → `pick`, `summarize` → `compare`.

5. **`vs` branches are full cooks.** Each branch can have its own xN, review, and ralph. The implementation's `tripleToBranch` only supports work/review/gate/maxIterations.

6. **Ralph doesn't exist yet.** The z4h-ralph-task-loop research covers this but no code exists.

7. **Second-level composition.** The spec allows `cook "A" vs "B" pick "best" v3 pick "most thorough"`. The implementation's meta-parallelism (`x3` after join) is similar but uses the old naming.

8. **`x1` and `v1` are no-ops.** The current `extractRaceMultiplier` requires N >= 2.

### Open Questions

1. ~~**Rename or alias `judge`→`pick`, `summarize`→`compare`?**~~ **Resolved: hard cut.** `judge`→`pick`, `summarize`→`compare`, no aliases. This ships as a major version so no backwards compat concern.

2. ~~**Should `review` keyword with no prompts imply the review loop, or should bare `cook "work"` also run review?**~~ **Resolved: yes, skip review.** `cook "work"` is a single sandboxed LLM call — no review loop. This makes bare cook valuable as a simple way to run a prompt in the configured sandbox (especially useful with docker). `cook "work" review` explicitly opts into the review loop.

3. ~~**Parser architecture: single-pass left-to-right or multi-phase?**~~ **Resolved: unified parser.** Replace `parseArgs`, `extractRaceMultiplier`, and `parseForkJoinArgs` with a single left-to-right token scanner. Eliminates duplicated flag sets and ad-hoc routing in `main()`. The spec grammar is strictly left-to-right (`<prompt> [xN] [review] [xN] [resolver]`), so a single-pass scanner produces a pipeline AST directly. New keywords (`review`, `ralph`, `compare`, `pick`) slot in naturally.

4–5. ~~**`xN` repeat implementation / execution model.**~~ **Resolved: recursive AST node.** `xN` becomes a `Repeat(inner, count)` AST node that wraps everything to its left. The executor runs `inner` N times sequentially, each pass appending to the same session log so subsequent passes see prior output. Review loop `${iteration}` resets each repeat pass; `${repeatPass}` / `${maxRepeatPasses}` track the outer repeat. `x1` is a valid no-op.

6. ~~**Template variables for repeat and ralph.**~~ **Resolved: dedicated vars, undefined when inactive.** Add `${repeatPass}` / `${maxRepeatPasses}` for xN repeat, `${ralphIteration}` / `${maxRalph}` for ralph. All are undefined when their respective operator isn't active. Templates use conditional logic (e.g. `${repeatPass ? '...' : ''}`) to include them only when defined. Default COOK.md template does not include repeat or ralph vars — users add them when needed.

7. ~~**`compare` resolver behavior.**~~ **Resolved: align to spec.** Output goes to `.cook/compare-<session>.md` as the spec defines. Simpler flat path, no nested directories. Current `summarize` path (`.cook/fork/<session>/comparison.md`) is replaced.

8. ~~**`race N` vs `vN` — are these truly identical?**~~ **Resolved: yes, both are keywords.** `race` is a first-class keyword (`cook "work" race 3`), and `vN` is shorthand for `race N`. Parser accepts both forms. For consistency, `xN` also has a long-form keyword `repeat N` (same pattern: `xN` is shorthand for `repeat N`).

9. ~~**Default resolver.**~~ **Resolved: `pick` is default.** Aligns to spec. This is a behavior change from the current `merge` default. Major version, so acceptable.

10. ~~**MAX_ITERATIONS behavior in ralph.**~~ **Resolved: stop with default of 100.** When the inner review loop hits max iterations without DONE, ralph stops entirely (does not advance to next task). If the inner loop can't converge, blindly advancing is dangerous. A warning is logged. Default ralph max tasks is 100.

11. ~~**Inline-next (`-n`/`--next`) from z4h research — in scope?**~~ **Resolved: deferred.** This is a convenience shortcut that lets the inner gate return NEXT (advance to next task) without the full ralph outer loop. Not core to the grammar — ship without it, add later if demand emerges.

## System Architecture

### Current Execution Paths

```
main()
  ├─ hasForkJoinSyntax(args)?  → cmdForkJoin → parseForkJoinArgs → runForkJoin
  ├─ extractRaceMultiplier(args)?  → cmdRaceFromMultiplier → runRace
  ├─ command === 'race'?  → cmdRace → runRace
  └─ default  → runLoop → agentLoop
```

Three separate code paths with three parsers. The spec's grammar requires a unified approach because operators compose freely.

### Proposed Execution Model (from spec)

The spec's grammar is:

```
cook "<work>" [xN] [review ["<review>"] ["<gate>"] ["<iterate>"] [max-iterations]] \
     [ralph [N] "<ralph-gate>"] \
     [vN | race N | vs ... ] [resolver] ["<criteria>"] \
     [vN | race N] [resolver] ["<criteria>"]
```

This is a pipeline of operators applied left to right. The natural representation is an AST:

```
CookAST = {
  work: string
  repeat?: number                    // xN before review
  review?: {
    reviewPrompt?: string
    gatePrompt?: string
    iteratePrompt?: string
    maxIterations?: number
  }
  repeatOuter?: number               // xN after review (wraps review)
  ralph?: {
    maxTasks?: number
    gatePrompt: string
  }
  composition?: {
    type: 'race' | 'vs'
    count?: number                   // for race/vN
    branches?: CookAST[]            // for vs
    resolver: 'pick' | 'merge' | 'compare'
    criteria?: string
  }
  secondComposition?: {             // after resolver
    type: 'race'
    count: number
    resolver: 'pick' | 'merge' | 'compare'
    criteria?: string
  }
}
```

But `xN` nesting (`cook "work" x3 review x3`) makes a flat struct insufficient. The spec's leftward-wrapping rule means each `xN` creates a new repeat layer around everything before it. This is better modeled as:

```
Node = Work(prompt)
     | Repeat(inner: Node, count: number)
     | ReviewLoop(inner: Node, review?, gate?, iterate?, maxIter?)
     | Ralph(inner: Node, maxTasks, gatePrompt)
     | Composition(branches: Node[], resolver, criteria)
```

The parser builds this tree left-to-right, and the executor walks it recursively.

### Key Files to Change

| File | Current Role | Change |
|------|-------------|--------|
| `src/cli.ts` | 3 parsers + routing | Replace with unified parser producing AST |
| `src/loop.ts` | work→review→gate loop | Add iterate step; make it a composable unit |
| `src/template.ts` | Template rendering | Add `ralphIteration`, `maxRalph`, `repeatPass` vars |
| `src/config.ts` | Step types | Add `'iterate'` and `'ralph'` to StepName |
| `src/race.ts` | Parallel worktrees + judge | Refactor to be the executor for `Composition` nodes |
| `src/fork-join.ts` | vs + join strategies | Merge into race.ts or rename; align resolver names |
| New: `src/parser.ts` | — | Unified left-to-right token parser |
| New: `src/executor.ts` | — | Recursive AST executor |
| New: `src/ralph.ts` | — | Ralph outer loop |

### Data Flow (proposed)

```
CLI args
  → tokenize (split positional vs flags)
  → parse tokens into AST (left-to-right, building tree)
  → resolve config (merge CLI flags + .cook/config.json)
  → execute AST recursively:
      Work → single agent call
      Repeat → loop N times, threading lastMessage
      ReviewLoop → work→review→gate→iterate cycle
      Ralph → outer NEXT/DONE loop around inner node
      Composition → git worktrees, parallel execution, resolver
```

### Constraints

- **No behavior change for documented commands** unless the spec explicitly redefines them (like `xN` changing from race to repeat).
- **Git worktree isolation** still required for composition operators (race/vs).
- **Session log continuity** — all steps in a single cook execution share one session log.
- **Event system** — TUI still needs step/line/done/error events; the event protocol may need extension for repeat passes and ralph iterations.

## Prior Art

### z4h-ralph-task-loop research

Covers ralph in detail: the 4-prompt cook, ralph outer gate, `CookLoopResult` return type, and composition with race/vs. Key decisions already made there:
- cookLoop should return `CookLoopResult { verdict, iterations }`
- Ralph gate falls back to gate step config
- Ralph gate prompt is required (not defaulted)
- Session log is shared across ralph iterations

### Existing parser patterns

`parseForkJoinArgs` in `cli.ts` already does left-to-right token scanning with duck typing. The new unified parser would generalize this approach.

### AST-based CLI tools

Tools like `jq` and `awk` use AST representations for their expression grammars. The cook grammar is simpler — no precedence, no grouping beyond leftward wrapping — so a single-pass parser building a tree should suffice.
