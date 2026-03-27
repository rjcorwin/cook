# Research Review: `cook shell` — Interactive Sandbox Shell

**Reviewer:** AI
**Date:** 2026-03-27
**Reviewing:** research.md

## Summary
The research clearly identifies the need, the existing infrastructure to reuse, and a pragmatic approach (spawn `docker exec -it` rather than reimplementing TTY handling in Node.js). The two main design axes — container lifecycle and network policy — are well framed.

## Strengths
- Correctly identifies that `docker exec -it` via `child_process.spawn` with `stdio: 'inherit'` is far simpler and more reliable than programmatic TTY management through dockerode
- Good coverage of existing sandbox.ts infrastructure and what can be reused
- Container lifecycle options are clearly laid out with a reasonable recommendation
- The stretch goal of `cook shell claude` (launch agent TUI in sandbox) adds nice forward-looking scope without overcommitting

## Gaps

### High
- None

### Medium
- Should clarify what happens if a cook agent loop is already running (container already exists for this project). Options: refuse, share the container, or use a different container name.
- The `cook shell <command>` variant should clarify whether it's interactive (TTY) or non-interactive (pipe-friendly). E.g., `cook shell ls` vs `cook shell bash`.

### Low
- Could mention whether `cook doctor` should be updated to cover shell-specific checks
- Could note that `cook shell` without Docker configured should give a clear error message

## Questions
- Should `cook shell` require `--sandbox docker` in config, or should it always use Docker regardless of the project's sandbox setting? (It's inherently a Docker feature.)

## Recommendation
[x] Ready for human review
[ ] Needs revision (see gaps/questions above)
