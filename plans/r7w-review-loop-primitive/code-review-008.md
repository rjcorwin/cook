# Code Review: Align Implementation to SPEC.md

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/config.ts, src/template.ts, src/loop.ts, src/cli.ts, src/race.ts

## Summary

Fresh review of the full implementation after 7 prior review/fix cycles. The codebase is in good shape. All 10 plan steps are implemented: unified parser producing a recursive AST, recursive executor with work/repeat/review/ralph/composition node types, iterate step, ralph outer loop, resolver rename, template variables, and CLI rewiring. All 4 prior high issues and 9 prior medium issues have been confirmed resolved. No new high or medium issues found. Seven low-severity items remain from prior reviews — all are non-blocking and suitable for follow-up.

## What Works Well

- **Clean AST design** — The `Node` union type (parser.ts:9-14) is well-structured and maps directly to the spec grammar. The recursive executor pattern-matches on it cleanly (executor.ts:72-85).
- **Correct left-to-right token scanning** — Parser handles positional prompt duck-typing, implicit review mode, bare numbers, and all keyword combinations per spec.
- **Template cache keyed on param names** — Cache at template.ts:44-57 includes `paramKey` (the sorted context key set) to prevent corruption when callers supply different context shapes. This was a prior high that's now properly fixed.
- **SIGINT cleanup** — Composition cleanup handler (executor.ts:443-452) stops pools, removes worktrees, and cleans session dirs. Unregister happens after commit phase (executor.ts:490), closing the prior cleanup window.
- **Ralph convergence check** — Both standalone ralph (executor.ts:321-324) and composition ralph (executor.ts:638-641) check `result.verdict === 'MAX_ITERATIONS'` before running the gate, per research Q10.
- **Ralph fail-safe** — `parseRalphVerdict` defaults to DONE (executor.ts:373-374), preventing unbounded looping on ambiguous model output.
- **Compare guard** — Parser blocks second-level composition after `compare` (parser.ts:314, 457-458).
- **Resolver error-path cleanup** — All three resolvers (pick, merge, compare) now clean up worktrees on error paths.
- **Config and template integration** — `iterate` and `ralph` steps properly added to config.ts, template.ts `LoopContext`, and loop.ts `LoopConfig`. All callers pass 10 context keys consistently.

## Issues

### High

(none)

### Medium

(none — all 9 prior mediums confirmed resolved)

### Low

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-360) — `pick`/`merge`/`compare` without a preceding `vN`/`race` are silently skipped. `cook "A" pick "criteria"` drops `pick` then errors on `criteria` as unknown token, which is confusing. Should error: "pick/merge/compare requires a preceding v<N> or race."
- [ ] **`executeBranchForComposition` duplicates executor logic** (executor.ts:536-674) — ~138 lines duplicating work/review/repeat/ralph handlers to use a branch emitter instead of global `loopEvents`. Could drift from the main executor. Consider refactoring to pass emitter as part of `ExecutionContext`.
- [ ] **TUI flicker during repeat** — Each `executeWork` call mounts/unmounts its own Ink `App` (executor.ts:106-115). In `executeRepeat`, this causes N mount/unmount cycles. Consider hoisting TUI mount to repeat level.
- [ ] **Confusing `executeReview` control flow** (executor.ts:185-291) — The `else` block (non-work inner) returns early; the "Simple case" code at line 249+ is only reachable for work inners. The split makes the function harder to read than necessary. A guard clause (`if (node.inner.type !== 'work') { ... return }`) followed by the main path would be clearer.
- [ ] **Compare resolver doesn't show worktree paths on error** (executor.ts:900-908) — Error path logs "Compare failed" but doesn't tell the user where the worktrees were. Contrast with pick (executor.ts:708-710) which shows `git diff` hints.
- [ ] **No `tsc` compilation verified** — Implementation hasn't been checked with TypeScript compiler. Potential type errors (e.g., the `Function` type in template.ts:37,47) could surface at build time.
- [ ] **`applyAndCleanup` merge failure skips cleanup** (executor.ts:960-967) — If `git merge` fails, the function returns without calling `cleanupWorktrees` and doesn't tell the user the worktree paths. User is left with orphaned worktrees and only knows to run `git status`.

## Questions

(none — all prior questions resolved)

## Recommendation

[x] Ready for human review
[ ] Needs revision (see issues above)
