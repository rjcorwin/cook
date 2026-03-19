# Plan: Token Limit Recovery

**Status:** Draft
**Author:** AI
**Created:** 2026-03-19

## Summary
Add automatic retry-after-wait when a subagent hits a token/rate limit. Cook will detect rate-limit errors from agent subprocesses, display a countdown, and retry the failed step once the quota resets — instead of bailing the entire run.

## Motivation
Long-running cook workflows (review loops, ralph task lists, races) routinely exceed a single quota window. Today, hitting a rate limit kills the run, losing all progress context. Users must manually restart. This is the #1 friction point for ambitious multi-step workflows.

## Goals
- Detect rate-limit/quota errors from Claude Code, Codex, and OpenCode
- Automatically wait and retry the failed agent call
- Show clear UI feedback (what happened, when retry will occur, countdown)
- Preserve all execution state (iteration count, last message, worktrees) across the wait
- Make the behavior configurable (enable/disable, max wait time, poll interval)

## Non-Goals
- Resume a partially-completed agent conversation (we re-run the full step)
- Handle the no-code skill path (different architecture, separate issue)
- Query remaining quota proactively before it's exhausted
- Handle non-rate-limit transient errors (network blips, etc.) — that's a separate concern

## Technical Design

### 1. Rate-limit error detection (`src/retry.ts` — new file)

Create a utility module with:

```typescript
export interface RetryConfig {
  enabled: boolean
  pollIntervalMs: number    // default: 5 * 60 * 1000 (5 min)
  maxWaitMs: number         // default: 6 * 60 * 60 * 1000 (6 hours)
}

export function isRateLimitError(error: Error): boolean
// Pattern-match on error.message (which contains stderr from the subprocess)
// Patterns: /rate.?limit/i, /token.?limit/i, /quota/i, /too many requests/i,
//           /429/i, /capacity/i, /overloaded/i, /resource_exhausted/i

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onWaiting?: (info: { error: Error; nextRetryAt: Date; attempt: number }) => void,
  onRetry?: (info: { attempt: number }) => void,
  signal?: AbortSignal,
): Promise<T>
// 1. Call fn()
// 2. If it throws and isRateLimitError(err), emit onWaiting, sleep pollIntervalMs, retry
// 3. If total wait exceeds maxWaitMs, throw the original error
// 4. If it throws and NOT a rate limit error, rethrow immediately
// 5. If signal is aborted, throw
```

### 2. Configuration (`src/config.ts`)

Add `retry` field to `CookConfig`:

```typescript
export interface CookConfig {
  // ... existing fields ...
  retry: RetryConfig
}
```

Defaults: `{ enabled: true, pollIntervalMs: 300000, maxWaitMs: 21600000 }`

Parse from `.cook/config.json`:
```json
{
  "retry": {
    "enabled": true,
    "pollIntervalMinutes": 5,
    "maxWaitMinutes": 360
  }
}
```

### 3. Integration points

Wrap every `runner.runAgent(...)` call with `retryOnRateLimit`:

**`loop.ts` (line ~109):**
```typescript
output = await retryOnRateLimit(
  () => runner.runAgent(agent, model, prompt, onLine),
  config.retry,
  (info) => events.emit('waiting', info),
  (info) => events.emit('retry', info),
)
```

**`executor.ts` — `executeWork` (line ~142):**
Same pattern, using `loopEvents` for UI.

**`executor.ts` — `executeRalph` (line ~344):**
Same pattern for the ralph gate call.

**`executor.ts` — `executeBranchForComposition` (lines ~590, ~681):**
Same pattern, using the branch emitter.

### 4. UI feedback

Add handling for `'waiting'` and `'retry'` events in the UI components:

**`ui/App.tsx`** — Show a "Rate limited — retrying in X:XX" status with countdown.
**`ui/RaceApp.tsx`** — Show per-branch rate limit status.

The `onWaiting` callback provides `nextRetryAt` so the UI can render a live countdown.

### 5. CLI flag

Add `--no-wait` flag (parsed in `cli.ts`) that sets `retry.enabled = false`. Useful for CI or when the user wants fast-fail behavior.

## Implementation Approach

1. **Create `src/retry.ts`** — `isRateLimitError()` + `retryOnRateLimit()` utility
2. **Update `src/config.ts`** — Add `retry` to `CookConfig`, parse from config.json
3. **Update `src/loop.ts`** — Wrap the `runAgent` call with retry
4. **Update `src/executor.ts`** — Wrap all `runAgent` calls with retry (executeWork, executeRalph, executeBranchForComposition)
5. **Update `src/ui/App.tsx`** — Handle `waiting`/`retry` events
6. **Update `src/ui/RaceApp.tsx`** — Handle `waiting`/`retry` events per branch
7. **Update `src/cli.ts`** — Add `--no-wait` flag
8. **Add tests** — Unit tests for `isRateLimitError` and `retryOnRateLimit`

Key files to modify:
- `src/retry.ts` (new)
- `src/config.ts`
- `src/loop.ts`
- `src/executor.ts`
- `src/ui/App.tsx`
- `src/ui/RaceApp.tsx`
- `src/cli.ts`

## Alternatives Considered

**Option A: Retry inside AgentRunner** — Cleaner abstraction but no access to UI events. Would require threading event emitters into the runner interface, changing the contract for all runners.

**Option B: Retry at each call site without shared utility** — More flexible per-site but duplicates logic across 5+ call sites. Fragile to maintain.

**Chosen: Option C (hybrid wrapper)** — `retryOnRateLimit` is a standalone utility that call sites use, passing their own event callbacks. Centralized detection/retry logic, decentralized UI integration.
