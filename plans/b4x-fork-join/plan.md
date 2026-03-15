# Plan: Fork-Join Parallel Exploration

**Status:** Draft
**Author:** rjcorwin
**Created:** 2026-03-15

## Summary

Extend cook's CLI with a fork-join pattern: multiple branches defined by different work/review/gate triples are separated by `vs`, run in parallel in isolated git worktrees, and then combined via one of three join strategies — `judge` (pick a winner), `merge` (synthesize the best parts via its own cook loop), or `summarize` (produce a comparison doc for human review). An optional `x<N>` suffix wraps the entire pipeline in N meta-parallel instances with a final meta-judge. All new behavior is additive; existing single-loop and race (`x<N>` without `vs`) syntax is unchanged.

## Motivation

Cook's race mode already runs N identical loops in parallel to find the best implementation of a single approach. The missing primitive is comparing two fundamentally different approaches in one command — e.g., "use date-fns" vs "roll your own formatter." Today this requires two separate cook runs, manual branch comparison, and a human decision. Fork-join makes that a single command with an optional automated decision.

## Goals

- Parse the new `vs` / `judge` / `merge` / `summarize` / `x<N>` grammar from CLI args
- Run branches in parallel in separate git worktrees, each with its own cook loop
- Implement all three join strategies (judge, merge, summarize)
- Support `x<N>` meta-parallelism wrapping the entire fork-join pipeline
- Reuse existing worktree management and `agentLoop` from `race.ts` and `loop.ts`
- Backwards-compatible: no changes to existing single-loop or race behavior

## Non-Goals

- Changing the core `agentLoop` or sandbox/runner infrastructure
- Supporting more than two levels of nesting (fork-join of fork-joins)
- A TUI redesign — reuse `RaceApp` where possible, extend minimally

## Technical Design

### Grammar

```
cook <work> <review> <gate> [max-iterations]
     [vs <work> <review> <gate> [max-iterations]]+
     [judge <criteria> | merge <criteria> [max-iterations] | summarize]
     [x<N> [criteria]]
```

`vs` requires a join keyword. `summarize` + `x<N>` is an error. `x<N>` without criteria inherits from `judge`/`merge`. `x<N>` with criteria overrides the join criteria for the meta-judge.

### Structured config

`parseForkJoinArgs()` produces:

```typescript
interface ForkJoinConfig {
  branches: Array<{
    work: string
    review: string
    gate: string
    maxIterations: number
  }>
  join:
    | { type: 'judge'; criteria: string }
    | { type: 'merge'; criteria: string; maxIterations: number }
    | { type: 'summarize' }
  parallel: { count: number; criteria: string | null } | null
}
```

### Worktree naming

```
.cook/fork/{session}/inst-{i}-branch-{j}
```

- `session`: `YYYYMMDD-HHMMSS` (same scheme as race)
- `i`: instance index (1-based), always `1` when `x<N>` is absent
- `j`: branch index (1-based)
- Merge strategy gets its own worktree: `inst-{i}-merge`

### Join strategies

**Judge:** Reuse `buildJudgePrompt()` and `parseJudgeVerdict()` from `race.ts`. Pass each branch's git diff (relative to HEAD) and its session log. Agent responds `PICK <N>`. Winning worktree is preserved; losers are cleaned up.

**Merge:** Build the same input as judge but instruct the agent to synthesize. Run the synthesis as a cook loop (`agentLoop`) in a fresh `inst-{i}-merge` worktree. The merge loop's work/review/gate prompts are generated from the criteria string: work = "Synthesize the best parts of the provided branches: {criteria}", review = the branch-level review prompt from branch 1 (or a default), gate = the branch-level gate prompt from branch 1 (or a default). All branch diffs and logs are injected into the COOK.md context via a preamble file in the merge worktree.

**Summarize:** Build same input as judge. Write `comparison.md` to the original working directory. Leave all branch worktrees in place for human inspection. Print paths.

### `x<N>` meta-parallelism

When `parallel.count > 1`, run `parallel.count` full fork-join instances in parallel via `Promise.allSettled()`. Each instance produces: a winning worktree (judge), a merged worktree (merge), or branch worktrees + comparison.md (summarize). After all instances complete, run a meta-judge agent over the N winners using `parallel.criteria ?? join.criteria`.

## Implementation Approach

### Step 1: `parseForkJoinArgs()` in `cli.ts`

