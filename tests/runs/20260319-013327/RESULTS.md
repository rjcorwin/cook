# Test Results — No-Code Skill

Run: 2026-03-19 01:33
Mode: no-code skill (skill-pure/SKILL.md)
Agent: claude:opus orchestrating subagents

## Summary

| Test | Result | Notes |
|------|--------|-------|
| Work (plain) | PASS | Single subagent, created todo app |
| Review loop | PASS | work→review→gate cycle, gate returned DONE correctly |
| Repeat x3 | PASS | 3 sequential subagents, each refining previous work |
| Race v3 pick | PARTIAL PASS | Orchestration worked but worktree isolation failed |

**3/4 PASS, 1 PARTIAL PASS**

## Detailed results

### Work — PASS

Spawned single subagent to create todo app. Completed in ~33s. File created correctly.

### Review loop — PASS

Full work→review→gate cycle via 3 separate subagents:
1. Work subagent: added dark mode toggle (34s)
2. Review subagent: found 2 Medium, 5 Low issues, no High (31s)
3. Gate subagent: correctly evaluated "no High issues" → DONE (16s)

The review was genuinely useful — found FOUC, missing placeholder styles, and Date.now() collision risk. The gate correctly applied the severity threshold.

### Repeat x3 — PASS

3 sequential subagents, each building on the previous:
- Pass 1/3: layout, spacing, typography (53s)
- Pass 2/3: colors, contrast, visual hierarchy (68s)
- Pass 3/3: micro-interactions, animations, cohesion (135s)

Each pass was contextually aware of the previous state and made distinct improvements.

### Race v3 pick — PARTIAL PASS

Orchestration pattern worked correctly:
- 3 subagents launched in parallel (single message, all ran concurrently)
- Judge subagent compared the 3 approaches and picked branch 3
- Reasoning was specific and criteria-based

**Bug:** `isolation: "worktree"` creates worktrees of the *current repo* (cook), not the target project (todo-nocode-test). All 3 agents modified the same index.html directly rather than working in isolated branches. The merge step couldn't work because there were no separate branches to merge.

**Impact:** Race/vs/composition operators don't work in the no-code skill as currently designed. The Agent tool's worktree isolation is scoped to the repo where Claude Code is running, not to an arbitrary project directory.

**Possible fix:** The skill could instruct the agent to manually create git branches and worktrees in the target project via Bash commands, rather than relying on the Agent tool's `isolation` parameter.

## Findings

### What works well
- Simple patterns (work, review, repeat) work reliably as pure subagent orchestration
- Review quality is good — subagents in fresh contexts avoid confirmation bias
- Gate decisions are accurate — severity thresholds applied correctly
- Status updates from the orchestrator provide visibility

### What doesn't work
- Composition operators (race, vs) need git-level isolation that the Agent tool's `isolation: "worktree"` doesn't provide for external projects
- The skill needs a mechanism for creating and merging branches in the target project

### Recommendation
The no-code skill should be marked as supporting: work, review, repeat, ralph. Composition operators (race, vs, pick, merge, compare) should be marked as not yet supported or require manual branch setup.
