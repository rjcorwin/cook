# Research: Fork-Join Parallel Exploration

**Requester:** rjcorwin
**Date:** 2026-03-15

## Requirements

### Original Request

Add a fork-join pattern to cook: spawn parallel explorations in separate git worktrees using different prompts, then compare, merge, or summarize the results. The new grammar extends the existing CLI with `vs` (branch separator), `judge`/`merge`/`summarize` (join strategies), and `x<N>` as meta-parallelism over the entire fork-join.

### Context

Cook currently supports a single-path loop (work → review → gate → iterate) and a race mode (`x<N>`) that runs N identical loops in parallel and judges among them. The gap is that both require the same prompt for all branches — you can't explore two fundamentally different approaches in one command. A developer choosing between `date-fns` and a hand-rolled formatter today has to run cook manually twice, compare branches by hand, and decide.

### Open Questions

- How does `x<N>` route correctly between race and fork-join? The token semantics are actually the same in both modes ("run N parallel instances of this pipeline") — what changes is what the pipeline is. `vs` presence is the fork-join trigger; without `vs`, `x<N>` routes to the existing race path unchanged. `extractRaceMultiplier()` in `cli.ts` can be reused for extraction in both cases.
- When one branch in a fork-join fails (agent error, gate never passing), does the join proceed with remaining branches? If zero branches succeed, what's the error behavior?
- Where does the `merge` agent run? It needs to read diffs from multiple worktrees but write new code somewhere. Does it get its own fresh worktree, or does it work in a temporary directory?
- What does `x<N>` without a prior `judge` or `merge` (i.e., `x<N>` applied to `summarize`) mean? The spec says it's an error — confirm this is the right call versus silently ignoring.
- Does `x<N>` inherit `judge`/`merge` criteria when no explicit criteria string follows, or does it require its own?

## System Architecture

### Related Components

**`src/race.ts`** — The closest existing analog. Already implements:
- `createWorktree()` / `removeWorktree()`: git worktree add/remove, config file copying
- `runRace()`: parallel `agentLoop()` invocations via `Promise.allSettled()`
- Judge prompt construction (`buildJudgePrompt()`) and verdict parsing (`parseJudgeVerdict()`, expects `PICK <N>`)
- Post-run commit, apply winner, cleanup worktrees (with user confirmation)
- Session ID scheme: `YYYYMMDD-HHMMSS`, worktrees at `.cook/race/{session}/run-{i}`

**`src/loop.ts`** — Core `agentLoop()` already accepts `projectRoot` in `LoopConfig`, so it is already parameterized for running in a worktree. No changes needed to the loop itself.

**`src/cli.ts`** — Argument parsing and command routing. Currently `main()` detects race multiplier with `extractRaceMultiplier()` and falls back to single loop. The new grammar parsing goes here. `parseArgs()` parses a single triple (`--work`, `--review`, `--gate` or positional). Fork-join needs to parse multiple triples separated by `vs`.

**`src/runner.ts`** — `RunnerPool` manages runners per sandbox mode. Race mode creates one pool per run — fork-join will do the same (one pool per branch per instance).

**`src/ui/RaceApp.tsx`** / **`App.tsx`** — RaceApp already renders N parallel logs. Fork-join can reuse RaceApp for the branch execution phase. The judge/merge/summarize phase may need an extension (or a new terminal render pass).

### Data Flow

**Existing race flow:**
```
CLI args → parseArgs (single triple) → extractRaceMultiplier(N)
  → runRace(N, projectRoot, config)
    → createWorktree × N
    → agentLoop × N (parallel, same prompts)
    → git commit × N
    → buildJudgePrompt (concatenated logs) → agent → PICK <N>
    → apply winner, cleanup
```

**Proposed fork-join flow:**
```
CLI args → parseForkJoinArgs
  → ForkJoinConfig {
      branches: [{ work, review, gate, maxIterations }...],
      join: { type, criteria },
      parallel: { count, criteria } | null
    }
  → runForkJoin(config, projectRoot)
    if parallel.count > 1:
      → runForkJoinInstance × N (parallel)
        → each instance: createWorktree × branches.length
                         agentLoop × branches.length (parallel, different prompts)
                         join strategy → winner/merged/summary
      → meta-judge over N winners
    else:
      → runForkJoinInstance × 1
        → createWorktree × branches.length
        → agentLoop × branches.length (parallel)
        → join strategy
```

**Judge join:**
- Same as existing race judge: build prompt with all branch diffs + logs, run agent, parse `PICK <N>`
- Preserve winning worktree, clean up losers

**Merge join:**
- Build same input as judge, but prompt asks agent to synthesize rather than pick
- Agent writes code in a fresh worktree (its own cook loop: work → review → gate)
- Output is the merged worktree

**Summarize join:**
- Build same input as judge, write `comparison.md` to the original working directory
- No winner; leave all worktrees for human inspection

### Constraints

- **Backwards compatibility:** Existing `cook "prompt" x3 "criteria"` and `cook race N "prompt"` syntax must continue to work unchanged. Fork-join is only triggered when `vs` is present.
- **Worktree naming:** Existing race uses `.cook/race/{session}/run-{i}`. Fork-join can use `.cook/fork/{session}/inst-{i}-branch-{j}` to avoid collision and clearly identify the structure.
- **Git state:** Each worktree gets its own branch from HEAD. Merge strategy needs a fresh worktree too (not one of the branch worktrees, since it synthesizes).
- **`merge` iteration cap:** The spec allows `merge "criteria" 5` — the number after the criteria string is the merge cook loop's max iterations. This follows the same positional pattern as branch iteration caps.
- **No Docker image changes:** Worktree isolation is filesystem-level; sandbox/Docker infrastructure is unchanged.
- **TypeScript strict mode:** All new code must compile under `strict: true`.

## Prior Art

**`src/race.ts` (existing):** The fork-join feature is a direct generalization of race mode. Race runs N instances of the same triple; fork-join runs M different triples (branches) with configurable join strategies, optionally wrapped in N meta-parallel instances. The worktree management, parallel execution, and judge patterns from race.ts should be reused and extended — not duplicated.

**`src/cli.ts` `extractRaceMultiplier()`:** Already parses `x3`-style tokens from args. Fork-join needs a more structured parser for the full grammar (multiple triples separated by `vs`), but can borrow the `x<N>` extraction logic.

**git worktree:** Used by race.ts already. The same `git worktree add` / `git worktree remove --force` approach applies. The main consideration for fork-join is that worktrees for M branches per instance × N instances can pile up — the naming scheme and cleanup need to handle this at scale.