- Scan args left-to-right collecting triples (work, review, gate, optional number)
- On `vs`: push current triple to `branches[]`, start collecting next triple
- On `judge`/`merge`/`summarize`: record join strategy and remaining args (criteria string, optional number for `merge`)
- On `x<N>`: extract count and optional trailing criteria string
- Validate: `vs` without join → error; `summarize` + `x<N>` → error; fewer than 2 branches when `vs` present → error
- Return `ForkJoinConfig`
- Detect fork-join in `main()`: if args contain `vs`, call `parseForkJoinArgs()` instead of `parseArgs()`, then call `runForkJoin()` instead of `runLoop()` or `runRace()`

### Step 2: `runForkJoinInstance()` in a new `src/fork-join.ts`

- Accept `ForkJoinConfig`, `session`, `instanceIndex`, `projectRoot`
- Create `branches.length` worktrees at `.cook/fork/{session}/inst-{i}-branch-{j}`
- Copy `.cook/config.json`, `.cook/docker.json`, `COOK.md` into each (same as `createWorktree()` in `race.ts`)
- Build one `LoopConfig` per branch from `branch.work/review/gate/maxIterations`
- Run all branches in parallel with `Promise.allSettled()`, one `agentLoop` per branch
- Commit each branch's worktree result
- Dispatch to join strategy handler

### Step 3: Join strategy handlers in `src/fork-join.ts`

**`judgeInstance(branches, criteria, projectRoot)`:**
- Collect diffs (`git diff HEAD`) and log files from each branch worktree
- Build judge prompt (extend `buildJudgePrompt()` from race.ts or duplicate/import)
- Run agent (use gate step config), parse `PICK <N>`
- Return winning branch index; caller cleans up losers

**`mergeInstance(branches, criteria, maxIterations, projectRoot, session, instanceIndex)`:**
- Build judge-style prompt as context
- Create merge worktree at `inst-{i}-merge`
- Write a `MERGE_CONTEXT.md` into the merge worktree containing all branch diffs and logs
- Modify that worktree's `COOK.md` to reference `MERGE_CONTEXT.md`
- Run `agentLoop` in merge worktree with synthesized prompts
- Return merge worktree path

**`summarizeInstance(branches, projectRoot)`:**
- Collect diffs and logs
- Build summarize prompt asking for a structured comparison
- Run agent, write output to `comparison.md` in `projectRoot`
- Return path to `comparison.md`

### Step 4: `runForkJoin()` in `src/fork-join.ts`

- Entry point called from `cli.ts`
- If `parallel` is null or `parallel.count === 1`: call `runForkJoinInstance()` once, present result
- If `parallel.count > 1`: run `parallel.count` instances via `Promise.allSettled()`, then meta-judge
- Meta-judge: same pattern as `judgeInstance()` but over the N winners/merges

### Step 5: TUI

- Reuse `RaceApp` for the branch execution phase (branches are the "runs")
- Meta-parallel instances can be rendered as a second level or sequentially with labeled headers
- This is the lowest-priority step; a plain terminal log fallback is acceptable for v1

### Step 6: Cleanup

- Winner worktree: preserve, print path, ask user to merge into current branch (same UX as race.ts)
- Non-winning worktrees: ask user to confirm cleanup, then `removeWorktree()` each
- Summarize: print `comparison.md` path, ask user if worktrees should be cleaned up

### Key files to create/modify

| File | Change |
|------|--------|
| `src/fork-join.ts` | New — all fork-join orchestration and join strategies |
| `src/cli.ts` | Add `parseForkJoinArgs()`, detect `vs` in `main()`, route to `runForkJoin()` |
| `src/race.ts` | Export `createWorktree`, `removeWorktree`, `buildJudgePrompt`, `parseJudgeVerdict` so fork-join.ts can import them (currently they may be unexported) |

## Alternatives Considered

**Extending `race.ts` directly:** Adding fork-join logic into `race.ts` would make that file handle two distinct modes (N-identical and M-different). A separate `fork-join.ts` keeps concerns separated and `race.ts` unchanged.

**A single unified grammar that replaces `x<N>` race syntax:** Unifying the grammars would simplify the parser but risks breaking existing scripts. Keeping `vs` as the trigger for fork-join and treating `x<N>` without `vs` as race preserves backwards compatibility without special-casing.

**`merge` always uses branch prompts for review/gate:** Using the originating branch's review/gate prompts for the merge loop is convenient but may produce inconsistent results when branches have different prompts. A `merge` with user-supplied review/gate prompts is a possible future extension but adds grammar complexity not warranted for v1.
