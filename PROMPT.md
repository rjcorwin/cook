# Prompt: Continue cook testing

You are continuing a manual testing session for `cook`, a CLI tool at `/Users/rj/Git/rjcorwin/cook`.

**Always use the local build:**
```sh
alias cook="node /Users/rj/Git/rjcorwin/cook/dist/cli.js"
```

Run all commands from a test directory. **Each test must use its own isolated directory** (tests modify shared files like `index.html` and `PLAN.md`). Set each up from scratch using the setup block in `TESTING.md`.

---

## Your job

Run the tests listed in `TESTING-TODO.md`. For each:

1. Set up a fresh test directory (see TESTING.md § Setup — use `rm -rf` on the dir first)
2. Run the command(s) exactly as shown
3. Check against the **Expected** behavior
4. Record the result in `TESTING-RESULTS.md`

Update `TESTING-RESULTS.md` by replacing each PENDING/NOT TESTED entry with the actual outcome (PASS / FAIL / PARTIAL PASS). Append any new bugs found to the Bugs table.

If a test fails due to a known bug documented in `TESTING-TODO.md`, note the failure and which bug caused it — do not spend time debugging unless a fix is trivial.

---

## Tests to run (in order of priority)

### 1. review x3 — needs re-run

**Dir:** `/Users/rj/Git/todo-review-x3`

```sh
rm -rf /Users/rj/Git/todo-review-x3
mkdir /Users/rj/Git/todo-review-x3 && cd /Users/rj/Git/todo-review-x3
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Refactor the JS to be cleaner and more maintainable" review x3 --sandbox none
```

**Expected:** The review loop runs 3 separate times in sequence. Each time: work → review → gate cycle. You should see the loop restart 3 times. Allow up to 30 minutes.

---

### 2. --work / --review / --gate flags

**Dir:** `/Users/rj/Git/todo-flags`

```sh
rm -rf /Users/rj/Git/todo-flags
mkdir /Users/rj/Git/todo-flags && cd /Users/rj/Git/todo-flags
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js \
  --work "Add a 'clear all completed' button" \
  --review "Check the button only removes completed tasks and doesn't affect active ones" \
  --gate "DONE if the button works correctly, else ITERATE" \
  --sandbox none
```

**Expected:** Review loop runs using the flag-supplied prompts. Gate resolves to DONE or ITERATE. Confirm the flag prompts appear in the logs, not generic defaults.

---

### 3. vs + merge

**Dir:** `/Users/rj/Git/todo-vs-merge`

```sh
rm -rf /Users/rj/Git/todo-vs-merge
mkdir /Users/rj/Git/todo-vs-merge && cd /Users/rj/Git/todo-vs-merge
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none
git add -A && git commit -m "Checkpoint before composition tests"

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Add an undo button for the last action" \
  vs \
  "Add an undo/redo stack (multiple levels)" \
  merge "take the best parts of both — simple undo with a clean implementation" \
  --sandbox none
```

Note: `Apply Run N? [Y/n]` and `Remove worktrees? [Y/n]` prompts require interactive input — answer `Y` to both.

**Expected:** Two worktrees created. Both runs complete. Merge agent synthesizes both approaches into a single result on the main branch. New commit in `git log`. Merged code may not match either branch exactly.

---

### 4. vs + compare

**Dir:** `/Users/rj/Git/todo-vs-compare`

```sh
rm -rf /Users/rj/Git/todo-vs-compare
mkdir /Users/rj/Git/todo-vs-compare && cd /Users/rj/Git/todo-vs-compare
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none
git add -A && git commit -m "Checkpoint before composition tests"

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Implement task export as JSON" \
  vs \
  "Implement task export as plain text" \
  compare \
  --sandbox none
```

**Expected:** Two worktrees created and both runs complete. No `Apply Run N?` merge prompt. A comparison file written to `.cook/compare-<session>.md`. No changes to `index.html` on the main branch.

---

### 5. ralph + review

**Dir:** `/Users/rj/Git/todo-ralph-review`

**Known issue:** Bug 2 — gate agents tend to output `**DONE**` (bold markdown), which `parseRalphVerdict()` in `executor.ts` doesn't recognize (`startsWith("DONE")` fails when string starts with `**`). This causes the gate to be misread as ITERATE, exhausts max-iterations, and ralph stops after task 1 with `⚠ Ralph: inner loop hit max iterations on task 1 — stopping`.

Run the test as-is first and observe whether the bug manifests. Record the result.

```sh
rm -rf /Users/rj/Git/todo-ralph-review
mkdir /Users/rj/Git/todo-ralph-review && cd /Users/rj/Git/todo-ralph-review
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a file PLAN.md with exactly 3 tasks, each on its own line as \`- [ ] <task>\`. Tasks: (1) add task priorities (high/medium/low), (2) add a search/filter bar, (3) add localStorage persistence. Do not implement them yet." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Rewrite PLAN.md with the same 3 tasks but all unchecked again." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js \
  "Read PLAN.md. Find the first unchecked task, implement it, then mark it [x] in PLAN.md." \
  review "Review the implementation of the task just completed." \
        "DONE if the implementation is solid and the task is marked [x], else ITERATE" \
  ralph 3 "Check PLAN.md. If all 3 tasks are marked [x], say DONE. Otherwise say NEXT." \
  --sandbox none
```

**Expected (if bug present):** Ralph stops after task 1. Log shows `⚠ Ralph: inner loop hit max iterations`. Record as FAIL with reference to Bug 2.

**Expected (if bug absent):** Three full work→review→gate cycles. All tasks marked `[x]` in PLAN.md at end.

---

### 6. Per-step agent override (low priority)

**Dir:** `/Users/rj/Git/todo-agent-override`

```sh
rm -rf /Users/rj/Git/todo-agent-override
mkdir /Users/rj/Git/todo-agent-override && cd /Users/rj/Git/todo-agent-override
git init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js init
node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js doctor --work-agent claude --review-agent claude --sandbox none

node /Users/rj/Git/rjcorwin/cook/dist/cli.js "Add a confirmation dialog before deleting tasks" review \
     --work-agent claude --review-agent claude \
     --sandbox none
```

**Expected:** `doctor` output shows both work and review steps with explicit `claude` agent (may look identical to default since claude is already default). Main command completes without error. Confirms flags are accepted.

---

## After each test

Append to `TESTING-RESULTS.md`. Update the summary table at the bottom. Note any new bugs in the Bugs table.

## Context files

- `TESTING.md` — full test spec with checks
- `TESTING-RESULTS.md` — results so far
- `TESTING-CHANGES.md` — bugs found and changes made to TESTING.md
- `TESTING-TODO.md` — this list with context
