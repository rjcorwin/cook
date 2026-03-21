# Research Review: No-Code Skill Eval

**Reviewer:** AI
**Date:** 2026-03-21
**Reviewing:** research.md

## Summary

The research correctly identifies the core challenge (evaluating prompt-following fidelity, not code quality) and catalogs the observable behaviors that form the basis of the eval. The open questions are the right ones. The main gap is that the research doesn't yet propose answers to the open questions — they need human input to resolve before planning can begin.

## Strengths

- Clear distinction between CLI tests (deterministic code) and this eval (prompt-following fidelity)
- "Right process, not right answer" framing is precise and actionable
- Known + suspected failure modes give the eval concrete targets
- Observable behavior table maps each check to its tool/output source

## Gaps

### High

- **Transcript capture is unresolved (Q1).** The entire eval depends on being able to inspect what Claude did. Without a concrete answer to how we capture and parse transcripts, we can't design the grading system. This is the single biggest blocker.
- **No decision on real vs mock work (Q4).** This fundamentally changes the eval's scope, cost, and timeline. A mock-only eval (just test parsing) could ship in a day. A real-execution eval needs infrastructure.

### Medium

- **No exploration of Claude Code session log format.** Q1 asks "can we parse tool calls from session logs?" but doesn't investigate what's actually in `~/.claude/projects/*/sessions/*/`. If structured JSONL with tool calls exists, the grading problem is largely solved.
- **Cost/time estimates are rough.** "50+ agent calls" and "30-60 minutes" are ballpark. Per-category cost estimates would help prioritize which categories to build first.
- **No discussion of whether SKILL.md itself needs changes.** If the eval reveals that Claude consistently fails at worktree setup, the fix might be improving SKILL.md, not just documenting the failure. The eval should feed back into skill improvement.

### Low

- **Multi-model testing (Q6) is nice-to-have but not MVP.** Start with Opus (the model the skill was designed for), expand later.
- **Statistical significance (Q7) can be deferred.** Start with 1 run per test to get directional signal. Add runs once the infrastructure exists.

## Questions

- Does the user want a fully automated eval (CI-style, runs on every SKILL.md change) or a manual eval (run occasionally to check quality)?
- Is the premature DESIGN.md in `no-code/eval/` intended to stay, or should it be replaced by whatever comes out of this plan?
- Has the user observed any failure modes beyond worktree creation? The more observed failures we bake in, the more targeted the eval.

## Recommendation

[x] Needs revision (see gaps/questions above)
[ ] Ready for human review

The high gaps (transcript capture, real vs mock) need human decisions before we can plan. Recommend the user weigh in on the open questions, then revise research.md with those decisions before moving to plan.md.
