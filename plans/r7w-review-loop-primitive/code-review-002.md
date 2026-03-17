# Code Review: Align Implementation to SPEC.md (Post-Fix)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/cli.ts, src/config.ts, src/template.ts, src/loop.ts, src/race.ts, src/fork-join.ts (second review after devlog-002 fixes)

## Summary

The fixes from code-review-001 addressed both high issues (SIGINT worktree cleanup and compare + second-level composition blocking) and most medium/low items. The architecture remains clean — the AST parser and recursive executor are well-structured and closely match the spec grammar. However, a new high issue emerged around template rendering correctness, a claimed fix was incompletely applied, and the SIGINT cleanup has a new timing window. The deferred items (TUI flicker, branch executor duplication) are acknowledged and reasonable to defer.

## What Works Well

- **Both original high issues resolved** — Composition cleanup now stops pools, removes worktrees, and cleans session dirs on SIGINT. Parser correctly blocks `compare` + second-level composition in both pipeline and `vs` paths.
- **Unknown tokens now error** — Descriptive error message with valid keyword list prevents silent typo swallowing.
- **Ralph pool hoisted** — Single pool above the for-loop, cleaned up in `finally`. Correct resource management.
- **Redundant fallback removed from loop.ts** — Single source of truth in `resolveStepSelection` (cli.ts:179-205).
- **structuredClone on branch nodes** — Applied at parser.ts:292 and parser.ts:476.
- **Banner shows all 5 step configs** — iterate and ralph now visible in startup output (cli.ts:411-412).
- **Parallel cleanup** — `Promise.allSettled` in `cleanupActiveExecutions` (executor.ts:66).

## Issues

### High

- [ ] **Template context key mismatch causes cache corruption** (`executor.ts:323-332`, `executor.ts:628-637`) — `executeRalph` and `executeBranchForComposition` ralph handler pass 8 keys to `renderTemplate` (missing `repeatPass`, `maxRepeatPasses`), while `executeWork`, `agentLoop`, and `executeBranchForComposition` work handler pass 10 keys. The `renderTemplate` cache (template.ts:45-54) keys on the template source string but the compiled `new Function` binds parameter names from `Object.keys(ctx)`. Two failure modes:
  1. **Ralph caches first** → function has 8 params → subsequent call from `agentLoop` passes 10 values → extra 2 ignored → `${repeatPass}` in the template resolves to the 8-param function's undeclared variable → `ReferenceError`
  2. **agentLoop caches first** → function has 10 params → call from ralph passes 8 values → `repeatPass` and `maxRepeatPasses` params are `undefined` → renders as "undefined" string in template

  Fix: ensure ALL `renderTemplate` callers pass the full `LoopContext` shape with all keys. Add `repeatPass: ctx.repeatPass, maxRepeatPasses: ctx.maxRepeatPasses` to the two ralph render calls. Alternatively, fix the cache key to include parameter names: `cachedTemplateSrc === escaped && cachedParamKey === Object.keys(ctx).join(',')`.

### Medium

- [ ] **Second-level composition branches not cloned** (`parser.ts:332`) — `Array.from({ length: count2 }, () => current)` in the second-level composition within `parsePipeline` still shares references instead of using `structuredClone(current)`. The devlog-002 states this was fixed in "all 4 occurrences" but this instance was missed. The same line in the `vs` path (parser.ts:476) correctly uses `structuredClone(ast)`.

- [ ] **SIGINT cleanup window after unregister** (`executor.ts:458-465`) — In `executeComposition`, `unregister()` (line 460) removes the SIGINT cleanup function *before* pool shutdown (lines 463-465) and the commit phase (lines 468-479). If SIGINT fires in this window, worktrees and pools won't be cleaned up. Fix: move `unregister()` to after the commit phase, or wrap the post-TUI work in the cleanup scope.

- [ ] **`parseRalphVerdict` defaults to NEXT on ambiguous output** (`executor.ts:365`) — If the model output contains neither NEXT/DONE keywords, ralph silently continues to the next task. A model that gives a malformed response (no verdict keyword) causes unbounded looping up to `maxTasks`. Fix: log a warning when no verdict keyword is found, or default to DONE (fail-safe) rather than NEXT (fail-open).

### Low

- [ ] **`fork-join.ts` is dead code** — The stub re-exports `cleanupActiveForkJoins` but nothing in the codebase imports it. The only references are in plan/devlog documentation. Safe to delete entirely.

- [ ] **`executeReview` confusing control flow** (`executor.ts:185-291`) — The `else` branch (non-work inner node, lines 197-247) returns from inside try/finally, making the code after the if-else (lines 249-291) only reachable when `inner.type === 'work'`. Correct but hard to follow. Consider restructuring as two early-return functions or explicit guard clauses.

- [ ] **Spec divergence on template variables** — `repeatPass` and `maxRepeatPasses` are passed through to `renderTemplate` (executor.ts:137-138, loop.ts:93-94) and documented in `LoopContext` (template.ts:12-13), but SPEC.md's template variables table (lines 371-381) does not list them. Either the spec should be updated to include them, or they should be removed from the implementation to avoid user confusion.

- [ ] **`executeBranchForComposition` code duplication** (~130 lines, executor.ts:525-654) — Deferred from code-review-001. Still duplicates executor logic with a different emitter. Acknowledged as requiring a larger architectural change.

## Questions

- The original code-review-001 question about `parseRalphVerdict` defaulting to NEXT remains unresolved. What is the intended behavior when the ralph gate model doesn't include a verdict keyword? The current fail-open behavior could lead to runaway loops.
- Should the `renderTemplate` cache be removed entirely? The performance benefit is negligible (template compilation is fast), and the cache introduces a subtle correctness constraint requiring all callers to pass identical key sets.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see issues above)

The high issue (template cache corruption from inconsistent context keys) should be fixed before merge — it's a latent crash triggered by any user COOK.md that uses `${repeatPass}` when ralph is active. The medium issues (missed clone, SIGINT window, silent NEXT default) are worth addressing but lower risk.
