# Devlog: Review Loop Context Loss Fix

**Date:** 2026-03-17
**Implementing:** Fix for medium issue from code-review-009

## What Was Done
- Added `initialLastMessage?: string` field to `LoopConfig` in `loop.ts`
- Changed `agentLoop` to seed `lastMessage` from `config.initialLastMessage` instead of always starting empty
- Threaded `innerResult.lastMessage` through in `executeReview`'s compound inner node path (executor.ts ~line 229)
- Threaded `ctx.lastMessage` through in `executeBranchForComposition`'s review case with compound inner nodes (executor.ts ~line 602)

## Tricky Parts
- The simple review case (inner is a Work node) doesn't need `initialLastMessage` because `agentLoop` runs the work prompt itself on iteration 1, producing its own output. Only compound inner nodes (repeat, ralph, etc.) need to pass their result through since `agentLoop` receives an iterate prompt rather than the original work prompt.

## Decisions Made
- Kept the fix scoped to the flagged issue (compound inner nodes only). The simple work-node path is unaffected.

## Deviations from Plan
- None — this is a bug fix not covered in the original plan.

## Next Steps
- None — ready for review.
