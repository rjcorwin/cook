# Code Review: Align Implementation to SPEC.md

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/cli.ts, src/config.ts, src/template.ts, src/loop.ts, src/race.ts, src/fork-join.ts

## Summary

The implementation delivers a well-structured rewrite: a recursive AST parser and a recursive executor that together replace three ad-hoc parsers and scattered dispatch logic. The architecture is sound — the AST types are clean, the executor's pattern-matching on node types is clear, and the plan's goals (xN as repeat, explicit review, ralph, iterate, resolver rename) are all addressed. Two high-severity issues need fixing before merge: composition worktrees leak on SIGINT, and the `compare` resolver allows second-level composition contrary to the spec. Several medium issues around duplicated code and resource management should be addressed.

## What Works Well

- **Clean AST design** — The `Node` union type is simple, correct, and maps directly to the spec grammar. Parser produces it; executor consumes it. No intermediate representations.
- **Left-to-right parsing** — `parsePipeline` is straightforward and handles the full grammar including positional duck-typing, xN/vN patterns, and second-level composition.
- **Executor recursion** — Each node type handler is self-contained. The `execute` switch is easy to follow and extend.
- **Template variable passthrough** — Adding `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses` to `LoopContext` works automatically with the existing dynamic `Function` constructor in `renderTemplate`.
- **Step config fallback chain** — iterate→work and ralph→gate fallbacks in `resolveStepSelection` (cli.ts:188-191) are clean.
- **cli.ts simplification** — The main dispatch is now 5 lines: parse → resolve → execute. Much cleaner than the previous multi-parser routing.

## Issues

### High

- [ ] **Composition worktrees leak on SIGINT** (`executor.ts:429`) — The `registerCleanup` in `executeComposition` only unmounts the TUI. If the process is killed mid-composition (SIGINT/SIGTERM), worktrees and git branches are left on disk. The cleanup should also remove worktrees and stop runner pools. Fix: register a cleanup function that calls `removeWorktree` for each created worktree and `pool.stopAll()` for each pool, in addition to unmounting.

- [ ] **`compare` resolver allows second-level composition** (`parser.ts:314-351`) — SPEC.md line 293 states: "Cannot be followed by a second composition." The parser checks `resolver !== 'compare'` when consuming criteria (line 304) but still allows a `vN`/`race N` token after compare at lines 314-316. `cook "work" v3 compare v3 pick` would parse without error, creating a second-level composition wrapping a compare. Fix: skip the second-level composition check when `resolver === 'compare'`, or throw an error.

### Medium

- [ ] **Unknown tokens silently skipped** (`parser.ts:363`) — Any unrecognized token in the pipeline is silently consumed with `i++`. A user typo like `cook "work" reveiw` (misspelling) produces a bare work node with no error. This makes debugging difficult. Fix: throw an error or emit a warning for unrecognized tokens.

- [ ] **`executeRalph` creates a new runner pool per iteration** (`executor.ts:316`) — `createRunnerPool(...)` is called inside the ralph for-loop, meaning each of potentially 100 ralph tasks spins up a fresh pool (and potentially a fresh Docker container). Fix: hoist pool creation before the loop and reuse it, stopping once after the loop exits.

- [ ] **`executeBranchForComposition` duplicates executor logic** (`executor.ts:521-651`) — This ~130-line function duplicates the structure of `executeWork`, `executeReview`, `executeRepeat`, and `executeRalph`, but with a different emitter. If a bug is fixed in one path, it must be fixed in both. Consider threading the emitter through `ExecutionContext` (as an optional field) or extracting shared logic into helpers that accept an emitter parameter.

- [ ] **TUI mount/unmount per `executeWork` call** (`executor.ts:108-117`) — Each call to `executeWork` renders and unmounts a full Ink TUI. When called inside `executeRepeat`, the TUI flickers N times. Consider lifting TUI lifecycle to the repeat or review level, or adding a "batch mode" that reuses a single TUI instance across repeat passes.

- [ ] **Redundant step fallback logic in `loop.ts`** (`loop.ts:75-79`) — The iterate→work and ralph→gate fallback is implemented here AND in `resolveStepSelection` in cli.ts. If only one location is updated, they can diverge. Since `resolveStepSelection` already produces the correct config, the fallback in `loop.ts` is redundant. Remove it, or consolidate fallback logic in one place.

### Low

- [ ] **Dead code: `splitVsBranches`** (`parser.ts:371-392`) — This function is defined but never called. The `parse()` function (line 411-523) implements its own inline vs-splitting logic. Remove the unused function.

- [ ] **Branch nodes share references, not clones** (`parser.ts:292`) — `Array.from({ length: count }, () => current)` creates N references to the same `Node` object. The executor currently treats the AST as immutable, so this works, but it's fragile. If any future code mutates a branch node during execution, all branches are affected. Consider deep-cloning nodes with `structuredClone(current)`.

- [ ] **Banner omits iterate/ralph step config** (`cli.ts:403-411`) — The startup banner shows work/review/gate step config but not iterate or ralph. Users configuring these steps get no confirmation that their settings took effect.

- [ ] **Sequential cleanup** (`executor.ts:65-70`) — `cleanupActiveExecutions` awaits each cleanup function sequentially. If there are many worktrees, this slows down SIGINT handling. Consider `Promise.allSettled(Array.from(activeCleanups).map(fn => fn()))`.

- [ ] **Build not verified** — Per the devlog, `npm install` and `tsup` couldn't run in the sandbox environment. TypeScript type-checking and build verification have not been performed. This should be done before merge.

## Questions

- Should `executeWork` within a composition context (via `executeBranchForComposition`) emit on `loopEvents` or the branch emitter? Currently it uses the branch emitter, which is correct for `RaceApp`, but standalone `App` components won't see these events if they're ever used in that context.
- The spec's template variables table (SPEC.md line 371-381) doesn't include `repeatPass` or `maxRepeatPasses`. The plan adds them. Is the spec the source of truth, or should the spec be updated to include these?
- `parseRalphVerdict` defaults to `NEXT` when no verdict keyword is found (`executor.ts:364`). Is this the desired behavior? A model that doesn't include NEXT/DONE in its output will silently continue the ralph loop rather than erroring.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see issues above)

The two high issues (SIGINT worktree cleanup and compare validation) should be fixed before merge. The medium issues around duplicated code and resource management are strongly recommended but could be deferred if needed.
