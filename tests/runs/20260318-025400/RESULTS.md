# Testing Results

Testing run: 2026-03-17 (initial), 2026-03-18 (completion)
Cook: local build at `dist/cli.js` (v3.3.0, r7w)
Agent: claude:opus (default)
Test subject: generated vanilla JS todo apps (isolated directories per test)

---

## Setup

**PASS**

`cook init` created all expected files: `COOK.md`, `.cook/config.json`, `.cook/Dockerfile`, `.cook/.gitignore`, `.cook/logs/`. Single work call generated `index.html` (118 lines, functional todo app with add/complete/delete/filter). Status bar on first run: `work 1/1 | claude:opus | 25s`.

---

## 1. Work

**PASS** (~35s)

Status bar: `work 1/1` — confirmed single work call, no loop. Dark mode toggle added with CSS custom properties, localStorage persistence.

---

## 2. Loop operators

### repeat (xN) — PASS (~2min)

Three sequential passes ran. `▸ Repeat pass 1/3`, `2/3`, `3/3` announced before each pass. Status bar per pass: `work 1/1` (each pass is its own independent work step, not an accumulating iteration counter).

**Note:** The repeat outer counter appears as a leading announcement line, not inline in the status bar.

---

### review — default prompts — PASS (~7.5min)

Status progressed through `work 1/3` → `review 1/3` → `gate 1/3` → `work 2/3` → ... → `gate 3/3`. Gate said ITERATE at iterations 1 and 2, DONE at iteration 3/3. `✓ Gate: DONE — loop complete`.

---

### review — custom prompts (positional shorthand) — PASS (~8min)

Custom review prompt used at all 3 iterations. Gate reasoning referenced checklist items. Loop hit `⚠ Gate: max iterations (3) reached — stopping` (gate kept finding issues). This is valid behavior — max-iterations limit is a graceful stop.

---

### review — `--max-iterations 5` — PASS (~3min)

Status showed `/5` denominator. Converged at iteration 2/5. Gate DONE after fixing High severity issues (drag handle exclusion, touch support). Confirmed early exit before limit.

---

### x3 + review (x3 then review) — PASS (~15min)

Three repeat passes ran first (`▸ Repeat pass 1/3`, `2/3`, `3/3`). Then review loop started with `work 1/3` → `review 1/3` → `gate 1/3`. Gate ITERATE at 1/3, DONE at 2/3. Confirms: `x3` wraps work, `review` wraps everything to its left.

---

### review x3 (review loop repeated 3 times) — PASS (~8min)

Dir: `/Users/rj/Git/todo-review-x3`

All 3 repeat passes ran in sequence, each with its own independent work→review→gate cycle:

- **Repeat pass 1/3:** Gate ITERATE at iteration 1 (XSS and ID collision issues found), DONE at iteration 2 (all high/medium issues resolved). Two inner iterations.
- **Repeat pass 2/3:** Gate DONE at iteration 1 (no high-severity issues, XSS fix confirmed). One inner iteration.
- **Repeat pass 3/3:** Gate DONE at iteration 1 (all changes correct, no bugs introduced). One inner iteration.

Iteration counter properly reset to 1 at the start of each new repeat pass. Each pass used its own session log file. The ITERATE mechanism within a pass works correctly (pass 1 demonstrated it).

---

## 3. Ralph

### Basic ralph — PARTIAL PASS (bug found)

Ralph ran 3 task iterations correctly. NEXT verdicts triggered at tasks 1 and 2. However, at task 3 the gate agent output `**DONE**` (markdown bold) instead of plain `DONE`.

**Bug:** `parseRalphVerdict` in `executor.ts` uses `upper.startsWith("DONE")` but `"**DONE**"` starts with `**`. Parser falls back to fail-safe: `⚠ Ralph gate: no NEXT/DONE verdict found in output — defaulting to DONE`. The fail-safe is correct behavior (correctly exits), but the warning is unexpected and indicates the gate prompt/parser should handle markdown formatting.

Output sequence: `▸ Ralph: NEXT — continuing to task 2` → `▸ Ralph: NEXT — continuing to task 3` → `⚠ Ralph gate: no NEXT/DONE verdict found — defaulting to DONE (fail-safe)` → `✓ Ralph: DONE after 3 tasks`

---

### Ralph + review — FAIL (Bug 2 confirmed)

Dir: `/Users/rj/Git/todo-ralph-review`

Setup completed successfully: `index.html` created, `PLAN.md` with 3 unchecked tasks. Ralph loop started at task 1.

**Bug 2 manifested on all 3 inner gate iterations:**

