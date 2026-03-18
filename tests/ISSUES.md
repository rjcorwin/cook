# Testing Issues

Known bugs found during integration testing. Fixed issues are removed — check git history and `tests/runs/` for historical records.

## Bug 3: Parallel cook processes corrupt shared `/tmp/claude-1000/`

**Severity:** Medium (infrastructure)
**Location:** Claude Code subprocess temp directory sharing
**Found:** 2026-03-18 run

Running more than 2 cook processes concurrently from a coding agent causes EIO errors. Cook spawns Claude Code subprocesses that share `/tmp/claude-1000/`, and cleanup by one corrupts the others. Mitigation: run tests sequentially, use non-`/tmp` directories.

## Resolved

- **Bug 1 (Ralph SIGABRT):** Did not reproduce in clean environment (2026-03-18 re-run). Likely collateral from EIO filesystem corruption during parallel testing. Ralph basic and Ralph+review both pass.
- **Bug 2 (confirm/pickOne EOF hang):** Fixed in `src/race.ts` — added readline `close` event handler. Verified by v3 pick test.
