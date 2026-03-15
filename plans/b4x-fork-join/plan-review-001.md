# Plan Review: Fork-Join Parallel Exploration

**Reviewer:** AI
**Date:** 2026-03-15
**Reviewing:** plan.md

## Summary

The plan is well-structured and the grammar design is clear. The decision to keep `vs` as the sole fork-join trigger, reuse existing primitives (`agentLoop`, `createWorktree`, `buildJudgePrompt`), and treat `x<N>` as pipeline-level meta-parallelism is sound. The implementation has landed and mostly follows the plan, with one meaningful deviation: x<N> instances run sequentially rather than in parallel due to a TUI constraint. A few gaps in the plan surface as concrete issues in the implementation worth noting before merge.

## Strengths

- Grammar is additive and backwards-compatible — no changes to single-loop or race behavior
- Three join strategies cover the main use cases (pick, synthesize, human-review)
- Reuse of `race.ts` exports keeps the diff small and avoids duplicating judge logic
- Worktree naming scheme (`inst-{i}-branch-{j}`) is systematic and collision-safe

## Concerns

### High

- None

### Medium

- **x<N> is sequential, not parallel.** The plan states x<N> runs instances via `Promise.allSettled()` in parallel. The implementation runs them in a `for` loop (fork-join.ts:525) because concurrent TUI renders conflict. The plan should either document this constraint and accept sequential behavior, or propose a TUI solution that allows true parallelism. As written, `x3` fork-join takes 3× the wall time, which may surprise users.

- **Double confirm on `summarize` cleanup.** `handleInstanceResult` asks "Remove fork-join worktrees?" and, regardless of answer, immediately calls `cleanupForkJoin` which asks the same question again (fork-join.ts:628–633). One of the two prompts is dead code. The plan's cleanup UX section doesn't specify this flow in enough detail to catch the duplication.

### Low

- **`merge` inherits branch 1's review/gate prompts.** The plan acknowledges this but frames it as a future extension. When branches intentionally have different review/gate prompts (the primary use case for fork-join), the merge loop silently uses branch 1's, which may be wrong. A note in the plan about the expected behavior when prompts differ would help reviewers evaluate whether this is acceptable for v1.

- **Plan status is still "Draft"** despite a complete implementation being on the branch. Should be updated to "Implemented" before merge.

- **`summarize` writes to `.cook/fork/` not project root.** The plan says "Write `comparison.md` to the original working directory" (Technical Design, Summarize section). The implementation writes to `.cook/fork/comparison-{session}.md`. The plan should be corrected to match the implementation (the implementation's choice is better — avoids polluting the working directory).

## Suggestions

- Resolve the x<N> parallelism gap explicitly: either update the plan to document sequential behavior as intentional, or track true parallel TUI as a follow-up.
- Fix the double-confirm bug before shipping.
- Update plan status to "Implemented".

## Recommendation

- [ ] Ready for human review
- [x] Needs revision (see concerns/suggestions above)