- **Gate 1/3:** Agent output `**Gate verdict: DONE**` (markdown bold). `parseGateVerdict()` uses `upper.startsWith("DONE")` — fails because line starts with `**`. Misread as ITERATE.
- **Gate 2/3:** Same `**Gate verdict: DONE**` output. Same parsing failure. Misread as ITERATE.
- **Gate 3/3:** Agent output `The gate step confirms **DONE** at iteration 3/3`. DONE embedded mid-sentence. `startsWith` also fails. Max iterations reached.

Log messages:
```
⚠ Gate: ITERATE — continuing to iteration 2
⚠ Gate: ITERATE — continuing to iteration 3
⚠ Gate: max iterations (3) reached — stopping
⚠ Ralph: inner loop hit max iterations on task 1 — stopping (not converging)
```

Ralph never advanced past task 1. The work→review→gate pipeline executed correctly each time; only the verdict parsing was broken. Ironically, the work agents completed all 3 tasks within the first ralph task's iterations — `PLAN.md` at the end has all 3 tasks marked `[x]` — but ralph couldn't see this because it was stuck on the gate misread.

**Note:** Bug 2 also affects `parseGateVerdict()` in `loop.ts` (line 42-49), not just `parseRalphVerdict()` in `executor.ts`. The `startsWith` pattern is vulnerable in both locations. In basic ralph (no review), the fail-safe covers it. In ralph+review, the inner gate has no fail-safe and the bug cascades.

---

## 4. Composition operators

### versions (vN) — PASS with caveats (~1.5min per run, ~5min total)

3 worktrees created (`cook-<session>-1`, `-2`, `-3`). Progress bars show parallel progress per run. All 3 runs completed. Pick agent selected winner with detailed reasoning.

**Confirmation prompts (interactive):**
1. `Apply Run N to current branch? [Y/n]` — type Y to merge
2. `Remove worktrees and branches? [Y/n]` — type Y to clean up

When stdin is not a TTY, both prompts default to Y (EOF = yes).

**Bug (parser):** `v3 "criteria"` syntax throws `Unknown token "criteria"`. The parser requires the explicit `pick` keyword: `v3 pick "criteria"`. This is a discrepancy between the README (`v3 "least code wins"`) and the parser.

