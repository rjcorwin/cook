# Devlog: Fixes from Code Review 002

**Date:** 2026-03-17
**Implementing:** Fixes identified in code-review-002.md

## What Was Done

### High (1/1 fixed)
- **Template cache corruption from inconsistent context keys** — Two fixes applied:
  1. Added `repeatPass` and `maxRepeatPasses` to both ralph `renderTemplate` calls (executor.ts lines ~323 and ~628) so all callers now pass the full 10-key `LoopContext`.
  2. Made the template cache key include the parameter name list (`cachedParamKey`) in addition to the template source string. Even if a future caller passes a different key set, the cache will correctly recompile instead of serving a mismatched function. This is a defense-in-depth fix — the root cause (missing keys) is also fixed.

### Medium (3/3 fixed)
- **Missed `structuredClone` at parser.ts:332** — Second-level composition branches in `parsePipeline` now use `structuredClone(current)` instead of sharing references. All 4 occurrences across both `parsePipeline` and `vs` paths are now correctly cloned.
- **SIGINT cleanup window in `executeComposition`** — Moved `unregister()` call from before pool shutdown/commits to after them. The SIGINT cleanup handler now stays active through pool shutdown and the commit phase, closing the window where SIGINT could leave orphaned worktrees.
- **`parseRalphVerdict` defaults to DONE on ambiguous output** — Changed from fail-open (NEXT) to fail-safe (DONE) when no verdict keyword is found. Logs a warning so the user knows the model output was ambiguous. Prevents unbounded looping from malformed gate responses.

### Low (1 fixed)
- **Deleted dead `fork-join.ts`** — Nothing in the codebase imports it. Removed entirely.

## Tricky Parts
- The template cache fix required understanding the `new Function()` compilation model: parameter names are bound at compile time from `Object.keys(ctx)`, so the cache must invalidate when keys change, not just when the template source changes.

## Decisions Made
- Chose fail-safe (DONE) over fail-open (NEXT) for ambiguous ralph verdicts. Rationale: an unbounded loop from a malformed response is worse than stopping early. The user gets a clear warning and can re-run.
- Kept the template cache (with the improved key) rather than removing it entirely. The cache adds minimal complexity now that the key is correct, and avoids `new Function()` compilation on every render.

## Deviations from Plan
- None. All fixes are direct responses to code-review-002 findings.

## Next Steps
- Code review of these fixes (code-review-003.md)
