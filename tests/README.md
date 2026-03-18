# Cook Integration Tests

Manual integration tests for `cook`, a CLI tool for AI-assisted coding workflows.

These tests exercise the full CLI — parsing, execution, agent orchestration, composition operators — by running real `cook` commands against a generated test project and observing behavior.

---

## Quick start

```sh
# 1. Build cook
cd /path/to/cook
npm run build

# 2. Set up the alias (use the local build, not global install)
alias cook="node /path/to/cook/dist/cli.js"

# 3. Create a run folder for this session
RUN_DIR=tests/runs/$(date +%Y%m%d-%H%M%S)
mkdir -p "$RUN_DIR"

# 4. Run the tests (see SPEC.md)
# 5. Record results in $RUN_DIR/RESULTS.md
# 6. Triage and fix any bugs found (see "After testing" below)
# 7. Clean up test directories and worktrees
```

---

## Directory structure

```
tests/
  README.md          This file — how to run tests
  SPEC.md            Test specifications and expected behavior
  ISSUES.md          Known bugs (cleared once fixed — check git history for past issues)
  runs/
    YYYYMMDD-HHMMSS/
      RESULTS.md     Test outcomes for this run
      NOTES.md       Optional — observations, changes, deviations
```

---

## Conventions

### Test isolation

Each test **must** use its own directory. Tests modify shared files (`index.html`, `PLAN.md`) and will interfere if run in the same directory.

Use a descriptive name per test, as siblings of the cook project directory (not under `/tmp`):
```sh
../todo-review-x3
../todo-flags
../todo-vs-merge
```

### Run folders

Each test session gets a folder under `tests/runs/` named with a datetime stamp:

```
tests/runs/YYYYMMDD-HHMMSS/
```

The folder must contain at minimum a `RESULTS.md` with the test outcomes. Add a `NOTES.md` for any observations, deviations, or changes made during the run.

### Test setup

Every test starts from a clean generated project. The standard setup:

```sh
rm -rf /path/to/test-dir
mkdir -p /path/to/test-dir && cd /path/to/test-dir
git init
cook init
cook "Create a simple todo app as a single index.html file. It should support: \
  add a task, mark complete, delete, and filter by status (all/active/done). \
  No dependencies — vanilla JS only."```

Verify `index.html` exists before proceeding with the test.

For composition tests (`vs`, `vN`), also commit before running:
```sh
git add -A && git commit -m "Checkpoint before composition tests"
```

### Timeouts

These tests invoke AI agents and can take significant time:
- Simple tests (work, flags, doctor): 1-3 minutes
- Review loops: 5-10 minutes per cycle
- `review x3`: up to 30 minutes
- `ralph + review`: 15-25 minutes
- Composition (`vs`, `vN`): 5-10 minutes

Plan accordingly when running the full suite.

---

## Running tests as a coding agent

If you are an AI coding agent tasked with running these tests:

1. **Build first:** `npm run build` in the cook project root.

2. **Use the local build:** Always use `node /path/to/cook/dist/cli.js` — never a global install, which may be outdated.

3. **Create the run folder:**
   ```sh
   RUN_DIR=/path/to/cook/tests/runs/$(date +%Y%m%d-%H%M%S)
   mkdir -p "$RUN_DIR"
   ```

4. **Read `SPEC.md`** for the full list of tests, commands, and expected behavior.

5. **Read `ISSUES.md`** for known bugs. If a test fails due to a known bug, note the failure and which bug caused it — don't spend time debugging.

6. **Set up each test in its own directory** using the setup block above.

7. **Run tests sequentially, not in parallel.** Cook spawns Claude Code as a subprocess, and multiple concurrent cook processes share the same `/tmp/claude-1000/` directory tree. When one subprocess cleans up, it can corrupt the task output files that other processes (including the outer agent session) depend on, causing persistent `EIO` errors that break the bash tool for the rest of the session. Run one test at a time to avoid this.

   If parallelism is desired, limit to 2 concurrent tests and monitor for EIO errors. If EIO occurs, the session is unrecoverable — record partial results and start a fresh session.

8. **Use project-local test directories, not `/tmp`.** Place test directories under the project or as siblings (e.g., `../todo-work`, `../todo-review`), not under `/tmp`. The `/tmp/claude-1000/` path is shared infrastructure for the agent's bash tool — cook subprocesses running there create conflicts.