**Prerequisite:** Commit all changes before running vN — dirty working tree causes `git merge` to fail silently (logs warning, doesn't exit).

**Race session dir:** `.cook/race/<session>/run-1`, `run-2`, `run-3`

---

### vs + pick — PASS

Two worktrees created (one per approach). Both runs completed. Pick agent selected winner with reasoning. Result merged to main branch. Worktrees cleaned up.

---

### vs + merge — PASS

Dir: `/Users/rj/Git/todo-vs-merge`

Two worktrees created: `cook-<session>-1` (simple undo button) and `cook-<session>-2` (undo/redo stack). Both runs completed in parallel (~34s and ~55s respectively).

Merge agent ran after both completed:
- Created merge worktree (`cook-<session>-merge`)
- Ran its own work→review→gate cycle on the synthesis
- Gate: DONE after one iteration

Result: `cook merge` commit on main branch. Merged `index.html` grew from 105 to 133 lines with a multi-level undo stack (synthesizing Run 2's undo/redo approach with Run 1's clean simplicity). Includes Ctrl/Cmd+Z keyboard shortcut.

No interactive prompts appeared (auto-accepted in non-TTY). Worktrees cleaned up automatically.

---

### vs + compare — PARTIAL PASS

Dir: `/Users/rj/Git/todo-vs-compare`

Two worktrees created. Both runs completed:
- Run 1: JSON export (file download, 4250 bytes)
- Run 2: Plain text export (clipboard with file fallback, 4634 bytes)

Comparison file written: `.cook/compare-20260318-025453-rzk2.md` (2627 bytes, 51 lines) with structured analysis of strengths/weaknesses and a recommendation (Run 2).

`index.html` on main branch confirmed **unchanged** (md5sum matched, `git diff HEAD` clean).

**Issue:** An unexpected `Apply a run? Enter number (1-2) or blank to skip:` prompt appeared at the end. The spec states compare mode should NOT show any apply/merge prompt. The prompt was non-blocking in non-TTY (process completed), and no merge occurred — but its presence is a bug.

---

## 5. Flags

### Per-step agent override — PASS

Dir: `/Users/rj/Git/todo-agent-override`

`cook doctor --work-agent claude --review-agent claude` accepted both flags, showing all steps as `claude:opus`. Auth check passed.

Main command (`cook "Add a confirmation dialog..." review --work-agent claude --review-agent claude --sandbox none`) completed successfully:
- work (iteration 1/3): Added `confirm()` dialog to deleteTask function (~14s)
- review (iteration 1/3): No high/medium severity issues found
- gate (iteration 1/3): DONE — "confirm() dialog implementation is clean, correct, and introduces no regressions"

Flags accepted without error. Full work→review→gate cycle completed in one iteration.

---

### --hide-request — PASS

No request panel displayed — goes straight to the status bar spinner. Confirmed: the `--hide-request` flag suppresses the templated request panel in the TUI.

---

### --work / --review / --gate flags — FAIL (Bug 5)

Dir: `/Users/rj/Git/todo-flags`

Command:
```sh
cook --work "Add a 'clear all completed' button" \
     --review "Check the button only removes completed tasks..." \
     --gate "DONE if the button works correctly, else ITERATE" \
     --sandbox none
```

Exited cleanly (code 0) but **only the work step ran**. No review or gate executed. The `--review` and `--gate` flag values were parsed into `ParsedFlags` but never consulted when building the AST.

Session log confirmed only `[work 1]` entry — no review or gate entries.

**Root cause (Bug 5):** In `src/parser.ts` lines 376-379, when `positional.length === 0 && parsedFlags.work`, the parser returns a bare `{ type: 'work' }` AST node regardless of whether `--review` or `--gate` flags are also present. A review loop AST node is only created when either a `review` keyword appears in positional args or multiple positional strings trigger implicit review mode. The parser should detect `--review`/`--gate` presence and construct a review loop node.

---

## 6. Doctor — PASS

**Default:**
```
▸ Default:     claude:opus
▸ Work:        claude:opus
▸ Review:      claude:opus
▸ Gate:        claude:opus
▸ Iterate:     claude:opus
▸ Ralph:       claude:opus
▸ Sandbox modes: none
✓ claude CLI found on PATH
✓ Claude auth: CLAUDE_CODE_OAUTH_TOKEN set and passed through
✓ Doctor checks passed
```

All 5 steps shown plus default and sandbox. Auth check ran and passed.

**With model override** (`--work-model haiku`):
```
▸ Work: claude:haiku    ← override applied
▸ Review: claude:opus   ← unchanged
```
Per-step flags correctly reflected.

**Note:** Using `--work-agent claude --review-agent claude` looks identical to the default — not a useful test flag since claude is already the default.

---

## Bugs Found

| # | Bug | Severity | Location |
|---|-----|----------|----------|
| 1 | `v3 "criteria"` throws `Unknown token` — requires `v3 pick "criteria"` | Medium | `src/parser.ts` lines 298-308 |
| 2 | Gate/ralph verdict parser doesn't recognize markdown-bold `**DONE**` — `startsWith("DONE")` fails when line starts with `**` | Medium | `src/loop.ts` `parseGateVerdict()` line 42-49, `src/executor.ts` `parseRalphVerdict()` line 369-377 |
| 3 | vN merge fails silently when working tree is dirty (no error exit, just warning + branch info) | Low (by design?) | `src/executor.ts` line 986 |
| 4 | README documents `v3 "criteria"` shorthand that doesn't work | Medium | `README.md` |
| 5 | `--work`/`--review`/`--gate` flags ignored when no positional args — parser builds bare work node, skips review loop | High | `src/parser.ts` lines 376-379 |
| 6 | `compare` resolver shows unexpected "Apply a run?" prompt — should not offer merge in compare mode | Low | `src/executor.ts` (composition resolver) |

---

## Summary

| Test | Result |
|------|--------|
| Setup | PASS |
| 1. Work (plain) | PASS |
| 2a. repeat x3 | PASS |
| 2b. review (default) | PASS |
| 2c. review (custom prompts) | PASS |
| 2d. review --max-iterations 5 | PASS |
| 2e. x3 then review | PASS |
| 2f. review x3 | PASS |
| 3a. Ralph (basic) | PARTIAL PASS — fail-safe handled `**DONE**`, warning shown |
| 3b. Ralph + review | FAIL — Bug 2: gate outputs `**DONE**`, inner loop exhausts max-iterations, ralph stops after task 1 |
| 4a. versions (vN) | PASS — bugs: `v3 "criteria"` syntax, dirty tree warning |
| 4b. vs + pick | PASS |
| 4c. vs + merge | PASS — merge agent synthesized both approaches, commit on main |
| 4d. vs + compare | PARTIAL PASS — comparison file written, main unchanged, but unexpected "Apply a run?" prompt (Bug 6) |
| 5a. --hide-request | PASS |
| 5b. --work/--review/--gate flags | FAIL — Bug 5: parser ignores `--review`/`--gate` when only `--work` flag used |
| 5c. Per-step agent override | PASS |
| 6. Doctor | PASS |
