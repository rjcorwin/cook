# Testing Results

Testing run: 2026-03-17
Cook: local build at `dist/cli.js` (v3.3.0, r7w)
Agent: claude:opus (default)
Test subject: `/Users/rj/Git/todo` (generated vanilla JS todo app)

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

### review x3 (review loop repeated 3 times) — PENDING (subagent running)

---

## 3. Ralph

### Basic ralph — PARTIAL PASS (bug found)

Ralph ran 3 task iterations correctly. NEXT verdicts triggered at tasks 1 and 2. However, at task 3 the gate agent output `**DONE**` (markdown bold) instead of plain `DONE`.

**Bug:** `parseRalphVerdict` in `executor.ts` uses `upper.startsWith("DONE")` but `"**DONE**"` starts with `**`. Parser falls back to fail-safe: `⚠ Ralph gate: no NEXT/DONE verdict found in output — defaulting to DONE`. The fail-safe is correct behavior (correctly exits), but the warning is unexpected and indicates the gate prompt/parser should handle markdown formatting.

Output sequence: `▸ Ralph: NEXT — continuing to task 2` → `▸ Ralph: NEXT — continuing to task 3` → `⚠ Ralph gate: no NEXT/DONE verdict found — defaulting to DONE (fail-safe)` → `✓ Ralph: DONE after 3 tasks`

### Ralph + review — PENDING (subagent running)

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

### vs + pick — PENDING (subagent running)

### vs + merge — NOT TESTED

### vs + compare — NOT TESTED

---

## 5. Flags

### Per-step agent override — NOT TESTED

### --hide-request — PENDING (subagent running)

Subagent observation: "In TEST C (with --hide-request), there is no request panel — it goes straight to the status bar spinner." — likely PASS.

### --work / --review / --gate flags — PENDING (subagent running)

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
| 2 | Ralph gate doesn't recognize `**DONE**` (bold markdown) — falls back to fail-safe | Low | `src/executor.ts` `parseRalphVerdict()` |
| 3 | vN merge fails silently when working tree is dirty (no error exit, just warning + branch info) | Low (by design?) | `src/executor.ts` line 986 |
| 4 | README documents `v3 "criteria"` shorthand that doesn't work | Medium | `README.md` |

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
| 2f. review x3 | PENDING |
| 3. Ralph (basic) | PARTIAL PASS — fail-safe handled `**DONE**`, warning shown |
| 3. Ralph + review | PENDING |
| 4a. versions (vN) | PASS — bugs: `v3 "criteria"` syntax, dirty tree warning |
| 4b. vs + pick | PENDING |
| 4c. vs + merge | NOT TESTED |
| 4d. vs + compare | NOT TESTED |
| 5a. --hide-request | LIKELY PASS (subagent observed correct behavior) |
| 5b. --work/--review/--gate flags | PENDING |
| 5c. Per-step agent override | NOT TESTED |
| 6. Doctor | PASS |
