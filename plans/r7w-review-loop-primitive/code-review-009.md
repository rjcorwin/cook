# Code Review: Align Implementation to SPEC.md (Review 9)

**Reviewer:** AI
**Date:** 2026-03-17
**Reviewing:** src/parser.ts, src/executor.ts, src/config.ts, src/template.ts, src/loop.ts, src/cli.ts, src/race.ts (fresh independent review against plan.md)

## Summary

Fresh review of the complete implementation after 8 prior review/fix cycles. All 10 plan steps are implemented and the code is structurally sound. The parser handles the full spec grammar, the recursive executor dispatches cleanly on AST node types, and all safety mechanisms (SIGINT cleanup, ralph fail-safe, convergence check, template cache keying, compare guard) are confirmed in place. All 4 prior high and 9 prior medium issues are resolved. One new medium issue found: when `review` wraps a compound inner node, the review loop starts with no context from the inner execution. Seven prior low-severity items persist, and one new low found (dead ralph fallback). Overall the implementation is in good shape.

## What Works Well

- **AST design maps directly to spec grammar** — The 5-node union type (parser.ts:9-14) with recursive `inner` fields makes the left-to-right composition of operators natural. `structuredClone` is correctly used at all three branch-copy sites (parser.ts:292, 332, 476).

- **Parser handles the full grammar** — Positional duck-typing, implicit review mode, explicit `review` keyword, `xN`/`repeat N`, `vN`/`race N`, `vs` branching, `ralph`, all three resolvers, second-level composition, and `compare` + second-level guard (parser.ts:314, 457-458). Unknown tokens throw descriptive errors (parser.ts:363).

- **Executor dispatch is clean and exhaustive** (executor.ts:72-85) — `switch` on `node.type` covers all 5 cases with no default fallthrough.

- **Ralph safety mechanisms all confirmed**:
  - Convergence check at both locations (executor.ts:321-324, 638-641) stops ralph when inner loop hits MAX_ITERATIONS.
  - `parseRalphVerdict` defaults to DONE (executor.ts:373-374), preventing unbounded looping.
  - Single pool hoisted above the ralph loop (executor.ts:305), cleaned up in `finally`.

- **SIGINT cleanup lifecycle correct** — `registerCleanup` at executor.ts:443-452 stops pools, removes worktrees, cleans session dir. `unregister()` at executor.ts:490 is placed after pool shutdown and commits.

- **Template cache correctness** — `paramKey` (template.ts:44-48) prevents cache corruption when callers supply different context shapes.

- **Config properly extended** — `StepName` includes `iterate` and `ralph` (config.ts:8). `loadConfig` parses both. `resolveStepSelection` in cli.ts:179-205 handles iterate→work and ralph→gate fallbacks at config resolution time.

- **Loop returns structured result** — `LoopResult` (loop.ts:28-33) with verdict/iterations/lastMessage/logFile lets the executor make informed decisions about ralph continuation.

- **Resolver error paths all clean up worktrees** — Confirmed for pick (executor.ts:707-713, 723), merge (executor.ts:810-814), and compare (executor.ts:904-908).

- **`removeWorktree` is self-guarding** — Both `execSync` calls wrapped in try/catch (race.ts:51-57), so cleanup loops in executor.ts never throw.

## Issues

### High

(None)

### Medium

- [ ] **Review loop loses inner node context when wrapping compound nodes** (executor.ts:199-232, also executeBranchForComposition:586-605): When `review` wraps a non-work inner node (e.g., `cook "work" x3 review` — repeat 3 times then review), the inner node executes first (line 199), producing output and a session log. But the subsequent `agentLoop` call (line 232) starts with `lastMessage = ''` (loop.ts:58) and creates a fresh session log (loop.ts:55). The review agent has no explicit context about the inner execution — `${lastMessage}` renders empty in the template, and the session log doesn't contain the inner node's work. The iterate prompt defaults to generic text ("Continue working on the task based on review feedback") with no reference to what was done. The agent's only context is the filesystem state.

  **Impact**: For `cook "work" x3 review`, the review loop's first iteration runs the iterate prompt with empty context, then reviews that output — not the actual work done by the repeat. The review is effectively blind to the inner execution's output.

  **Suggested fix**: Add an optional `initialLastMessage` field to `LoopConfig`. Pass `innerResult.lastMessage` through so `agentLoop` starts with context from the inner execution. Also consider concatenating or referencing the inner node's log file path so the review agent can read it.

