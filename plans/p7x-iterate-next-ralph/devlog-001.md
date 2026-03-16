# Devlog: Post-Race Fixes (plan-002)

**Date:** 2026-03-16
**Implementing:** plan-002.md

## What Was Done

- **M4** — Added a `logWarn` in `cmdKeywordSegments` (`src/cli.ts`) when `--next`/`-n` is passed with a `race` keyword but no `ralph` keyword. The check reads `parsed.nextPrompt !== undefined || config.next` and fires before the keyword-dispatch branching.

- **M5** — Fixed `extractRaceMultiplier` (`src/cli.ts`) to only consume the next arg as a flag's value when the flag is in `VALUE_FLAGS` or `HYBRID_FLAGS`. Previously it consumed the next non-`--` arg unconditionally for all `--`-prefixed flags, which silently ate a judge prompt string when a boolean flag like `--hide-request` was present. Also tightened the guard from `!startsWith('--')` to `!startsWith('-')` to avoid consuming short flags.

- **M7** — Added `process.stdin.isTTY` early-return guards to `confirm` and `pickOne` in `src/race.ts`. `confirm` returns `true` (accept default) and `pickOne` returns `null` (no selection) when stdin is not a TTY, preventing indefinite hangs in CI, piped stdin, or backgrounded processes.

- **L7** — Extracted `resolveIterateNext(parsed, config, overrides?)` helper in `src/cli.ts` (inserted just above `runLoop`). Returns `{ iteratePrompt, nextPrompt, maxNexts, effectiveGatePrompt }`. Called from `runLoop`, `cmdRaceFromMultiplier`, and `cmdRace`, replacing three copies of the same six-line resolution block. `cmdKeywordSegments` retains its own logic due to the ralph-segment override semantics (higher-priority nextPrompt, `?? DEFAULT_NEXT_PROMPT` fallback).

## Tricky Parts

- The `resolveIterateNext` helper couldn't cleanly absorb `cmdKeywordSegments` because that function puts `ralphSegment?.stringParam` at *higher* priority than `parsed.nextPrompt`, and appends `?? DEFAULT_NEXT_PROMPT` as a final fallback (ralph keyword implies next). Forcing that into the overrides model would have required a separate "high-priority override" parameter, adding complexity with little gain. Left it as-is.

- M4 uses `parsed.nextPrompt !== undefined` rather than `nextPrompt !== undefined` because `nextPrompt` in `cmdKeywordSegments` always resolves to a string (the `?? DEFAULT_NEXT_PROMPT` fallback makes it non-optional). Checking the raw parsed value correctly identifies user intent.

## Decisions Made

- `resolveIterateNext` overrides are lower-priority for `iteratePrompt`/`nextPrompt` (fallbacks after parsed + config) and higher-priority for `gatePrompt` (takes precedence over parsed). This matches the existing `runLoop` overrides semantics exactly — no behavior change, just consolidation.

## Deviations from Plan

- None. All four items (M4, M5, M7, L7) implemented as described in plan-002.

## Next Steps

- Branch is ready for PR.
