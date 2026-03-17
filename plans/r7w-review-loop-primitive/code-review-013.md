# Code Review: Align Implementation to SPEC.md (Review 13)

**Reviewer:** AI (fresh session)
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/loop.ts, src/config.ts, src/template.ts, src/cli.ts, src/race.ts

## Summary

Independent review of the full implementation after 12 prior review cycles. The implementation correctly matches plan.md: the unified parser produces a recursive AST from all spec grammar forms, the executor pattern-matches on node types with proper resource cleanup, and `agentLoop` handles work/review/gate/iterate with structured `LoopResult` returns. All 4 prior high issues and 10 prior medium issues are confirmed resolved. One new medium issue found: partial worktree creation failure in `executeComposition` leaks already-created worktrees because the cleanup handler is registered after the creation loop. Nine low-severity items remain from prior reviews.

## What Works Well

- **Parser grammar is complete** — Left-to-right token scanning with bottom-up tree construction handles all spec forms: implicit review via positional duck-typing (parser.ts:144-182), explicit keywords, `vs` branch splitting (parser.ts:386-498), resolver dispatch, second-level composition, and descriptive validation errors (parser.ts:129, 136, 202, 260, 363).

- **Executor recursion is clean** — `execute()` dispatch (executor.ts:72-85) delegates to typed handlers. Context threading via spread (`{ ...ctx, repeatPass: pass }`) keeps state explicit. Resource cleanup uses `registerCleanup`/`unregister` consistently.

- **All 4 prior highs confirmed resolved:**
  1. SIGINT worktree cleanup — `registerCleanup` at executor.ts:60-63, composition cleanup at executor.ts:444-453
  2. Compare + second-level composition guard — parser.ts:314, 458
  3. Template cache corruption — `paramKey` cache key at template.ts:44-48
  4. Missed `structuredClone` — parser.ts:292, 332, 476

- **All 10 prior mediums confirmed resolved:**
  1. Unknown tokens throw descriptive error (parser.ts:363)
  2. Ralph pool hoisted above loop (executor.ts:306)
  3. Redundant fallback logic removed from loop.ts
  4. `structuredClone` at parser.ts:332 fixed
  5. `unregister()` deferred to after pool shutdown and commits (executor.ts:491)
  6. `parseRalphVerdict` defaults to DONE (executor.ts:374)
  7. Resolver error paths clean up worktrees (resolvePick:708-715, resolveMerge:812-817, resolveCompare:910-914)
  8. Merge resolver passes all 4 template context fields (executor.ts:798-801)
  9. Ralph inner loop convergence check (executor.ts:322-324, 640-641)
  10. Review loop context loss — `initialLastMessage` at loop.ts:22,60; executor.ts:226,600

- **Gate-11 fix confirmed:** `resolveMerge` (executor.ts:841-848) and `resolveCompare` (executor.ts:942-946) return early on merge conflict, preserving branches.

- **Config resolution is correct** — cli.ts:179-205 handles iterate->work and ralph->gate fallbacks at resolution time.

- **`agentLoop` is well-factored** — Work/iterate step switching (loop.ts:65-66), full template context (loop.ts:86-97), structured `LoopResult` return.

## Issues

### High

(None)

### Medium

- [ ] **Partial worktree creation failure leaks worktrees** (executor.ts:411-418, 444) — The worktree creation loop at lines 411-418 creates N worktrees sequentially before the cleanup handler is registered at line 444. If worktree K+1 fails (e.g., `git worktree add` errors due to disk full, permissions, or stale branch from a prior crash), worktrees 1..K are orphaned — no cleanup handler covers them, and SIGINT cleanup won't find them in `activeCleanups`. Fix: wrap the creation loop in try/catch that removes already-created worktrees on failure, or incrementally register cleanup after each worktree:

  ```typescript
  const worktrees: { worktreePath: string; branchName: string }[] = []
  try {
    for (let i = 1; i <= n; i++) {
      const wt = createWorktree(projectRoot, wtPath, branch)
      worktrees.push(wt)
    }
  } catch (err) {
    for (const wt of worktrees) {
      try { removeWorktree(projectRoot, wt.worktreePath, wt.branchName) } catch {}
    }
    cleanupSessionDir(projectRoot, session)
    throw err
  }
  ```

### Low

- [ ] **Compound review iteration 1 uses work step config** (executor.ts:203, 219): When `review` wraps a compound inner node, iteration 1 in `agentLoop` selects `workStepName = 'work'` (loop.ts:65), using the work step's agent/model instead of iterate. Only matters when work and iterate use different agents.

- [ ] **Dead ralph fallback** (executor.ts:303): `ctx.stepConfig.ralph?.agent` is always truthy after `resolveStepSelection` (cli.ts:186-204), making the gate fallback unreachable.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` silently, then errors on `"criteria"` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs."

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:537-676): Reimplements work/review/repeat/ralph dispatch for composition branches. Changes to executor logic must be mirrored in both locations.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): The compound inner node path (else at line 196) returns inside a try/finally. The simple work path at line 250 appears unreachable on first read. A guard clause would clarify.

- [ ] **`resolveCompare` error path auto-cleans without user notice** (executor.ts:908-914): On compare agent failure, worktrees are removed without showing branch names. Unlike pick (executor.ts:710-712), which shows diff commands for manual comparison.

- [ ] **No TypeScript compilation verified**: None of the 13 review cycles ran `tsc`. Type annotations like `Function` (template.ts:37, 47) and non-null assertions (executor.ts:966) are not validated.

- [ ] **`applyAndCleanup` merge failure doesn't show worktree paths** (executor.ts:973-976): On `git merge` failure, returns without calling `cleanupWorktrees` and doesn't log which worktrees/branches to inspect.

## Questions

None.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see medium issue above)

The partial worktree creation failure is a real resource leak scenario — if `git worktree add` fails midway through composition setup, already-created worktrees are orphaned with no cleanup path. The fix is a straightforward try/catch around the creation loop. The 9 low items are genuine but non-blocking.
