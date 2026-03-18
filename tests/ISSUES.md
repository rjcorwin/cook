# Testing Issues

Known bugs found during integration testing. Fixed issues are removed — check git history and `tests/runs/` for historical records.

## Bug 3: Parallel cook processes corrupt shared `/tmp/claude-1000/`

**Severity:** Medium (infrastructure)
**Location:** Claude Code subprocess temp directory sharing
**Found:** 2026-03-18 run

Running more than 2 cook processes concurrently from a coding agent causes EIO errors. Cook spawns Claude Code subprocesses that share `/tmp/claude-1000/`, and cleanup by one corrupts the others. Mitigation: run tests sequentially, use non-`/tmp` directories.

## Bug 4: Second-level composition outer merge fails silently

**Severity:** Medium
**Location:** Composition executor / worktree merge path
**Found:** 2026-03-18 run (11:28)

`cook "A" vs "B" pick "criteria" v2 pick "criteria2"` — the inner `vs` compositions each resolve correctly (pick agents run, winners merge within their worktrees), but the outer-level merge back to the main branch fails silently. The outer pick agent selects a winner and prompts "Apply Run N?", but no merge commit lands. Needs investigation of how nested worktree results are passed up to the outer composition layer.

## Resolved

- **Bug 1 (Ralph SIGABRT):** Did not reproduce in clean environment (2026-03-18 re-run). Likely collateral from EIO filesystem corruption during parallel testing. Ralph basic and Ralph+review both pass.
- **Bug 2 (confirm/pickOne EOF hang):** Fixed in `src/race.ts` — added readline `close` event handler. Verified by v3 pick test.
