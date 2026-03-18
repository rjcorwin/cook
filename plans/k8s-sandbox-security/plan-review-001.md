# Plan Review: Remove --sandbox none

**Reviewer:** AI
**Date:** 2026-03-18
**Reviewing:** plan.md

## Summary

The plan correctly identifies the security problem and proposes the right solution: remove `--sandbox none` entirely rather than relying on config locks or prompt-based enforcement. The motivation is sound, the research backs it up, and the two remaining modes (`agent`, `docker`) cover all legitimate use cases. However, the plan has significant gaps in its file inventory -- it misses several source files and documentation files that reference `BareRunner` or `'none'`, which would leave the codebase in a broken state if the plan were followed as written.

## Strengths

- Clear, well-motivated security reasoning backed by concrete attack vectors from the research
- Correct decision to remove capability at the code level rather than relying on advisory controls
- Implementation approach ordering is sensible (delete code first, then update types, then CLI, then docs)
- Alternatives considered are thorough and each rejection is well-reasoned
- Non-goals are appropriately scoped (not trying to build a fine-grained permission system)

## Concerns

### High

- **Missing file: `src/race.ts`** -- This is the most critical gap. `src/race.ts` imports `BareRunner` directly (line 10) and has a `case 'none'` branch in `createRunnerPool()` (line 72-73). This file is the runner factory used by `src/executor.ts` for all execution paths. If `bare-runner.ts` is deleted without updating `race.ts`, the build will fail. The plan does not mention `race.ts` at all.

- **Missing file: `src/parser.ts`** -- Line 96 hardcodes `'none'` as a valid sandbox flag value: `(sandboxFlag === 'agent' || sandboxFlag === 'docker' || sandboxFlag === 'none')`. If this is not updated, users can still pass `--sandbox none` on the CLI and it will be accepted as a valid `SandboxMode` string, even though the type no longer includes it. TypeScript would catch this at compile time since `SandboxMode` would no longer include `'none'`, but the plan should explicitly list this file.

- **Missing file: `.claude/skills/cook/SKILL.md`** -- This is the installed skill file that agents actually read. It contains `--sandbox none` in nearly every example command (lines 16, 19, 22, 25, 28, 33, 36, 54, 55) and explicitly recommends `--sandbox none` on line 81 and line 95. The plan lists `skill/SKILL.md` as "already correct" but does not mention `.claude/skills/cook/SKILL.md` at all. This installed copy is the one agents use and is full of `--sandbox none` references.

- **Missing file: `SPEC.md` (root level)** -- The plan mentions `tests/SPEC.md` but the root-level `SPEC.md` also contains `--sandbox none` in the CLI help text reference on line 330.

### Medium

- **`src/cli.ts` line 342 reference to `'none'`** -- The plan mentions updating CLI help text and the runner factory branch, but `cmdDoctor()` on line 342 has `if (usedModes.has('agent') || usedModes.has('none'))` which also needs updating. This is easy to miss.

- **No error handling for users passing `--sandbox none`** -- The plan says to remove `'none'` from the type, but does not specify what happens when a user passes `--sandbox none` on the command line. Currently, `parser.ts` would silently ignore an unrecognized value (sandbox becomes `undefined`, falling through to the config default). This is arguably fine behavior, but the plan should be explicit about whether to add a user-facing error message ("unknown sandbox mode 'none'") or silently fall back. A clear error is more helpful for users migrating from `none`.

- **No migration guidance** -- Users with existing `.cook/config.json` files that have `"sandbox": "none"` will silently fall back to `"agent"` (since `isSandboxMode()` will reject `'none'` and the default is `'agent'`). This is safe but silent. The plan should consider whether to log a deprecation warning when `'none'` is encountered in config.

### Low

- **Test files in `tests/runs/`** -- Historical test results reference `--sandbox none` (e.g., `tests/runs/20260318-025400/RESULTS.md`). These are historical records and probably should not be modified, but the plan should acknowledge them as unchanged.

- **Other plan folders** -- Files in `plans/q8r-simplify-native-runner/` and `plans/r7w-review-loop-primitive/` reference `--sandbox none` extensively. These are historical plan documents and should not be modified, but worth noting.

## Suggestions

- Add `src/race.ts` to the implementation plan as a required change. It needs: (1) remove the `BareRunner` import, (2) remove the `case 'none'` branch from `createRunnerPool()`. This is the file that will cause a build failure if missed.

- Add `src/parser.ts` to the plan. Remove `'none'` from the sandbox validation on line 96.

- Add `.claude/skills/cook/SKILL.md` to the plan. This is the installed copy that agents read. Every example needs `--sandbox none` removed. The `skill/SKILL.md` (source copy) is already correct, so this installed copy is out of sync even before this change.

- Consider adding a one-line deprecation warning in `config.ts` when `parsed.sandbox === 'none'`: something like `logWarn('sandbox: "none" is no longer supported, using "agent"')`. This helps users who have existing config files understand why behavior changed.

- Add an explicit note about error handling when `--sandbox none` is passed via CLI flag. The current parser behavior (silently ignoring unknown values) is acceptable but should be a conscious decision.

- Reorder implementation step 4 ("Build and verify") -- this is good practice and should remain, but consider also running the existing test suite (even if tests need updating) to catch any missed references via TypeScript compilation errors.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see concerns/suggestions above)

The high concerns (missing `src/race.ts`, `src/parser.ts`, and `.claude/skills/cook/SKILL.md`) are blockers. Following the plan as written would result in a build failure due to the unresolved `BareRunner` import in `race.ts`. These are straightforward additions to the plan rather than fundamental design issues.
