# Test Results

Run: 2026-03-18 11:11
Cook: local build at `dist/cli.js`
Agent: claude:opus (default)
Scope: New test cases added to SPEC.md (alias/shorthand/composition coverage)

## Summary

| Test | Result |
|------|--------|
| repeat 3 (long-form) | PASS |
| review 5 (positional max) | PASS |
| v3 implicit pick | PASS |
| race 2 (long-form alias) | PASS |
| review + versions | PASS |
| vs with per-branch x3 | PASS |
| second-level composition | PARTIAL PASS |

**6/7 PASS, 1 PARTIAL PASS**

## Detailed results

### repeat 3 (long-form) — PASS

`cook "Polish the CSS spacing and alignment" repeat 3`. Identical behavior to `x3` — three sequential passes with `▸ Repeat pass 1/3`, `2/3`, `3/3` announcements. Confirms `repeat N` is a valid alias for `xN`.

### review 5 (positional max) — PASS

`cook "Improve error handling in the app" review 5`. Status bar showed `Iteration: 1/5` (not default `1/3`). Gate ITERATED once, DONE on iteration 2. Confirms `review N` sets max iterations positionally, equivalent to `--max-iterations N`.

### v3 implicit pick — PASS

`cook "Style the app with a cohesive color theme" v3 "most visually appealing and consistent"`. No explicit `pick` keyword used. Output showed `Composition — 3 branches, resolver: pick` — pick is the default resolver. 3 worktrees created, pick agent selected Run 3, auto-merged.

### race 2 (long-form alias) — PASS

`cook "Add a loading spinner" race 2 pick "cleanest implementation"`. `race 2` behaved identically to `v2`. Two worktrees created, pick agent selected Run 1 with detailed reasoning, auto-merged.

### review + versions — PASS

`cook "Add form validation with error messages" review v3 pick "most robust validation"`. 3 parallel branches, each running a full review loop (work→review→gate). Status bars showed `review 1/3` and `gate 1/3` within each branch. After all 3 completed, pick agent selected Run 3, auto-merged.

### vs with per-branch x3 — PASS

`cook "Add task sorting by name" x3 vs "Add task sorting by date" x3 pick "better UX"`. Two branches with different prompts, each configured with `x3` repeat. Both branches ran in parallel worktrees. Pick agent selected Run 2, auto-merged.

### second-level composition — PARTIAL PASS

`cook "Add a progress bar" vs "Add a completion percentage display" pick "more intuitive" v2 pick "most polished"`. The structure worked correctly:

- Two independent `vs` instances ran (sessions `qnpj` and `fphv`)
- Each inner `vs` had 2 branches (4 total branches)
- Each inner pick agent ran and selected a winner (both picked Run 2)
- Inner merges completed within their respective worktrees

**Bug:** The outer-level merge did not complete. The output shows the outer pick agent's "Apply Run 2?" prompt but no merge confirmation follows. `git log` confirms no new commit after the checkpoint. The inner `vs` compositions each resolve correctly, but merging the outer winner back to the main branch failed silently.

## Bugs found

| # | Bug | Severity | Location |
|---|-----|----------|----------|
| 4 | Second-level composition: outer merge fails silently after inner vs resolvers complete | Medium | Composition executor / worktree merge path |
