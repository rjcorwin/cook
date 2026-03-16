# Plan: Post-Race Improvements for Iterate/Next/Ralph

**Status:** Done
**Author:** rjcorwin + Claude
**Created:** 2026-03-16
**Source:** Synthesized from runs 2, 3, and 4 of the 20260316-050318 cook race

## Background

Run 1 of the cook race implemented the core `p7x-iterate-next-ralph` feature and was merged into this branch. This plan captures the improvements from the other three runs worth acting on.

---

## To Do

### M4. Race keyword + `-n` without ralph: silent no-op

**File:** `src/cli.ts` (`cmdKeywordDispatch`)

When a user runs `cook "w" race 3 -n` (race without ralph), `-n` is parsed but has no effect — there's no outer loop to receive NEXT verdicts. No warning is shown.

**Fix:** In `cmdKeywordDispatch`, after resolving `nextPrompt`, check if a race segment is present but no ralph segment. If so, warn:
```
--next/-n flag has no effect with race alone (no outer ralph loop to receive NEXT verdicts)
```

---

### M5. `extractRaceMultiplier` consumes judge prompt as boolean flag value

**File:** `src/cli.ts` (`extractRaceMultiplier`)

Lines 848–854 check `after[j].startsWith('--')` to identify flags, then unconditionally grab the next non-`--` arg as the flag's value — even for boolean flags like `--hide-request` that take no value. `cook "w" x3 --hide-request "judge criteria"` silently consumes "judge criteria" as `--hide-request`'s value; the judge prompt is never set.

**Fix:** Only consume the next arg as a value for flags in `VALUE_FLAGS` or `HYBRID_FLAGS`. Boolean flags (`BOOLEAN_FLAGS`) should not consume the next arg.

---

### M7. `confirm`/`pickOne` hang on non-interactive stdin

**File:** `src/race.ts`

`readline.createInterface` is used with no TTY detection. In CI, piped stdin, or backgrounded processes, `rl.question` blocks indefinitely.

**Fix:** Check `process.stdin.isTTY` at the top of each function. When false, `confirm` returns `true` (accept default) and `pickOne` returns `null`.

---

### L7. Redundant iterate/next resolution in three places

**File:** `src/cli.ts`

The same pattern for resolving iterate/next config from CLI flags and config file is now copy-pasted in `runLoop`, `cmdRaceFromMultiplier`, and `cmdRace`. Adding a new option requires updating all three.

**Fix:** Extract a `resolveIterateNext(parsed, config)` helper returning `{ iteratePrompt, nextPrompt, maxNexts, effectiveGatePrompt }` and call it from all three.

---

## Not Doing (and why)

- **H1 (cmdRace gate prompt)** — fixed
- **M1 (CONTINUE ambiguity)** — already in `ITERATE_KEYWORDS` in Run 1
- **M2/M3/L2 (composed UI)** — ralph direct mode creates a fresh App per task; the bug path requires verifying `composed` prop usage first
- **M6 (parseForkJoinArgs short flags)** — already handled via `SHORT_FLAG_MAP` in Run 1
- **M8 (RunnerPool concurrency)** — future concern, not a real bug today
- **M9 (fork-join confirm)** — behavior change, out of scope
- **M10 (consolidate runner factory)** — cleanup, not urgent
- **M11 (timeout)** — feature work
- **L1 (maxNexts magic number)** — minor edge case
- **L3 (ralph dead code)** — post-loop warn IS reachable when loop exhausts naturally
- **L4 (for loop → while)** — already a `while` loop in Run 1
- **L5 (maxIterations validation)** — low signal
- **L6 (-h in parseArgs)** — edge case; `-h` is caught by `main()` before routing
