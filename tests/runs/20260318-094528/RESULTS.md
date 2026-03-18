# Test Results

Run: 2026-03-18 09:45 (initial), 2026-03-18 10:08 (re-run after VM restart)
Cook: local build at `dist/cli.js`
Agent: claude:opus (default)

## Summary

| Test | Result |
|------|--------|
| 1. Work | PASS |
| 2a. repeat (xN) | PASS |
| 2b. review (default) | PASS |
| 2c. review (custom prompts) | PASS |
| 2d. review (max-iterations) | PASS |
| 2e. xN + review | PASS |
| 2f. review x3 | PASS |
| 3a. Ralph basic | PASS |
| 3b. Ralph + review | PASS |
| 4a. vN + pick | PASS (confirm fix verified) |
| 4b. vs + pick | PASS |
| 4c. vs + merge | PASS |
| 4d. vs + compare | PASS |
| 5a. Per-step agent override | PASS |
| 5b. --hide-request | PASS |
| 5c. --work/--review/--gate | PASS |
| 6a. Doctor (basic) | PASS |
| 6b. Doctor (overrides) | PASS |

**18/18 PASS**

## Detailed results

### 1. Work — PASS

Plain work call with no loop. `cook init` succeeded. Initial todo app created as `index.html` (116 lines). "Add dark mode toggle" ran as a single work iteration — `index.html` grew to 150 lines. No review, gate, or iterate steps executed. One-shot behavior confirmed.

### 2a. repeat (xN) — PASS

`cook "Improve the visual design" x3`. All 3 repeat passes ran sequentially with `▸ Repeat pass 1/3`, `2/3`, `3/3` announcements. Each pass showed `work 1/1` inner iteration. Design progressively refined across passes.

### 2b. review (default prompts) — PASS

`cook "Add keyboard shortcuts" review`. Work→review→gate cycle ran. Gate said DONE on iteration 1. Default review and gate prompts used (High severity check).

### 2c. review (custom prompts) — PASS

Custom review prompt checked 3 specific criteria (date input, display, no JS errors). Custom gate prompt used the checklist. Gate said DONE referencing "all 3 checks pass".

### 2d. review (max-iterations) — PASS

`--max-iterations 5` correctly set iteration counter to `1/5` (not default `1/3`). Gate converged on first pass with DONE.

### 2e. xN + review — PASS

`x3 review` correctly ordered: 3 repeat passes first (each with `work 1/1`), then review loop (work→review→gate). Gate said DONE.

### 2f. review x3 — PASS

`review x3` ran 3 separate full review loops. Each loop had its own work→review→gate cycle. Pass 1 ITERATED to a second work iteration before DONE — confirms the iterate path works. Passes 2 and 3 completed on first iteration.

### 3a. Ralph basic — PASS

PLAN.md created with 3 unchecked tasks. `ralph 3` ran all 3 task iterations. Ralph gate correctly evaluated: NEXT (task 1), NEXT (task 2), DONE (task 3 — all marked [x]). PLAN.md final state: all `[x]`. **Bug 1 (SIGABRT from initial run) did NOT reproduce** — was likely collateral from the EIO storm.

### 3b. Ralph + review — PASS

PLAN.md reset to unchecked. `ralph 3` with `review` gate per task. Work agent implemented all 3 tasks efficiently in one pass and marked all [x]. Review gate said DONE. Ralph gate correctly saw all tasks complete and said DONE. Mechanics (work→review→gate within ralph, ralph gate evaluation) all functional.

### 4a. vN + pick — PASS (confirm fix verified)

After fixing `confirm()` and `pickOne()` in `race.ts` to handle EOF via readline `close` event, `v3 pick` works end-to-end: 3 worktrees created, 3 parallel runs completed (~26s), pick agent selected winner with reasoning, auto-accepted on EOF, merge commit landed in git log. **Bug 1 is fixed.**

### 4b. vs + pick — PASS

`cook "colored tags" vs "dropdown selector" pick`. Two worktrees, two different implementations. Pick agent selected Run 2 (dropdown). Auto-merged, commit landed.

### 4c. vs + merge — PASS

`cook "undo button" vs "undo/redo stack" merge`. Two worktrees ran. Merge agent synthesized both approaches. Merged commit landed in git log.

### 4d. vs + compare — PASS

`cook "export as JSON" vs "export as plain text" compare`. Two worktrees ran. Comparison document written to `.cook/compare-20260318-104107-e6j8.md` with detailed analysis of both approaches. No branch merged (correct behavior). Worktrees preserved for inspection.

### 5a. Per-step agent override — PASS

`--work-agent claude --review-agent claude` accepted. Full work/review/gate loop executed. Gate returned "DONE" after iteration 1/3. Agent assignments confirmed in output: Work: claude:opus, Review: claude:opus.

### 5b. --hide-request — PASS

`--hide-request` flag correctly hid the request panel from TUI output. Zero instances of `### Task` in output (normally shown in the COOK.md template). Review loop completed normally with DONE.

### 5c. --work/--review/--gate flags — PASS

Custom prompts via `--work`, `--review`, `--gate` flags all accepted. Work→review→gate cycle ran with custom gate prompt ("DONE if the button works correctly, else ITERATE"). Gate returned DONE.

### 6a. Doctor (basic) — PASS

Shows all 5 step configs (Work, Review, Gate, Iterate, Ralph) all set to `claude:opus`. Default agent `claude:opus`. Sandbox modes `none`. Auth check passes — CLI found on PATH, credentials found.

### 6b. Doctor (overrides) — PASS

`--work-model haiku` correctly reflected as `claude:haiku` in Work step. Gate remains `claude:opus`. Review, Iterate, Ralph unchanged. Override mechanism works.

## Bugs found and resolved

| # | Bug | Status | Resolution |
|---|-----|--------|------------|
| 1 | `confirm()` / `pickOne()` in race.ts hang on EOF (non-TTY) | **FIXED** | Added readline `close` event handler to auto-accept/auto-select on EOF. Verified in test 4a. |
| 2 | Ralph SIGABRT (exit 134) | **NOT REPRODUCED** | Did not reproduce in clean environment. Likely collateral from EIO filesystem corruption in initial parallel run. |
| 3 | Parallel cook processes corrupt `/tmp/claude-1000/` | **KNOWN** | Infrastructure issue — Claude Code instances share temp dir. Mitigation: run tests sequentially, use non-/tmp directories. |

## Notes

Initial run (09:45) had 13/18 tests blocked by EIO errors from running 5 parallel agents. After VM restart and cleanup, all 13 tests re-ran successfully in sequential mode. The confirm() fix in `src/race.ts` was built and verified — composition commands now work end-to-end in non-interactive environments.
