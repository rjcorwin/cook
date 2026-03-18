# Plan Review: Remove --sandbox none (Round 2)

**Reviewer:** AI
**Date:** 2026-03-18
**Reviewing:** plan.md (revised)

## Summary

The revised plan addresses all three High concerns from review-001. It now explicitly covers `src/race.ts` (step 5), `src/parser.ts` (step 4), and adds a deprecation warning in `config.ts` (step 3). The file inventory is substantially more complete, and the implementation ordering is sound. Two issues remain: the installed skill file `.claude/skills/cook/SKILL.md` is still missing from the plan, and several documentation files have `--sandbox none` references that the plan does not fully enumerate.

## Strengths

- All three High blockers from review-001 are resolved: `race.ts`, `parser.ts`, and the deprecation warning are now explicit plan steps
- Implementation ordering is correct: delete code, update types, update validation, update consumers, build-verify, then docs
- The deprecation warning in `config.ts` for existing `"sandbox": "none"` configs is a good user-experience decision
- The plan correctly notes that historical files (test runs, old plans) should be left unchanged

## Concerns

### High

- **Missing file: `.claude/skills/cook/SKILL.md`** (the installed copy). This is the file agents actually read when `/cook` is invoked as a skill. It contains `--sandbox none` in 12 places: every quick-reference example (lines 16, 19, 22, 25, 28, 33, 36), the flags section (line 81 recommends `"none" for full access`), and the prerequisites section (line 95 says `Use --sandbox none when running from within an agent session`). The source copy at `skill/SKILL.md` is already correct (no `--sandbox none` references), so the installed copy is out of sync even before this change. The plan must include updating `.claude/skills/cook/SKILL.md` to match `skill/SKILL.md`, or the entire security motivation is undermined -- an agent reading the skill file will still be told to use `--sandbox none`.

### Medium

- **`README.md` references are understated.** The plan says "Remove `none` from sandbox table and examples" but README.md has `none` in two distinct locations: the sandbox mode table (line 254: full row describing None mode) and the CLI help text block (line 365: `--sandbox MODE ... agent|docker|none`). Both need updating. This is called out in the plan but worth being explicit about the two separate locations to avoid missing one.

- **`index.html` reference.** Line 779 of `index.html` has `<td><code>--sandbox none</code></td>` in the sandbox mode table. The plan mentions this file but the implementer should know the exact location.

- **`SPEC.md` (root level) line 330** has `--sandbox MODE ... agent|docker|none` in the CLI reference section. The plan mentions `tests/SPEC.md` but does not mention the root-level `SPEC.md`. These are different files.

- **`src/cli.ts` line 342** -- The plan mentions updating `cmdDoctor()` generically, but the specific line `if (usedModes.has('agent') || usedModes.has('none'))` at line 342 should just become `if (usedModes.has('agent'))`. Flagging for implementer clarity.

### Low

- **`tests/SPEC.md` scope.** The plan says "Remove `--sandbox none` from all test commands (default `agent` is sufficient)." There are at least 15 occurrences across the file. Since `agent` is the default, simply deleting `--sandbox none` from each command line is the right approach, but the implementer should do a global find-replace rather than manual editing to avoid missing any.

- **No explicit error message for `--sandbox none` via CLI flag.** After this change, passing `--sandbox none` on the command line will result in `sandbox` being `undefined` in `ParsedFlags` (since `parser.ts` will no longer match it), which falls through to the config default of `agent`. This is safe and functional, but a user migrating from `none` gets no feedback about why their flag was ignored. The deprecation warning in `config.ts` only fires for config-file usage, not CLI flag usage. Consider adding a warning in `buildParsedFlags()` when `sandboxFlag === 'none'`.

## Review of High Issues from plan-review-001

| Review-001 Issue | Status | Notes |
|---|---|---|
| Missing `src/race.ts` | **Resolved** | Now step 5 in the plan with specific instructions |
| Missing `src/parser.ts` | **Resolved** | Now step 4 in the plan |
| Missing `.claude/skills/cook/SKILL.md` | **Not resolved** | Still absent from the plan. The source copy `skill/SKILL.md` is noted as "already correct" but the installed copy at `.claude/skills/cook/SKILL.md` is full of `--sandbox none` |
| Missing root `SPEC.md` | **Partially resolved** | Plan mentions `tests/SPEC.md` and `tests/README.md` but root `SPEC.md` line 330 also needs updating |

## Suggestions

- Copy `skill/SKILL.md` over `.claude/skills/cook/SKILL.md` (or update the installed copy to match the source). This is the single most important documentation change since it directly controls what agents are told to do.

- Add a step to verify no remaining `none` references in source code after implementation: `grep -r "'none'\|sandbox none\|BareRunner\|bare-runner" src/` as a post-build sanity check.

- For the CLI flag deprecation, a one-liner in `buildParsedFlags()` would suffice:
  ```typescript
  if (sandboxFlag === 'none') logWarn('--sandbox none is no longer supported, using default (agent)')
  ```

## Recommendation

[ ] Ready for human review
[x] Needs revision (see High concern above)

The single remaining High issue is the `.claude/skills/cook/SKILL.md` installed copy, which actively tells agents to use `--sandbox none`. This directly undermines the security goal of the entire plan. Adding it as a step in the plan is a one-line fix. Once addressed, the plan is ready for implementation.
