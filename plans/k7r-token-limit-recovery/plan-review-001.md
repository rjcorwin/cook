# Plan Review: Token Limit Recovery

**Reviewer:** AI
**Date:** 2026-03-19
**Reviewing:** plan.md

## Summary
The plan proposes a clean hybrid approach: a centralized `retryOnRateLimit` utility with call-site integration for UI events. The scope is well-bounded (CLI only, rate limits only, step-level retry only) and the implementation touches a reasonable number of files.

## Strengths
- Option C (hybrid wrapper) is the right call — keeps retry logic DRY while preserving caller control over UI
- `isRateLimitError` with string matching on stderr is pragmatic given the subprocess-based architecture
- AbortSignal support enables clean cancellation (important for Ctrl+C during a 5-hour wait)
- Configuration with sensible defaults means it works out of the box but power users can tune it
- `--no-wait` flag for CI/fast-fail is a good UX touch

## Concerns

### High
- None

### Medium
- The plan doesn't specify what happens to partial stdout from a rate-limited run. The `err.stdout` property on the rejected error (set in `native-runner.ts:71`) contains output produced before the limit was hit. Should this be logged, discarded, or passed as context to the retry? Recommendation: log it (append to session log as a partial step) but don't use it as `lastMessage` — the retry gets a clean slate.
- For composition branches, if multiple branches hit rate limits at similar times, the retries will all fire around the same time and potentially hit limits again. Consider staggering retries or having a shared rate-limit state. However, this may be over-engineering for v1 — sequential retries per branch with independent timers is fine to start.

### Low
- The poll interval of 5 minutes means the worst case is a 5-minute unnecessary wait after quota resets. Acceptable trade-off vs. aggressive polling.
- The pattern list for `isRateLimitError` will need maintenance as agent CLIs evolve. Consider logging unrecognized non-zero exits at a debug level so users can report new patterns.

## Suggestions
- Add a `--wait-minutes N` CLI flag as a shorthand for setting maxWaitMs, in addition to `--no-wait`
- Consider emitting a system notification (e.g., terminal bell or OS notification) when the wait starts and when it resumes, for users who walk away

## Recommendation
[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)
