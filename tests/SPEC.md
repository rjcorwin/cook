# Test Specifications

Uses a fresh todo app as the test subject. Each test uses its own isolated directory (see `README.md` for conventions).

> **Local build:** If testing a local build, replace `cook` with `node /path/to/cook/dist/cli.js`, or run `npm link` first from the cook project root.
>
> **Parallel runs:** Tests modify shared files (`index.html`, `PLAN.md`). If running sections in parallel (e.g. delegating to multiple agents), use separate directories: `../todo-loops`, `../todo-ralph`, `../todo-composition`, etc. Set each up with the full Setup block below.

## Setup

```sh
rm -rf ../todo
mkdir ../todo && cd ../todo
git init
cook init
cook "Create a simple todo app as a single index.html file. It should support: add a task, mark complete, delete, and filter by status (all/active/done). No dependencies — vanilla JS only." --sandbox none
```

Verify: `index.html` exists and works in a browser. Keep this open in a browser tab throughout.

---

## 1. Work

Plain work call — no loop.

```sh
cook "Add a dark mode toggle button to the todo app" --sandbox none
```

**Check:** Button appears. No loop, no review — one shot.

---

## 2. Loop operators

### repeat (xN)

```sh
cook "Improve the visual design of the todo app" x3 --sandbox none
```

**Check:** A `▸ Repeat pass N/3` announcement appears before each pass. The status bar shows `work 1/1` per pass (inner iteration counter). Three passes ran sequentially, each refining the last. Design should be noticeably more polished than after pass 1.

### review

Default prompts:

```sh
cook "Add keyboard shortcuts (Enter to add, Delete to remove selected)" review --sandbox none
```

**Check:** Loop ran at least once. Gate said DONE or ITERATE — if ITERATE, a second pass ran. Final result passes review without errors.

Custom prompts:

```sh
cook "Add due dates to tasks" \
     "Review the implementation. Check: (1) date input works, (2) dates display correctly, (3) no JS errors in console." \
     "DONE if all 3 checks pass, else ITERATE" \
     --sandbox none
```

**Check:** Review prompt is specific. Gate reasoning references the checklist. The loop may hit max iterations (3) on complex tasks — `⚠ Gate: max iterations (3) reached — stopping` is a valid outcome.

Max iterations — forces multiple passes:

```sh
cook "Add drag-and-drop task reordering" review --max-iterations 5 --sandbox none
```

**Check:** Up to 5 iterations allowed. Gate should converge before hitting the limit.

### xN + review

3 work passes then one review loop:

```sh
cook "Improve accessibility (ARIA labels, keyboard nav, focus styles)" x3 review --sandbox none
```

**Check:** `▸ Repeat pass 1/3`, `2/3`, `3/3` run first. Then the review loop starts: status bar switches to `work 1/3` → `review 1/3` → `gate 1/3` pattern.

Review loop repeated 3 times:

```sh
cook "Refactor the JS to be cleaner and more maintainable" review x3 --sandbox none
```

**Check:** Full review loop runs 3 separate times (each with its own work→review→gate cycle).

---

## 3. Ralph

First, add a plan file:

```sh
cook "Create a file PLAN.md with exactly 3 tasks, each on its own line as `- [ ] <task>`. Tasks: (1) add task priorities (high/medium/low), (2) add a search/filter bar, (3) add localStorage persistence. Do not implement them yet." --sandbox none
```

Verify `PLAN.md` exists with 3 unchecked tasks.

Basic ralph:

```sh
cook "Read PLAN.md. Find the first unchecked task, implement it, then mark it [x] in PLAN.md." \
     ralph 3 "Check PLAN.md. If all 3 tasks are marked [x], say DONE. Otherwise say NEXT." \
     --sandbox none
```

**Check:** Ralph ran 3 task iterations. `PLAN.md` should have all tasks marked `[x]` at the end.

Ralph with review gate per task:

```sh
# Reset PLAN.md first
cook "Rewrite PLAN.md with the same 3 tasks but all unchecked again." --sandbox none

cook "Read PLAN.md. Find the first unchecked task, implement it, then mark it [x] in PLAN.md." \
     review "Review the implementation of the task just completed." \
           "DONE if the implementation is solid and the task is marked [x], else ITERATE" \
     ralph 3 "Check PLAN.md. If all 3 tasks are marked [x], say DONE. Otherwise say NEXT." \
     --sandbox none
```

**Check:** Each task gets a review gate before ralph advances. Three full work→review→gate cycles, then three ralph gate evaluations.

---

## 4. Composition operators

### versions (vN)

> **Prerequisite:** Commit all current changes before running composition tests. Cook merges via `git merge` and will fail if the working tree is dirty.
>
> ```sh
> git add -A && git commit -m "Checkpoint before composition tests"
> ```

Race 3 approaches to the same problem, pick the best:

```sh
cook "Add a task statistics bar showing total, active, and completed counts" \
     v3 pick "cleanest implementation — least code, most readable" \
     --sandbox none
```

**Check:** 3 worktrees created in `.cook/race/<session>/`. Status bar shows 3 parallel runs progressing. After all runs finish, a pick agent runs and selects a winner. Cook prompts `Apply Run N to current branch? [Y/n]` — type `Y` to confirm. Stats bar present in `index.html` after merge. New commit appears in `git log --oneline`.

With pick criteria:

```sh
cook "Style the app with a cohesive color theme" \
     v3 pick "most visually appealing and consistent" \
     --sandbox none
```

### vs

Two different approaches in parallel:

```sh
cook "Add task categories using colored tags" \
  vs \
  "Add task categories using a dropdown selector" \
  pick "more intuitive UX, less code" \
  --sandbox none
```

**Check:** Two separate worktrees, two different implementations. Judge picks one. Winning approach merged.

Merge resolver:

```sh
cook "Add an undo button for the last action" \
  vs \
  "Add an undo/redo stack (multiple levels)" \
  merge "take the best parts of both — simple undo with a clean implementation" \
  --sandbox none
```

**Check:** Merge agent synthesizes both approaches. Result may be different from either branch.

Compare resolver:

```sh
cook "Implement task export as JSON" \
  vs \
  "Implement task export as plain text" \
  compare \
  --sandbox none
```

**Check:** No branch merged. `.cook/compare-<session>.md` written with a comparison document.

---

## 5. Flags

### Per-step agent override

```sh
cook "Add a confirmation dialog before deleting tasks" review \
     --work-agent claude --review-agent claude \
     --sandbox none
```

**Check:** `cook doctor` before this to confirm both agents available if mixing.

### --hide-request

```sh
cook "Add a task count badge to the page title" review --hide-request --sandbox none
```

**Check:** The templated request panel is absent from the TUI (only output shown).

### --work / --review / --gate flags

```sh
cook --work "Add a 'clear all completed' button" \
     --review "Check the button only removes completed tasks and doesn't affect active ones" \
     --gate "DONE if the button works correctly, else ITERATE" \
     --sandbox none
```

---

## 6. Doctor

```sh
cook doctor --sandbox none
cook doctor --work-model haiku --gate-agent claude --sandbox none
```

**Check (first command):** Shows all 5 step configs (work, review, gate, iterate, ralph) plus default agent and sandbox. Auth check passes.

**Check (second command):** Work step shows `claude:haiku` (model override applied). Gate still shows `claude:opus`. Other steps unchanged. Confirms per-step flag overrides are reflected in doctor output.

> Note: Using `--work-agent claude --review-agent claude` (the same agent as the default) looks identical to the default output — not a useful override to test with.

---

## Cleanup

```sh
cd ../cook
rm -rf ../todo
```

If you ran `npm link`, also run `npm unlink -g @let-it-cook/cli` to restore your global install.
