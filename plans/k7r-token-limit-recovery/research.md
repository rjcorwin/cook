# Research: Token Limit Recovery

**Requester:** rjcorwin (via GitHub issue #25, with HN community suggestion)
**Date:** 2026-03-19

## Requirements

### Original Request
Automated mechanism to resume cook operations after token quota resets. Currently a run just bails when a token/rate limit is hit. The request is for automatic continuation after quota refreshes (every ~5 hours for Claude).

### Context
Cook orchestrates long-running multi-step workflows (review loops, races, ralph task lists). These can easily exceed a single token quota window. When a subagent (Claude Code, Codex) hits its rate limit, the subprocess exits non-zero and cook treats it as an unrecoverable failure — the entire run aborts.

The HN suggestion is essentially: detect the rate-limit error, sleep until the quota resets, then retry the failed step automatically.

### Open Questions
1. What exact exit codes and error messages do Claude Code, Codex, and OpenCode emit on rate limits?
2. Should there be a maximum number of retries (or a wall-clock timeout)?
3. Should the user be able to opt out of auto-recovery (e.g., `--no-wait`)?
4. For composition (vN/vs), if one branch hits a limit, should we pause all branches or just the one that hit it?

## System Architecture

### Related Components

**Error propagation path:**

1. **`native-runner.ts:69-76`** — When the agent subprocess exits non-zero, it creates an Error with the stderr text and rejects the promise. The error includes `err.stdout` with any partial output.

2. **`sandbox.ts`** (Docker runner) — Similar pattern: non-zero exit from the container command rejects with stderr.

3. **`loop.ts:112-114`** — The `agentLoop` catches errors from `runner.runAgent`, emits an `'error'` event, and returns immediately with `verdict: 'ITERATE'`. **This is the key bail-out point** — it doesn't retry, it just stops the loop.

4. **`executor.ts`** — `executeWork` (line 142) calls `runner.runAgent` with no try/catch around it, so the error propagates up and kills the entire execution. `executeRalph` (line 344) also has no retry. `executeComposition` uses `Promise.allSettled` so individual branch failures are collected, not fatal.

### Data Flow

```
CLI args → parser → AST → executor.execute(node)
                              ↓
                    runner.runAgent(agent, model, prompt)
                              ↓
                    spawn(claude/codex) as subprocess
                              ↓
                    [subprocess hits token limit]
                              ↓
                    exit code != 0, stderr contains error message
                              ↓
                    Promise rejected with Error
                              ↓
                    loop.ts catches → returns early (bail)
                    -or-
                    executor.ts doesn't catch → propagates up (crash)
```

### Constraints

- **No API access** — Cook shells out to CLI tools (claude, codex, opencode). Rate limit detection must rely on exit codes and stderr text, not API response codes.
- **Multi-agent** — Different agents will have different rate limit error signatures. Claude Code, Codex, and OpenCode each have their own error formats.
- **State preservation** — When a step fails mid-execution, any partial output and git changes in the worktree are still present. The retry should re-run the step, not try to resume mid-conversation.
- **Composition parallelism** — In race/vs mode, branches run concurrently. If one branch hits a limit, the others may continue or also hit limits.
- **User experience** — Long waits (up to 5 hours) need clear feedback: what happened, when the retry will occur, countdown or periodic status.

## Prior Art

### Claude Code's own behavior
Claude Code itself shows a "rate limited, waiting..." message when it hits limits during interactive use. But in `-p` (print/pipe) mode (which cook uses), it appears to just exit with an error.

### Common retry patterns
- **Exponential backoff** — Standard for API rate limits, but overkill here since the wait is a fixed quota reset window (not a per-request rate limit).
- **Fixed interval polling** — Check every N minutes if the quota has reset. Simple and appropriate for 5-hour windows.
- **Signal-based resume** — Wait for the user to signal "quota is back" (e.g., press Enter). Simpler but requires human presence.

### Relevant error signatures (to investigate)
- Claude Code: likely contains "rate limit" or "token limit" or "quota" in stderr
- Codex: likely similar, OpenAI-style rate limit errors
- OpenCode: unknown, needs investigation

## Analysis

### Where to add retry logic

There are two viable insertion points:

**Option A: Inside `AgentRunner.runAgent`** — Wrap the subprocess call with retry logic. The runner detects rate-limit errors, waits, and retries transparently. Callers (loop.ts, executor.ts) don't need to change.

- Pro: Single point of change, clean abstraction
- Pro: Works for all callers automatically
- Con: The runner doesn't know about UI events (can't emit progress/countdown)
- Con: Tight coupling between error detection and execution

**Option B: In `loop.ts` and `executor.ts` catch blocks** — Add retry-with-wait logic at the call sites. When `runAgent` rejects with a rate-limit error, the caller waits and retries.

- Pro: Caller has full context (events, iteration state, UI)
- Pro: Can make different decisions per context (e.g., composition vs. simple loop)
- Con: Multiple call sites to update (loop.ts, executeWork, executeRalph, executeBranchForComposition)

**Option C: Hybrid — retry utility wrapping `runAgent`** — Create a `retryOnRateLimit(fn, onWait)` wrapper that the callers use. Keeps retry logic centralized while letting callers provide UI callbacks.

- Pro: Centralized retry logic
- Pro: Callers can provide event emitters for UI feedback
- Pro: Testable in isolation
- Best of both worlds

### Configuration surface

Minimal addition to `.cook/config.json`:
```json
{
  "retry": {
    "enabled": true,
    "pollIntervalMinutes": 5,
    "maxWaitMinutes": 360
  }
}
```

### Detection heuristics

Since we can't rely on structured error codes from CLI tools, we need string matching on stderr/error messages. A reasonable approach:

- Match patterns like: `rate limit`, `token limit`, `quota`, `too many requests`, `429`, `capacity`, `overloaded`
- Make the pattern list configurable or at least easy to extend
- Default to NOT retrying on unrecognized errors (fail-safe)
