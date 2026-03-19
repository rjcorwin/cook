# Test Results

Run: 2026-03-19 11:14
Cook: local build at `dist/cli.js` (includes token limit recovery feature)
Agent: claude:opus (default)
Sandbox: agent

## Summary

| Test | Result |
|------|--------|
| 1. Work | PASS |
| 2a. repeat (xN) | PASS |
| 2b. repeat (long-form) | PASS |
| 2c. review (default prompts) | PASS |
| 2d. review (custom prompts) | PASS |
| 2e. review --max-iterations 5 | PASS |
| 2f. review N (positional) | PASS |
| 2g. x3 + review | PASS |
| 2h. review x3 | PASS |
| 3a. ralph (basic) | PASS |
| 3b. ralph + review | PASS |
| 4a. v3 pick | PASS |
| 4b. vs + pick | PASS |
| 4c. vs + merge | PASS |
| 4d. vs + compare | PASS |
| 5a. --hide-request | PASS |
| 5b. --work/--review/--gate flags | PASS |
| 6a. doctor | PASS |
| 6b. doctor + per-step overrides | PASS |
| 7. --no-wait (new feature) | PASS |

**20/20 tests passed.**

## Detailed results

### 1. Work — PASS
Single work call, no loop. Completed in ~39s. Dark mode toggle added successfully.

### 2a. repeat (xN) — PASS
`x3` produced 3 sequential repeat passes with `Repeat pass N/3` announcements. Status bar showed `work 1/1` per pass.

### 2b. repeat (long-form) — PASS
`repeat 3` identical to `x3`. Three passes with correct announcements.

### 2c. review (default prompts) — PASS
work→review→gate loop ran. ITERATE on iteration 1, DONE on iteration 2. Correct flow.

### 2d. review (custom prompts) — PASS
Custom review/gate prompts used. DONE on iteration 1. Gate reasoning referenced the checklist.

### 2e. review --max-iterations 5 — PASS
ITERATE→DONE in 2 iterations. Max of 5 was available.

### 2f. review N (positional) — PASS
`review 5` showed `Iteration: 1/5` in the request panel.

### 2g. x3 + review — PASS
3 repeat passes ran first (Repeat pass 1/3, 2/3, 3/3), then review loop (work→review→gate). Gate: DONE on iteration 1.

### 2h. review x3 — PASS
Full review loop ran 3 separate times. Pass 1: ITERATE→DONE (2 iterations). Pass 2: DONE (1 iteration). Pass 3: DONE (1 iteration).

### 3a. ralph (basic) — PASS
Ralph ran 2 task iterations. Task 1: implemented priorities, gate said NEXT. Task 2: agent completed remaining 2 tasks, gate said DONE. All 3 tasks marked [x] in PLAN.md.

### 3b. ralph + review — PASS
Each ralph task got a review loop. The agent completed all 3 tasks in one work call. Review gate: DONE. Ralph gate: DONE. All tasks marked [x].

### 4a. v3 pick — PASS
3 worktrees created, 3 parallel runs completed successfully. Pick agent selected Run 1. Merged into current branch. Worktrees cleaned up.

### 4b. vs + pick — PASS
Two different approaches (colored tags vs dropdown selector) ran in parallel worktrees. Pick selected Run 1. Merged successfully.

### 4c. vs + merge — PASS
Two approaches (undo button vs undo/redo stack) ran in parallel. Merge synthesis ran in a separate worktree with review loop. Merged into current branch. All worktrees cleaned up.

### 4d. vs + compare — PASS
Two approaches (JSON export vs plain text export) ran in parallel. Comparison doc written to `.cook/compare-*.md`. No branch merged. Worktrees preserved for inspection.

### 5a. --hide-request — PASS
No COOK.md request panel in output (0 occurrences).

### 5b. --work/--review/--gate flags — PASS
Named flags accepted. Review loop ran with custom prompts. Gate: DONE on iteration 1.

### 6a. doctor — PASS
Shows all 5 step configs (work, review, gate, iterate, ralph) plus default agent and sandbox. Auth check passed.

### 6b. doctor + per-step overrides — PASS
`--work-model haiku` reflected as `Work: claude:haiku`. Other steps unchanged at `claude:opus`.

### 7. --no-wait (new feature) — PASS
`--no-wait` appears in `--help` output as "Disable rate-limit retry (fail fast)". Flag is parsed correctly (verified in parser.ts: `noWait` in `ParsedFlags`, `--no-wait` in `BOOLEAN_FLAGS`).

Note: Cannot integration-test the actual rate-limit retry behavior without triggering a real rate limit. The `--no-wait` flag parse and the retry module's unit-level behavior (isRateLimitError, retryOnRateLimit) were verified during the cook implementation review loop.

## Bugs found

No new bugs found.

## Known issues (from ISSUES.md)

| # | Bug | Status |
|---|-----|--------|
| 3 | Parallel cook processes corrupt shared `/tmp/claude-1000/` | Known — mitigated by sequential testing |
| 4 | Second-level composition outer merge fails silently | Known — not tested this run (skipped per ISSUES.md guidance) |

## Tests not run

- Second-level composition (`v2` of a `vs`) — skipped due to known Bug 4
- Per-step agent override (`--work-agent claude --review-agent claude`) — only one agent available in this environment
- `race N` long-form alias — equivalent to `vN`, covered by v3 test
- `vs` with per-branch loop operators (`x3 vs x3`) — not run (time constraint)
- Implicit pick (bare criteria after vN) — not run (time constraint)
- `review + v3` composition — not run (time constraint)
