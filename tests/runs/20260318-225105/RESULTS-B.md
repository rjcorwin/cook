# Test Results — Group B (Ralph, Composition)

Run: 2026-03-18 22:51
Cook: local build at `dist/cli.js`
Agent: claude:opus (default)
Test directory: /Users/rj/Git/todo-test-b

## Summary

| Test | Result |
|------|--------|
| Ralph basic | PASS |
| Ralph + review | PASS |
| vN + pick (v3 pick) | PASS |
| Implicit pick (v3 bare criteria) | PASS |
| race N (race 2 pick) | PASS |
| review + versions (review v3 pick) | PASS |
| vs + pick | PASS |
| vs + merge | PASS |
| vs + compare | PASS |
| vs with per-branch x3 | PASS |
| Second-level composition | FAIL |

## Detailed results

### Ralph basic — PASS

Command: `cook "Read PLAN.md. Find the first unchecked task, implement it, then mark it [x] in PLAN.md." ralph 3 "Check PLAN.md. If all 3 tasks are marked [x], say DONE. Otherwise say NEXT."`

Ralph ran 2 task iterations. After task 1, ralph gate said NEXT and advanced to task 2. After task 2, ralph gate found all 3 tasks marked [x] and said DONE. PLAN.md ended with all 3 tasks checked. The agent completed tasks 2 and 3 together in the second iteration.

### Ralph + review — PASS

Command: `cook "Read PLAN.md..." review "Review the implementation..." "DONE if..." ralph 3 "Check PLAN.md..."`

PLAN.md was reset to all unchecked before this test. Ralph ran task 1 with a full work->review->gate cycle. Review gate said DONE on iteration 1. Ralph gate then saw all 3 tasks already checked (from prior implementations still in index.html) and said DONE after 1 task. The review loop correctly ran before the ralph gate, confirming the composition of review + ralph works.

### vN + pick (v3 pick) — PASS

Command: `cook "Add a task statistics bar..." v3 pick "cleanest implementation..."`

3 worktrees created in `.cook/race/<session>/`. All 3 runs completed (~25s each). Pick agent evaluated all 3 and selected Run 3 with reasoning about code size and readability. Auto-accepted merge prompt. Merge commit landed in git log. Worktrees cleaned up.

### Implicit pick (v3 bare criteria) — PASS

Command: `cook "Style the app with a cohesive color theme" v3 "most visually appealing and consistent"`

Correctly detected resolver as "pick" (shown as `Composition -- 3 branches, resolver: pick`). 3 branches ran, pick agent selected Run 3, merged. Confirms bare criteria after vN defaults to pick.

### race N (race 2 pick) — PASS

Command: `cook "Add a loading spinner..." race 2 pick "cleanest implementation"`

`race 2` correctly behaved identically to `v2`. Two worktrees created, both completed. Pick agent selected Run 2 with detailed reasoning. Merged successfully.

### review + versions (review v3 pick) — PASS

Command: `cook "Add form validation with error messages" review v3 pick "most robust validation"`

3 parallel branches, each running a full review loop (work -> review -> gate). All 3 gates said DONE on iteration 1. Status bars showed each run progressing through review and gate phases. Pick agent selected Run 1. Merged successfully.

### vs + pick — PASS

Command: `cook "Add task categories using colored tags" vs "Add task categories using a dropdown selector" pick "more intuitive UX, less code"`

Two separate worktrees with different task prompts. Both completed. Pick agent compared the two different approaches (colored tags vs dropdown) and selected Run 2 (dropdown) with reasoning about code size, UX, and consistency. Merged successfully.

### vs + merge — PASS

Command: `cook "Add an undo button..." vs "Add an undo/redo stack..." merge "take the best parts of both..."`

Two branches ran with different approaches. Merge agent created a separate merge worktree (`cook-...-merge`) and synthesized both approaches. Status bar showed "Merge synthesis" phase. Result merged into current branch successfully.

### vs + compare — PASS

Command: `cook "Implement task export as JSON" vs "Implement task export as plain text" compare`

Two branches ran. Compare agent produced a detailed comparison document with strengths/weaknesses of each approach, a comparison table, and a recommendation. Comparison written to `.cook/compare-20260318-234424-q8x3.md`. No branch was merged (correct behavior for compare). Worktrees preserved for inspection.

### vs with per-branch x3 — PASS

Command: `cook "Add task sorting by name" x3 vs "Add task sorting by date" x3 pick "better UX"`

Two branches, each configured with x3 repeat (status bar showed `work 1/3`). Both completed. Pick agent selected Run 1. Merged successfully. Per-branch loop operators correctly compose with `vs`.

### Second-level composition — FAIL

Command: `cook "Add a progress bar" vs "Add a completion percentage display" pick "more intuitive" v2 pick "most polished"`

Three nested sessions were created (outer session ayfi, inner sessions jych and 5vxy). Each inner `vs` ran two branches and resolved correctly -- inner pick agents selected winners. However, the outer-level pick agent selected Run 1 and prompted "Apply Run 1 to current branch?" but no merge commit landed. This is a known issue (Bug 4 in ISSUES.md): the outer merge fails silently when nested worktree results are passed up to the outer composition layer.

## Bugs found

| # | Bug | Severity | Location | Status |
|---|-----|----------|----------|--------|
| 4 | Second-level composition outer merge fails silently | Medium | Composition executor / worktree merge path | Known (ISSUES.md) |

No new bugs found. All tests except second-level composition (known Bug 4) passed.
