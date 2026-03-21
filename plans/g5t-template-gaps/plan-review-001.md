# Plan Review: COOK.md Template Gaps

**Reviewer:** AI
**Date:** 2026-03-20
**Reviewing:** plan.md

## Summary

The plan is well-scoped and pragmatic. It addresses all 6 gaps with 4 changes, each independently shippable. The decision to use config.json for composition prompts rather than forcing them through COOK.md is the right call. The non-goal of skipping step-specific sections (Gap 3) is well-reasoned.

## Strengths

- Clear priority chain for prompt resolution (CLI flag > config.json > hardcoded default)
- Changes are ordered by risk (context vars first, then config, then composition, then template update)
- Default COOK.md stays under 20 active lines with documentation in comments
- Zero breaking changes — existing COOK.md files continue to work
- Each change is independently shippable and testable

## Concerns

### High

- None

### Medium

- ~~**`gitBranch` in composition worktrees**~~ — **Addressed in plan revision:** `gitBranch` is now captured once at session start before worktree creation, propagated as constant through ExecutionContext.

- ~~**Config.json `prompts` as `null` vs absent**~~ — **Addressed in plan revision:** Semantics clarified — absent/null/empty string all mean "use default"; non-empty string is an override.

### Low

- ~~HTML comment block in DEFAULT_COOK_MD~~ — **Addressed in plan revision:** Switched to `<details>` block, which renders cleanly in GitHub/VS Code/most viewers.

- The `projectName` variable (Gap 5) is `path.basename(projectRoot)` which could be a generic name like `app` or `src`. Limited utility, but low cost to include. *(Accepted — not worth removing.)*

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns/suggestions above)
