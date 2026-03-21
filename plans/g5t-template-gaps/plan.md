# Plan: COOK.md Template Gaps

**Status:** Draft
**Author:** AI + rj
**Created:** 2026-03-20

## Summary

Close the 6 templating gaps found during exploration so that every prompt cook sends to an agent is visible and customizable via COOK.md or `.cook/` config files — without making the default template unwieldy.

## Motivation

Users currently have no way to customize the judge, merge, or compare prompts. The default review/gate prompts are hidden in TypeScript source. And agents in composition branches have no awareness of their branch context. Closing these gaps gives users full prompt control.

## Goals

- Every prompt cook sends to an agent can be customized without editing source code
- Default COOK.md remains approachable (under 50 lines)
- Zero breaking changes to existing COOK.md files
- New template variables are opt-in (only appear in output if referenced)

## Non-Goals

- Overhauling the template engine (the `new Function()` approach works fine)
- Adding a full Jinja2/Handlebars-style template language
- Step-specific template sections (Gap 3) — the existing conditional approach works and adding a section parser is over-engineering for now

## Technical Design

### Change 1: Surface default review/gate prompts in COOK.md (Gap 6)

**File:** `src/template.ts` (DEFAULT_COOK_MD), `src/executor.ts`

Add the default review and gate prompts as sections in the generated COOK.md template. These become the actual prompts used when no CLI override is provided.

```markdown
### Review Prompt
${step === 'review' ? prompt : ''}

### Gate Prompt
${step === 'gate' ? prompt : ''}
```

Wait — this is the wrong approach. The `${prompt}` variable already contains the review/gate prompt text. The issue is that users don't *see* what the defaults are.

**Better approach:** Add the default review and gate prompt text as **commented documentation** in the generated COOK.md, plus add them as overridable fields in `.cook/config.json`:

In `DEFAULT_COOK_MD`, add a comment block:
```markdown
<!-- Default prompts (override via --review/--gate flags or .cook/config.json):
  review: "Review the work done in the previous step..."
  gate: "Based on the review, respond with exactly DONE or ITERATE..."
-->
```

In `.cook/config.json`, add optional `prompts` section:
```json
{
  "prompts": {
    "review": null,
    "gate": null,
    "iterate": null
  }
}
```

When non-null, these override the hardcoded defaults in executor.ts. CLI flags still take highest priority.

**Priority chain:** CLI flag > config.json prompt > hardcoded default

### Change 2: Make composition prompts customizable (Gap 1)

**Files:** `src/race.ts`, `src/executor.ts`, `src/config.ts`

Add optional prompt overrides in `.cook/config.json`:

```json
{
  "prompts": {
    "review": null,
    "gate": null,
    "iterate": null,
    "judge": null,
    "merge": null,
    "compare": null
  }
}
```

When `prompts.judge` is set, `buildJudgePrompt()` uses it instead of `JUDGE_PROMPT`. Same for merge and compare.

These prompts are structurally different from loop prompts (they include run logs/diffs), so they should NOT go through COOK.md's `renderTemplate()`. Instead, they're simple string overrides for the preamble/instructions portion, while the run data is still appended programmatically.

**Implementation:**
- `race.ts`: `buildJudgePrompt()` accepts an optional override for the preamble
- `executor.ts`: merge executor reads `config.prompts.merge` for the work prompt preamble
- `executor.ts`: compare executor reads `config.prompts.compare` for the prompt preamble
- `config.ts`: add `prompts` to `CookConfig` interface, load from config.json

### Change 3: Add context variables to LoopContext (Gaps 2, 4, 5)

**Files:** `src/template.ts`, `src/executor.ts`, `src/loop.ts`

Add new optional fields to `LoopContext`:

```typescript
export interface LoopContext {
  // existing fields...

  // Gap 2: Composition context
  branchIndex?: number      // 1-based branch number in vN/vs
  branchCount?: number      // total branches
  resolver?: string         // 'pick' | 'merge' | 'compare' | undefined

  // Gap 4: Agent/model info
  agent?: string            // e.g., 'claude', 'codex'
  model?: string            // e.g., 'opus', 'haiku'

  // Gap 5: Project context
  projectName?: string      // basename of project root
  gitBranch?: string        // current git branch name (original, not worktree branch)
}
```

These are all optional and render as `"undefined"` only if explicitly referenced in COOK.md. The default template won't reference them, so no behavior change for existing users.

