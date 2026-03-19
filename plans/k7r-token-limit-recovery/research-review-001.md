# Research Review: Token Limit Recovery

**Reviewer:** AI
**Date:** 2026-03-19
**Reviewing:** research.md

## Summary
The research covers the error propagation path through cook's architecture, identifies the key bail-out points, and proposes three options for where to insert retry logic. The analysis is grounded in actual code locations and considers multi-agent and composition constraints.

## Strengths
- Clear mapping of the error flow from subprocess exit → runner rejection → loop/executor bail
- Identifies all call sites that would need changes
- Option C (hybrid wrapper) is well-reasoned as the best approach
- Correctly notes that partial output/git state is preserved on failure

## Gaps

### High
- None — the core question (where does it fail, where to fix it) is well-answered

### Medium
- Exact error signatures for Claude Code, Codex, and OpenCode in `-p` mode are listed as "to investigate" rather than confirmed. This is acceptable since the implementation can start with broad pattern matching and be refined.
- No discussion of how the no-code skill (SKILL.md) would handle this — it uses subagent orchestration, not subprocess spawning. Rate limits there would manifest differently (the parent agent itself might get limited).

### Low
- The 5-hour reset window is specific to Claude's free/Pro tier — other tiers and other agents may have different windows. The polling approach handles this naturally.

## Questions
- Should the no-code skill path also be addressed, or is this CLI-only?
- Is there a way to query remaining quota from Claude Code CLI (e.g., `claude --status`)?

## Recommendation
[x] Ready for human review
[ ] Needs revision (see gaps/questions above)
