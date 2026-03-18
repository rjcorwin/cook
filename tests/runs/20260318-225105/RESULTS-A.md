# Test Results — Group A (Work, Loops, Flags, Doctor)

Run: 2026-03-18 22:51
Cook: local build at `dist/cli.js`
Agent: claude:opus (default)
Test directory: /Users/rj/Git/todo-test-a

## Summary

| Test | Result |
|------|--------|
| 1. Work — plain work call | PASS |
| 2. Repeat (x3) | PASS |
| 3. Repeat (long-form: repeat 3) | PASS |
| 4. Review (default prompts) | PASS |
| 5. Review (custom prompts) | PASS |
| 6. Review --max-iterations 5 | PASS |
| 7. Review 5 (positional) | PASS |
| 8. x3 review (repeat then review) | PASS |
| 9. review x3 (review loop repeated 3 times) | PASS |
| 10. Flags: --work-agent / --review-agent | PASS |
| 11. Flags: --hide-request | PASS |
| 12. Flags: --work / --review / --gate | PASS |
| 13. Doctor (basic) | PASS |
| 14. Doctor (with flag overrides) | PASS |

**14/14 PASS**

## Detailed results

### 1. Work — plain work call — PASS

Ran `cook "Add a dark mode toggle button to the todo app"`. Single work call completed in ~36s. Status bar showed `work 1/1`. No loop, no review. Dark mode toggle was added successfully.

### 2. Repeat (x3) — PASS

Ran `cook "Improve the visual design of the todo app" x3`. Three `Repeat pass N/3` announcements appeared (1/3, 2/3, 3/3). Each pass ran work sequentially. Status bar showed `work 1/1` per pass.

### 3. Repeat (long-form: repeat 3) — PASS

Ran `cook "Polish the CSS spacing and alignment" repeat 3`. Identical behavior to `x3` — three sequential passes with `Repeat pass N/3` announcements (1/3, 2/3, 3/3). Confirms `repeat N` is a valid alias.

### 4. Review (default prompts) — PASS

Ran `cook "Add keyboard shortcuts (Enter to add, Delete to remove selected)" review`. Loop ran once: work (iteration 1/3) -> review (iteration 1/3) -> gate (iteration 1/3). Gate returned DONE on first pass.

### 5. Review (custom prompts) — PASS

Ran with custom review and gate prompts for due dates feature. Custom review prompt ("Review the implementation. Check: (1) date input works...") appeared in review step. Custom gate prompt ("DONE if all 3 checks pass, else ITERATE") appeared in gate step. Gate returned DONE after first iteration.

### 6. Review --max-iterations 5 — PASS

Ran `cook "Add drag-and-drop task reordering" review --max-iterations 5`. Status bar correctly showed `Iteration: 1/5` (max iterations = 5). Gate returned DONE after first iteration.

### 7. Review 5 (positional) — PASS

Ran `cook "Improve error handling in the app" review 5`. Status bar showed `Iteration: 1/5`, confirming `review N` sets max iterations positionally, identical to `--max-iterations 5`.

### 8. x3 review (repeat then review) — PASS

Ran `cook "Improve accessibility (ARIA labels, keyboard nav, focus styles)" x3 review`. Three repeat passes ran first (1/3, 2/3, 3/3) with `work 1/1` each. Then review loop started: work -> review -> gate. Gate returned ITERATE on first pass, then DONE on iteration 2. Correct ordering: repeat passes first, then review loop.

### 9. review x3 (review loop repeated 3 times) — PASS

Ran `cook "Refactor the JS to be cleaner and more maintainable" review x3`. Full review loop ran 3 separate times. Each time: work -> review -> gate -> DONE. Repeat pass 1/3, 2/3, 3/3 announced before each full loop cycle.

### 10. Flags: --work-agent / --review-agent — PASS

Ran `cook "Add a confirmation dialog before deleting tasks" review --work-agent claude --review-agent claude`. Both agent flags accepted. Review loop completed normally with Gate: DONE.

### 11. Flags: --hide-request — PASS

Ran `cook "Add a task count badge to the page title" review --hide-request`. The templated request panel (containing COOK.md, Task, History sections) was completely absent from output. Only the status bar was shown during execution. No "### Task" text appeared in output. Gate returned DONE.

### 12. Flags: --work / --review / --gate — PASS

Ran with `--work`, `--review`, and `--gate` flags providing separate prompts for each step. Work prompt ("Add a 'clear all completed' button") used for work step. Review prompt ("Check the button only removes completed tasks...") appeared in review step. Gate prompt used for gate evaluation. Gate returned DONE.

### 13. Doctor (basic) — PASS

Ran `cook doctor`. Output showed all 5 step configs:
- Default: claude:opus
- Work: claude:opus
- Review: claude:opus
- Gate: claude:opus
- Iterate: claude:opus
- Ralph: claude:opus
- Sandbox modes: agent

Auth check passed: "Claude auth: ~/.claude/.credentials.json found (portable)".

### 14. Doctor (with flag overrides) — PASS

Ran `cook doctor --work-model haiku --gate-agent claude`. Work step correctly showed `claude:haiku` (model override applied). Gate still showed `claude:opus` (agent override alone doesn't change model display). All other steps unchanged at `claude:opus`.

## Bugs found

No new bugs found. All 14 tests passed cleanly.
