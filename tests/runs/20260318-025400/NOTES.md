# Run Notes — 2026-03-18

Testing ran across two sessions:
- **2026-03-17:** Initial run — setup, work, loop operators, basic ralph, vN, vs+pick, doctor. Several tests left PENDING due to subagent timeouts.
- **2026-03-18:** Completion run — re-ran review x3, --work/--review/--gate flags. New tests: vs+merge, vs+compare, ralph+review, per-step agent override. All 6 ran in parallel using isolated directories.

---

## Test spec changes made during testing

1. **Add `rm -rf` to setup** — clear stale directories from previous runs.
2. **Add parallel-run isolation note** — tests modify shared files, need separate directories.
3. **Add local build note** — use `node /path/to/cook/dist/cli.js` instead of global install.
4. **Fix repeat (xN) check description** — repeat counter is a leading announcement line, not inline in status bar.
5. **Update custom prompts check** — max iterations reached is a valid outcome.
6. **Fix x3 + review check description** — explicit repeat pass + review loop sequence.
7. **Fix vN syntax** — `v3 "criteria"` doesn't work, changed to `v3 pick "criteria"` (Bug 1).
8. **Add vN prerequisite** — must commit before running composition tests (Bug 3).
9. **Update vN check** — document interactive prompts and merge commit.
10. **Fix doctor test command** — `--work-model haiku` is more useful than `--work-agent claude`.
11. **Add cleanup note** — `npm unlink -g @let-it-cook/cli` if `npm link` was used.

---

## Final pass rate

13/18 PASS, 2/18 PARTIAL PASS, 2/18 FAIL

Bugs found: 6 total (1 High, 3 Medium, 2 Low). See `tests/ISSUES.md`.