9. **Record results in `$RUN_DIR/RESULTS.md`** using this format:

   ```markdown
   # Test Results

   Run: YYYY-MM-DD HH:MM
   Cook: local build at `dist/cli.js`
   Agent: claude:opus (default)

   ## Summary

   | Test | Result |
   |------|--------|
   | Test name | PASS / FAIL / PARTIAL PASS |
   | ... | ... |

   ## Detailed results

   ### Test name — RESULT

   Description of what happened, gate verdicts, any issues observed.

   ## Bugs found

   | # | Bug | Severity | Location |
   |---|-----|----------|----------|
   | ... | ... | ... | ... |
   ```

10. **Update `ISSUES.md`** if new bugs are found. Check for duplicates first.

11. **Interactive prompts:** Some composition tests (`vs + merge`, `vN + pick`) show interactive prompts (`Apply Run N? [Y/n]`, `Remove worktrees? [Y/n]`). In non-TTY environments these should default to Y (auto-accept). **Known issue:** The `confirm()` function in `race.ts` doesn't handle EOF correctly — see ISSUES.md.

12. **If the session breaks (EIO errors):** Record whatever results you have in `$RUN_DIR/RESULTS.md`, note which tests were not run, and stop. A fresh session is needed to continue. Do not attempt to recover — the bash tool's output directory is permanently broken for that session.

---

## After testing: triage and fix

Once a test run is complete and results are recorded, optionally start a new coding agent session to triage and fix the bugs found.

### Triage process

1. **Review `ISSUES.md`** and the run's `RESULTS.md` for all FAIL and PARTIAL PASS entries.

2. **For each bug**, launch a subagent in an isolated worktree to:
   - Read the relevant source files
   - Implement the fix
   - Build and test in an isolated test directory
   - Report back with: code changes, test results, regressions checked, tricky decisions

3. **Parallelize** — bugs in different files can be fixed simultaneously in separate worktrees. A human triages and dispatches while agents do the fixing.

4. **Merge fixes** — as subagents complete, review their changes and merge to the working branch. Worktree agent changes may land in the main working tree automatically or need cherry-picking.

5. **Clear resolved issues from `ISSUES.md`** — once a bug is fixed and committed, remove it. The historical record lives in git history and the test run folder. ISSUES.md reflects current state only.

### Example workflow

```
Human: "Bug 2 is a verdict parsing issue. Use includes() instead of startsWith(). Launch a subagent."
Agent:  → launches subagent in worktree for Bug 2
Human: "Bug 3 needs a dirty-tree check. Launch another."
Agent:  → launches subagent in worktree for Bug 3
        ← Bug 2 agent reports back: fixed, tested, regression-clean
Agent:  → merges Bug 2 fix, commits
        ← Bug 3 agent reports back: fixed, tested
Agent:  → merges Bug 3 fix, commits
Agent:  → clears ISSUES.md, all bugs resolved
```

---

## Cleanup

After testing and triage are complete, clean up artifacts:

### Test directories

Remove the per-test directories created during the run:
```sh
rm -rf /path/to/todo-review-x3
rm -rf /path/to/todo-flags
rm -rf /path/to/todo-vs-merge
# etc.
```

### Worktrees and branches

Bug-fix subagents and cook race runs create worktrees and branches that accumulate. Clean them up:

```sh
# Remove stale worktree entries (directories already gone)
git worktree prune

# List remaining worktrees
git worktree list

# Remove specific worktrees (agent worktrees, old race runs)
git worktree remove /path/to/worktree

# Delete orphaned branches
git branch -D branch-name

# Clean up old cook race worktrees in bulk
rm -rf .cook/race/
git worktree prune
```

Prunable worktrees (marked `prunable` in `git worktree list`) are safe to clean — their directories no longer exist.

### What to keep

- `tests/runs/YYYYMMDD-HHMMSS/` — keep these as historical records
- `tests/ISSUES.md` — keep the file, but it should be empty when all bugs are resolved
- Git commits — the fix history is the permanent record

---

## Test categories

See `SPEC.md` for full details. The categories are:

1. **Work** — Single work call, no loop
2. **Loop operators** — `review`, `x3`, `review x3`, `--max-iterations`
3. **Ralph** — Multi-task orchestration with `ralph N`, ralph + review
4. **Composition** — `vN`, `vs + pick`, `vs + merge`, `vs + compare`
5. **Flags** — `--hide-request`, `--work/--review/--gate`, `--work-agent/--review-agent`
6. **Doctor** — `cook doctor` health check and flag reflection