**Where to populate:**
- `branchIndex`/`branchCount`/`resolver`: set in `executor.ts` composition execution path, passed through `ExecutionContext`
- `agent`/`model`: already available in step config, just need to pass through to LoopContext
- `projectName`: `path.basename(projectRoot)`
- `gitBranch`: captured **once at session start** in `cli.ts` via `execSync('git branch --show-current')` before any worktrees are created, then propagated as a constant through `ExecutionContext`. In composition worktrees, agents see the user's original branch (e.g., `main`), not the temporary race branch (e.g., `cook-race-abc123-1`).

**Config.json `prompts` semantics:**
- Key absent or `null` → use hardcoded default
- Non-empty string → use as override
- Empty string `""` → treated same as `null` (use default). An empty prompt would be a footgun.

### Change 4: Update DEFAULT_COOK_MD (ties it all together)

The new default template (generated by `cook init`):

```markdown
# COOK.md

## Project Instructions
Add project-specific instructions for the agent here.

## Agent Loop

Step: **${step}** | Iteration: ${iteration}/${maxIterations}

### Task
${prompt}

${lastMessage ? '### Previous Output\n' + lastMessage : ''}

### History
Session log: ${logFile}
Read the session log for full context from previous steps.

<details>
<summary>Template variables and configuration</summary>

Available template variables:
- `${step}` — Current step: work, review, gate, iterate, ralph
- `${prompt}` — The prompt for this step
- `${lastMessage}` — Output from the previous step
- `${iteration}` — Current iteration (1-based)
- `${maxIterations}` — Max iterations for this loop
- `${logFile}` — Path to session log
- `${agent}` — Agent running this step (claude, codex, opencode)
- `${model}` — Model for this step
- `${projectName}` — Project directory name
- `${gitBranch}` — Current git branch

Loop context (when applicable):
- `${ralphIteration}` — Current ralph task number
- `${maxRalph}` — Total ralph tasks
- `${repeatPass}` — Current repeat pass number
- `${maxRepeatPasses}` — Total repeat passes
- `${branchIndex}` — Branch number in vN/vs composition
- `${branchCount}` — Total branches in composition
- `${resolver}` — Composition resolver (pick/merge/compare)

Default review/gate/iterate prompts can be overridden in `.cook/config.json`.
Composition prompts (judge/merge/compare) can also be overridden there.

</details>
```

This keeps the active template under 20 lines while documenting everything in a collapsible `<details>` block that renders cleanly in GitHub, VS Code, and most markdown viewers. Existing COOK.md files without the details block still work fine.

## Implementation Approach

Order matters — each change is independently shippable:

1. **Change 3 first** (add context variables) — pure addition to LoopContext, no behavior change, lowest risk
2. **Change 1 second** (surface defaults in config.json) — adds `prompts` to config, plumbs through executor
3. **Change 2 third** (composition prompt overrides) — depends on the config.json `prompts` structure from Change 1
4. **Change 4 last** (update DEFAULT_COOK_MD) — incorporates all new variables and documents the config options

### Key Files to Modify

| File | Changes |
|------|---------|
| `src/template.ts` | Add fields to `LoopContext`, update `DEFAULT_COOK_MD` |
| `src/config.ts` | Add `prompts` to `CookConfig`, load from config.json |
| `src/executor.ts` | Populate new context vars, use config prompts for defaults, pass composition context |
| `src/loop.ts` | Accept and forward new context vars |
| `src/race.ts` | Accept optional judge prompt override in `buildJudgePrompt()` |
| `src/cli.ts` | Update `DEFAULT_COOK_CONFIG_JSON` to include `prompts` section |

### Testing

Each change should be verified by:
1. `npm run build` passes
2. `cook init` in a fresh dir produces correct defaults
3. `cook doctor` still works
4. Template rendering tests (from REPORT.md test suite) still pass
5. A simple `cook "test" review` run completes successfully
6. For Change 2: `cook "test" v2 pick "criteria"` with custom judge prompt in config

## Alternatives Considered

### Alternative: Section-based COOK.md parsing (Gap 3)

A pre-processor that extracts `## Work Instructions`, `## Review Instructions`, etc. and only injects the matching section. Rejected because:
- Adds parser complexity for marginal benefit
- The conditional approach (`${step === 'review' ? '...' : ''}`) already works
- Users who need per-step customization are advanced enough to use conditionals

### Alternative: Composition prompts through renderTemplate

Route judge/merge/compare prompts through COOK.md like loop prompts. Rejected because:
- These prompts include run logs/diffs (potentially 100KB+) that would need to be template variables
- The structure is fundamentally different (comparison table, not work/review/gate)
- Config.json overrides are simpler and sufficient

### Alternative: Separate template files per prompt type

`.cook/judge.md`, `.cook/merge.md`, `.cook/compare.md` as standalone templates. Rejected because:
- File proliferation in `.cook/`
- Overkill for what is essentially a string override
- Config.json is already the natural home for this