### Low

- [ ] **Dead ralph fallback in executor** (executor.ts:302, 644): `ctx.stepConfig.ralph?.agent` is always truthy because `resolveStepSelection` (cli.ts:186-204) always resolves a full `StepSelection` with a non-empty `agent` field. The ternary fallback to `ctx.stepConfig.gate` is unreachable dead code. The actual ralph→gate fallback happens correctly at config resolution time (cli.ts:190-191). Misleading but harmless — suggest removing the dead branch.

- [ ] **Bare resolver keywords silently consumed** (parser.ts:355-359): `cook "work" pick "criteria"` drops `pick` then errors on `criteria` as unknown token. Should error: "pick/merge/compare requires a preceding vN or vs." Carried from code-review-004.

- [ ] **`executeBranchForComposition` duplicates ~130 lines of executor logic** (executor.ts:536-674): Reimplements work/review/repeat/ralph dispatch for composition branches with per-branch emitter and shared pool. Future changes to executor logic must be mirrored in both locations. Carried from code-review-001.

- [ ] **TUI flicker during repeat** (executor.ts:106-115): `executeWork` mounts/unmounts the Ink App per call. Inside `executeRepeat`, this produces N mount/unmount cycles. Carried from code-review-001.

- [ ] **`executeReview` confusing control flow** (executor.ts:185-291): When `node.inner.type !== 'work'`, the else block returns from within lines 237-242, making the "simple case" code at lines 249-291 appear unreachable on first read. A guard clause would be clearer. Carried from code-review-002.

- [ ] **`resolveCompare` error path auto-cleans without user prompt** (executor.ts:904-908, 930-941): On compare error, worktrees are silently removed. On user-picked merge failure, worktrees are still cleaned up, leaving no branches for conflict resolution. Carried from code-review-005.

- [ ] **No TypeScript compilation verified** — None of the review cycles ran `tsc`. Potential type errors (e.g., `Function` type in template.ts:37,47) could surface at build time. Carried from code-review-001.

- [ ] **`applyAndCleanup` merge failure skips cleanup** (executor.ts:963-966): When `git merge` fails, the function returns without calling `cleanupWorktrees` and doesn't tell the user worktree branch names or paths for manual resolution. Carried from code-review-006.

## Verification of Prior Fixes

All 4 high issues from prior reviews confirmed resolved:
1. **SIGINT worktree cleanup** (code-review-001) — `registerCleanup` at executor.ts:443-452
2. **Compare + second-level composition guard** (code-review-001) — parser.ts:314, 457-458
3. **Template cache corruption** (code-review-002) — template.ts:44-48 `paramKey` check
4. **Ralph fail-safe** (code-review-002) — executor.ts:373-374 defaults to DONE

All 9 medium issues from prior reviews confirmed resolved:
1. Unknown tokens error (code-review-001) → parser.ts:363
2. Ralph pool per iteration (code-review-001) → single pool at executor.ts:305
3. Redundant fallback logic (code-review-001) → removed from loop.ts
4. Missed `structuredClone` (code-review-002) → parser.ts:332
5. SIGINT cleanup window (code-review-002) → `unregister()` at executor.ts:490
6. `parseRalphVerdict` fail-open (code-review-002) → defaults to DONE at executor.ts:374
7. Worktree leak on resolver error paths (code-review-004) → all three resolvers clean up
8. Merge resolver missing template context (code-review-004) → executor.ts:796-799
9. Ralph inner loop convergence check (code-review-006) → executor.ts:321-324, 638-641

## Questions

None.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see medium issue: review loop context loss for compound inner nodes)
