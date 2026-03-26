# Close COOK.md template gaps

Give users full control over every prompt cook sends to an agent — without making the default template unwieldy. Six gaps were identified where prompts were hidden in TypeScript source or context was unavailable in templates. This PR closes them.

## Changes

1. **New context variables** — `agent`, `model`, `projectName`, `gitBranch`, `branchIndex`, `branchCount`, `resolver` added to `LoopContext` and populated throughout the execution path.

2. **Config-level prompt overrides** — `.cook/config.json` gains a `prompts` section (`review`, `gate`, `iterate`, `judge`, `merge`, `compare`). Priority chain: CLI flag > config.json > hardcoded default.

3. **Updated `DEFAULT_COOK_MD`** — `cook init` now generates a template that documents all available variables in a collapsible `<details>` block. Active template stays under 20 lines.

### Key files

| File | Change |
|------|--------|
| `src/template.ts` | New `LoopContext` fields, updated `DEFAULT_COOK_MD` |
| `src/config.ts` | `prompts` section in `CookConfig`, loaded from config.json |
| `src/executor.ts` | Populate new context vars; use config prompts for review/gate/iterate/merge/compare |
| `src/loop.ts` | Forward new context vars into `LoopContext` |
| `src/race.ts` | Accept optional judge prompt override in `buildJudgePrompt()` |
| `src/cli.ts` | `DEFAULT_COOK_CONFIG_JSON` includes `prompts` section; capture `gitBranch` at session start |

## Test plan

- [ ] `npm run build` passes
- [ ] `cook init` in a fresh dir produces correct defaults with all variables documented
- [ ] `cook doctor` still works
- [ ] A simple `cook "test" review` run completes (no regressions)
- [ ] `cook "test" v2 pick "criteria"` with custom `prompts.judge` in config uses the override
- [ ] Existing COOK.md files without new variables continue to work unchanged
