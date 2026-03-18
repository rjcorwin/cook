# Testing TODO

Tests not yet completed as of 2026-03-17. See TESTING-RESULTS.md for full results so far.

---

## Needs re-run

### review x3

```sh
cook "Refactor the JS to be cleaner and more maintainable" review x3 --sandbox none
```

Background subagent timed out (exit 144) before all 3 review cycles completed. Needs a full run in isolation with enough time (each review cycle ~8min → ~25min total).

**Expected:** Full review loop runs 3 separate times, each with its own work→review→gate cycle.

---

### --work / --review / --gate flags

```sh
cook --work "Add a 'clear all completed' button" \
     --review "Check the button only removes completed tasks and doesn't affect active ones" \
     --gate "DONE if the button works correctly, else ITERATE" \
     --sandbox none
```

Subagent exited 0 but the output wasn't captured. Needs a clean run with output verified.

**Expected:** Loop runs using the flag-supplied prompts, gate decides DONE or ITERATE correctly.

---

## Not tested

### ralph + review

```sh
# Reset PLAN.md first
cook "Rewrite PLAN.md with the same 3 tasks but all unchecked again." --sandbox none

cook "Read PLAN.md. Find the first unchecked task, implement it, then mark it [x] in PLAN.md." \
     review "Review the implementation of the task just completed." \
           "DONE if the implementation is solid and the task is marked [x], else ITERATE" \
     ralph 3 "Check PLAN.md. If all 3 tasks are marked [x], say DONE. Otherwise say NEXT." \
     --sandbox none
```

**Known issue:** Bug 2 — gate agent outputs `**DONE**` (markdown bold), which `parseRalphVerdict()` doesn't recognize. In a ralph+review chain this cascades: gate misread as ITERATE → inner loop exhausts max-iterations → ralph stops after task 1 with `⚠ Ralph: inner loop hit max iterations on task 1 — stopping`.

Either fix the bug first (strip markdown chars in `parseGateVerdict` / `parseRalphVerdict`) or add explicit "Respond with exactly DONE, ITERATE, or NEXT — no formatting" to the gate prompt as a workaround.

**Expected:** Each task gets a review gate before ralph advances. Three full work→review→gate cycles, then three ralph gate evaluations.

---

### vs + merge

```sh
cook "Add an undo button for the last action" \
  vs \
  "Add an undo/redo stack (multiple levels)" \
  merge "take the best parts of both — simple undo with a clean implementation" \
  --sandbox none
```

**Expected:** Merge agent synthesizes both approaches. Result may differ from either individual branch.

---

### vs + compare

```sh
cook "Implement task export as JSON" \
  vs \
  "Implement task export as plain text" \
  compare \
  --sandbox none
```

**Expected:** No branch merged. `.cook/compare-<session>.md` written with a comparison document. No `Apply Run N?` prompt.

---

### Per-step agent override

```sh
cook "Add a confirmation dialog before deleting tasks" review \
     --work-agent claude --review-agent claude \
     --sandbox none
```

**Note:** This uses the same agent for both steps (claude is the default), so the output will look identical to a default run. The test only confirms the flags are accepted without error. Run `cook doctor --work-agent claude --review-agent claude` first to verify both steps show the override.

---

## Already passing (for reference)

| Test | Result |
|------|--------|
| Setup | PASS |
| 1. Work (plain) | PASS |
| 2a. repeat x3 | PASS |
| 2b. review (default) | PASS |
| 2c. review (custom prompts) | PASS |
| 2d. review --max-iterations 5 | PASS |
| 2e. x3 then review | PASS |
| 3. Ralph (basic) | PARTIAL PASS — fail-safe handled `**DONE**`, warning shown |
| 4a. versions (vN) | PASS |
| 4b. vs + pick | PASS |
| 5a. --hide-request | PASS |
| 6. Doctor | PASS |
