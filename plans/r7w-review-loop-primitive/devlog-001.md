# Devlog: Align Implementation to SPEC.md

**Date:** 2026-03-17
**Implementing:** plan.md

## What Was Done

- **Created `src/parser.ts`** — Unified parser that produces a recursive AST from CLI args. Single exported `parse(args)` function that:
  - Separates `--flags` from positional tokens
  - Detects `vs` for branch segmentation (each segment parsed independently)
  - Parses single pipelines left-to-right: work prompt → xN/repeat → review → ralph → vN/race → resolver → second-level composition
  - Handles positional prompt duck-typing (bare strings fill review/gate/iterate slots)
  - Supports all reserved keywords: `review`, `ralph`, `race`, `repeat`, `vs`, `pick`, `merge`, `compare`, plus `xN`/`vN` patterns

- **Updated `src/config.ts`** — Extended `StepName` from `'work' | 'review' | 'gate'` to include `'iterate' | 'ralph'`. Updated `loadConfig` to parse `steps.iterate` and `steps.ralph` from config.json. Updated defaults to include all 5 steps.

- **Updated `src/template.ts`** — Extended `LoopContext` with optional fields: `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`. These flow through to `renderTemplate` automatically via the dynamic Function constructor.

- **Updated `src/loop.ts`** — Added `iteratePrompt` to `LoopConfig`. Modified `agentLoop` loop body so iteration 1 runs work→review→gate and iteration 2+ runs iterate (or work if no iteratePrompt)→review→gate. Added `LoopResult` return type with verdict, iterations, lastMessage, and logFile. Added template context passthrough for repeat/ralph counters. Iterate step config falls back to work config; ralph falls back to gate config.

- **Created `src/executor.ts`** — Recursive executor with `execute(node, ctx)` pattern-matching on node type:
  - **work**: Single agent call with TUI, emitting on module-level `loopEvents` singleton
  - **repeat**: Sequential loop threading `lastMessage` between passes
  - **review**: Work→review→gate loop via `agentLoop`, handles compound inner nodes
  - **ralph**: Outer task loop with NEXT/DONE gate parsing
  - **composition**: Creates worktrees, runs branches in parallel with `executeBranchForComposition` (uses per-branch emitters for RaceApp TUI), then dispatches to resolver (pick/merge/compare)
  - Cleanup registry for SIGINT/SIGTERM handling

- **Refactored `src/race.ts`** — Stripped to utility library. Removed `runRace()`. Kept: `sessionId`, `createWorktree`/`removeWorktree`, `createRunnerPool`, `buildJudgePrompt`/`parseJudgeVerdict`, `confirm`/`pickOne`, `RunResult` type. Renamed user-facing "Judge" references to "Pick" in prompt constants.

- **Gutted `src/fork-join.ts`** — Replaced with a stub re-exporting `cleanupActiveExecutions` as `cleanupActiveForkJoins` for any residual references.

- **Rewired `src/cli.ts`** — New `main()` uses `parse(args)` → `resolveAgentPlan()` → `execute(ast, ctx)`. Removed all old parsers (`parseArgs`, `extractRaceMultiplier`, `parseForkJoinArgs`, `hasForkJoinSyntax`, `tripleToBranch`), old dispatch functions (`runLoop`, `cmdRace`, `cmdRaceFromMultiplier`, `cmdForkJoin`). Updated `usage()` to reflect new grammar. Updated `DEFAULT_COOK_CONFIG_JSON` with iterate/ralph steps. Updated `.cook/.gitignore` pattern to include `compare-*.md`.

- **Updated flags** — Added `--iterate`, `--iterate-agent`, `--iterate-model`, `--ralph-agent`, `--ralph-model` across parser and agent plan resolution. `resolveStepSelection` handles fallback: iterate→work, ralph→gate.

## Tricky Parts

- **TUI event wiring** — The `App` component listens on the module-level `loopEvents` singleton from `loop.ts`, while `RaceApp` takes per-run `EventEmitter` instances as props. `executeWork` needed to emit on `loopEvents` (not a local emitter) for the App TUI to work. `executeReview` uses `agentLoop` which emits on its `events` parameter — for standalone review, we pass `loopEvents`; for composition branches, we pass the per-branch emitter. This required `executeBranchForComposition` — a separate function that routes events to per-branch emitters instead of `loopEvents`.

- **Operator precedence in ternary** — Initial code had `a ?? b === 'work' ? x : y` which binds as `(a ?? (b === 'work')) ? x : y` due to `??` having higher precedence than `?:`. Fixed by restructuring the logic to use a separate variable.

- **Review wrapping compound inner nodes** — When `review` wraps a `repeat` (e.g., `cook "work" x3 review`), the inner node must execute fully first, then the review loop runs on the result. The `executeReview` function handles this by executing the inner node first, then calling `agentLoop` with the iterate prompt for subsequent passes.

- **npm install hanging** — The sandbox environment had no network access, preventing `npm install` and `tsup` from running. Code was verified through manual review and a delegated type-checking agent instead.

## Decisions Made

- **`executeBranchForComposition` function**: Rather than trying to thread emitters through `ExecutionContext`, created a separate function for running branch nodes within a composition. This keeps the main `execute` function clean and avoids adding an `emitter` field to the context that only matters for composition.

- **Kept `fork-join.ts` as a stub**: Rather than hunting for all references and removing them, created a one-line re-export stub. This is safer and simpler.

- **Review wrapping compound nodes**: For `cook "work" x3 review`, the first "work" call in the review loop uses the iterate prompt (not the original work prompt), since the inner repeat has already done the initial work. This matches the spec's intent that review-loop iterations 2+ use the iterate step.

- **Ralph gate always runs in non-TUI mode**: Ralph gate is a quick verdict check (NEXT/DONE), so it prints directly to stderr rather than rendering a full TUI. This avoids TUI lifecycle complexity for a brief agent call.

## Deviations from Plan

- **`race` command removed**: The explicit `cook race N "prompt"` command was removed from the CLI dispatch. Users should use `cook "prompt" v3` or `cook "prompt" race 3` instead, which the parser handles natively. This simplifies the CLI entry point.

- **Template variable passthrough**: The plan mentioned updating `renderTemplate` for new variables, but the existing dynamic `Function` constructor already handles arbitrary context keys — no changes needed to the render logic, just to the `LoopContext` interface.

- **No separate `src/resolvers.ts`**: The plan mentioned potentially extracting resolvers into a separate file if `executor.ts` got too long. The resolvers are substantial (~200 lines total) but `executor.ts` is well-organized with clear section headers, so they stayed inline.

## Next Steps

- Build verification once npm dependencies are available
- Run end-to-end tests with actual CLI invocations
- Verify TUI rendering for all node types (work, review, repeat, ralph, composition)
