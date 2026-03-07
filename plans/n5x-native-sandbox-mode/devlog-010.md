# Devlog: Review Pass 2 Fixes

**Date:** 2026-03-07
**Implementing:** plan.md (review pass 2 medium issues)

## What Was Done
- Fixed unbounded stderr accumulation in Docker's `runAgent` function (`sandbox.ts:278-281`). Applied the same 1MB cap pattern already used in `agent-utils.ts:spawnAgent` — a `stderrLen` counter that stops pushing chunks once the limit is reached.
- Fixed env passthrough opt-out for `CLAUDE_CODE_OAUTH_TOKEN` (`config.ts:74`). Changed from Set union merge (defaults always included) to replacement semantics: if user provides `env` in config, it replaces defaults entirely. If omitted, defaults are used. This lets users opt out of any default env var by simply not including it in their config.

## Tricky Parts
- The env passthrough change is technically a behavior change: previously `"env": ["MY_VAR"]` in config would produce both `CLAUDE_CODE_OAUTH_TOKEN` and `MY_VAR` via union. Now it produces only `MY_VAR`. This is the correct behavior — what you write is what you get — and `cook init` already generates configs that explicitly include `CLAUDE_CODE_OAUTH_TOKEN`, so initialized projects are unaffected.

## Decisions Made
- Chose replacement semantics over an exclude mechanism (e.g., `!VAR_NAME` prefix) for env passthrough. Replacement is simpler, more predictable, and doesn't require inventing new syntax.

## Deviations from Plan
- None. These fixes address review feedback, not plan items.
