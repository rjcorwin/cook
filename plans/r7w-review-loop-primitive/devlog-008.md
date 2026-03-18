# Devlog: Resolver merge-failure early return

**Date:** 2026-03-17
**Implementing:** plan.md (fixes from code-review-011)

## What Was Done
- Fixed `resolveMerge` to return early when `git merge` into the main branch fails with a conflict, preserving the merge synthesis branch and all run branches for user inspection
- Fixed `resolveCompare` to return early on merge conflict after user picks a branch to apply, preserving worktrees for inspection
- Both fixes match the existing `applyAndCleanup` pattern (line 965-977) which already handled this correctly for `resolvePick`

## Tricky Parts
- None — straightforward 3-line fix in each resolver, matching the established pattern

## Decisions Made
- Log preserved branch names on merge failure so users know what to inspect (consistent with existing messaging in `applyAndCleanup`)

## Deviations from Plan
- None — these are bug fixes caught during review

## Next Steps
- All high and medium issues across 11 review cycles resolved
- 9 low-severity items remain (non-blocking, suitable for follow-up)
- Ready for next review cycle
