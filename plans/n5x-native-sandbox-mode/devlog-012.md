# Devlog: Review Pass 4 Fix — Cleanup Promise Race

**Date:** 2026-03-07
**Implementing:** plan.md

## What Was Done
- Fixed the medium issue from code review pass 4: double Ctrl+C bypasses cleanup
- The problem: a second SIGINT arriving during cleanup would hit the `cleaning` reentrant guard, return immediately, then `process.exit(130)` in the `finally` block would kill the in-progress cleanup from the first SIGINT — orphaning Docker containers or leaving temp dirs behind
- The fix: `cleanup()` now stores its promise in `cleanupPromise` and returns it to all callers. Second/subsequent calls await the same promise rather than short-circuiting and racing to exit

```typescript
let cleanupPromise: Promise<void> | null = null

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    // unmount ink, cleanup pool
  })()
  return cleanupPromise
}
```

- Also confirmed all prior fixes from review passes 1-3 remain in place (12 total fixes)
- Build passes cleanly

## Tricky Parts
- The subtlety was that the old `cleaning` boolean guard *appeared* correct — it prevented re-entry — but the `process.exit()` in the signal handler's `finally` block didn't wait for the first cleanup to complete. The promise-based approach ensures all callers converge on the same resolution.

## Decisions Made
- Used a shared promise pattern rather than a mutex or event — simpler, no new dependencies, and the cleanup logic is idempotent anyway

## Deviations from Plan
- None — signal handling was not in the plan but was identified during review

## Next Steps
- All medium/high issues from 4 review passes are resolved
- Ready for pr.md and human review
