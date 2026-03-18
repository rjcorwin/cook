# Testing Changes

Issues found while running TESTING.md, and fixes applied.

---

## Applied fixes

### 1. Add `rm -rf ../todo` to setup

Setup block now starts with `rm -rf ../todo` to clear any stale directory from a previous run.

### 2. Add parallel-run isolation note

Added a note at the top: tests modify shared files (`index.html`, `PLAN.md`) and should not run in parallel in the same directory. Parallel agent runs need separate `../todo-N` directories.

### 3. Add local build note

Added tip: replace `cook` with `node /path/to/cook/dist/cli.js` or run `npm link` when testing a local build, since the global install may lag behind.

### 4. Fix repeat (xN) check description

Old: "watch the status bar"
New: "A `▸ Repeat pass N/3` announcement appears before each pass. Status bar shows `work 1/1` per pass (inner iteration, not outer repeat counter)."

Confirmed: the repeat counter is a leading announcement line, not inline in the status bar.

### 5. Update custom prompts check

Added: "The loop may hit max iterations (3) on complex tasks — `⚠ Gate: max iterations (3) reached — stopping` is a valid outcome."

### 6. Fix x3 + review check description

Old: "Status bar shows 3 work steps, then switches to review/gate."
New: Explicitly says `▸ Repeat pass 1/3`, `2/3`, `3/3` run first, then review loop starts with `work 1/3 → review 1/3 → gate 1/3` pattern.

### 7. Fix vN syntax: `v3 "criteria"` → `v3 pick "criteria"`

**Bug confirmed:** `v3 "criteria"` (without explicit `pick`) throws `Unknown token` in the parser. The parser (lines 298-308) only consumes a criteria string if preceded by an explicit `pick`, `merge`, or `compare` keyword. The README documents `v3 "criteria"` as valid shorthand but the parser doesn't implement it.

All vN commands in TESTING.md updated to use explicit `pick`: `v3 pick "criteria"`.

### 8. Add vN prerequisite: commit before running

Dirty working tree causes `git merge` to fail silently (logs a warning and branch info, doesn't exit). Added prerequisite: `git add -A && git commit -m "Checkpoint before composition tests"`.

### 9. Update vN check: confirmation prompt and merge commit

Old: "Judge picks a winner. Winning branch merged into current."
New: Documents the two interactive prompts (`Apply Run N?`, `Remove worktrees?`), the need to type Y, and that a new commit should appear in `git log --oneline`.

### 10. Fix doctor test command

Old: `cook doctor --work-agent claude --review-agent claude` (identical to default, output looks the same)
New: `cook doctor --work-model haiku --gate-agent claude` (shows `Work: claude:haiku` override clearly against `claude:opus` defaults)

Added note explaining why `--work-agent claude` is a useless test flag.

### 11. Add cleanup note for npm link

Added: "If you ran `npm link`, also run `npm unlink -g @let-it-cook/cli` to restore your global install."

---

## Bugs found (not TESTING.md issues, but code issues)

### Bug 1: `v3 "criteria"` parser rejects bare string after vN

**Location:** `src/parser.ts` lines 298-308
**Symptom:** `cook "work" v3 "criteria"` throws `Unknown token "criteria"`. Expected: criteria consumed as pick criteria.
**Workaround:** Use `cook "work" v3 pick "criteria"` explicitly.
**Note:** README documents the shorthand as valid (`cook "Add dark mode" v3 "least code wins"`) — README needs fixing too.

### Bug 2: Ralph gate doesn't recognize markdown-bold verdicts

**Location:** `src/executor.ts` `parseRalphVerdict()`
**Symptom:** Gate agent outputs `**DONE**` (bold markdown). Parser checks `upper.startsWith("DONE")` — fails because `"**DONE**"` starts with `**`. Falls back to fail-safe `⚠ Ralph gate: no NEXT/DONE verdict found in output — defaulting to DONE`.
**Behavior:** Correct outcome (loop exits), but unexpected warning.
**Fix options:**
- Strip markdown characters before matching: `line.trim().replace(/[*_`]/g, '').toUpperCase()`
- Or add explicit instructions in gate prompt: "Respond with exactly DONE or NEXT, no formatting"

### Bug 3: vN merge fails silently with dirty working tree

**Location:** `src/executor.ts` lines 982-992
**Symptom:** `git merge` fails if `index.html` (or any tracked file) has uncommitted changes. Error is caught, warning logged, branch names printed. Process continues to cleanup prompt.
**Behavior:** Arguably by design — user can manually merge. But the warning is easy to miss.
**Workaround:** Commit before running vN.
