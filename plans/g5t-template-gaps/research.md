# Research: COOK.md Template Gaps

**Requester:** rj (from REPORT.md exploration, 2026-03-20)
**Date:** 2026-03-20

## Requirements

### Original Request

Address 6 templating gaps found during the COOK.md exploration (see `/REPORT.md`). The goal is to give users full control over every prompt cook sends to agents, without requiring them to read source code.

### Context

Cook's COOK.md templating system is solid for the main work/review/gate loop — all 10 template variables work, escaping is robust, conditionals work, fallbacks are clean. But several prompts bypass the template entirely, and key context is missing from the template variable set.

### Gaps (from REPORT.md)

| # | Gap | Severity |
|---|-----|----------|
| 1 | Composition resolver prompts (judge/merge/compare) bypass COOK.md | Medium |
| 2 | No branch/composition context in template variables | Low |
| 3 | No step-specific template sections | Low |
| 4 | No agent/model info in template variables | Low |
| 5 | No project name or git branch in template variables | Low |
| 6 | Default review/gate prompts hidden from users | Medium |

### Open Questions

- Should composition prompts go through COOK.md, or should they have their own config mechanism (e.g., in `.cook/config.json`)?
- How much complexity is acceptable in COOK.md before it becomes unwieldy?
- Should step-specific sections be a new parser feature, or is the existing conditional approach (`${step === 'review' ? ... : ''}`) sufficient?
- Are there backward-compatibility concerns if DEFAULT_COOK_MD changes (existing projects that rely on the current template)?

## System Architecture

### Related Components

1. **`src/template.ts`** — Template engine: `LoopContext` interface, `renderTemplate()`, `loadCookMD()`, `DEFAULT_COOK_MD`
2. **`src/executor.ts`** — Execution flow: builds `LoopContext`, calls `renderTemplate`, contains `DEFAULT_REVIEW_PROMPT` and `DEFAULT_GATE_PROMPT`, hardcoded merge/compare prompts
3. **`src/loop.ts`** — Review loop: builds `LoopContext` per step, calls `renderTemplate`
4. **`src/race.ts`** — Composition: `JUDGE_PROMPT`, `buildJudgePrompt()`, worktree setup
5. **`src/cli.ts`** — `cook init`: writes `DEFAULT_COOK_MD` to COOK.md
6. **`src/config.ts`** — Config loading from `.cook/config.json`

### Data Flow

```
User CLI input
  → parser.ts (parse flags and AST)
  → executor.ts (build LoopContext, select step handler)
  → template.ts (renderTemplate: COOK.md + LoopContext → final prompt string)
  → runner.ts (send prompt to agent)

Composition path:
  → race.ts (create worktrees, copy .cook/)
  → executor.ts (run branches in parallel)
  → race.ts (hardcoded JUDGE_PROMPT / buildJudgePrompt)  ← bypasses COOK.md
  → executor.ts (hardcoded mergeWorkPrompt / comparePrompt)  ← bypasses COOK.md
```

### Constraints

- COOK.md must remain simple enough for non-programmers to edit
- Backward compatibility: existing COOK.md files (without new sections) must continue to work
- Template rendering uses `new Function()` — adding too many variables increases the parameter list but has no practical performance impact
- Composition prompts need access to run logs/diffs which are large — they may not fit cleanly in a COOK.md template

## Prior Art

- **CLAUDE.md** (Anthropic's Claude Code) — project-level instructions, flat markdown, no templating. Simple but not dynamic.
- **GitHub Actions workflow files** — YAML with `${{ }}` expressions, supports conditionals and context variables
- **Cookiecutter / copier** — project templates with Jinja2, supports conditionals and sections
- **Prompt template libraries** (LangChain, etc.) — variable interpolation with optional sections

### Key Insight from Prior Art

Most template systems separate "structure" from "content" — the template defines where things go, variables fill in the specifics. Cook's current approach is good for the main loop but breaks down for composition because the composition prompts have fundamentally different structure (they include run logs, diffs, comparison tables) that don't fit the work/review/gate pattern.

This suggests composition prompts might be better served by a **separate template mechanism** (e.g., `COOK.md` sections or dedicated files like `.cook/judge.md`) rather than forcing them into the same `LoopContext` + `renderTemplate` flow.
