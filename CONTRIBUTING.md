# Contributing

A Research-Plan-Implement (RPI) workflow for AI-assisted software development with human-in-the-loop checkpoints. This document serves as a reference for both AIs and humans, ensuring quality through structured research, planning, and implementation phases, each with AI self-review and human approval gates.

Learn about the theory behind RPI from Dax: https://www.youtube.com/watch?v=rmvDxxNubIg

All work for a feature or change happens in a dedicated plan folder (e.g., `plans/a7z-feature-name/`). Each plan folder has a corresponding git branch and pull request, keeping code changes tied to their documentation.

## Workflow

Each step is labeled as **[entity]:[task]** where entity is either `AI` or `Human`, and task describes the action. Each `AI:` step should start a fresh session with context limited to the relevant plan folder files. This practice of scoping AI context to specific artifacts is called **Context Engineering**—it keeps sessions focused and prevents context pollution across phases.

1. **Research**
   - **AI:Work** Write research.md detailing requirements, system architecture, and exploring decisions
   - **AI:Review** Write research-review-NNN.md
   - **AI:Gate** Needs revision? If yes, go back to 1:AI:Work, else continue
   - **Human:Review** Approve research findings and decisions before proceeding to Plan

2. **Plan**
   - **AI:Work** Write plan.md detailing the changes we plan to make given decisions in research.md
   - **AI:Review** Write plan-review-NNN.md
   - **AI:Gate** Needs revision? If yes, go back to 2:AI:Work, else continue
   - **Human:Review** Approve plan before proceeding to Implement

3. **Implement**
   - **AI:Work** Implement the plan.md (or plan-NNN.md if revising) and then write devlog-NNN.md covering what was done, tricky, and decisions made during implementation
   - **AI:Review** Review the implementation in a code-review-NNN.md
   - **AI:Gate** Needs revision? If yes, write plan-NNN.md and go back to 3:AI:Work, else write pr.md and continue
   - **Human:Review** Final approval of implementation


## Plan Structure

File/folder naming conventions:
- XXX = 3-char alphanumeric code (e.g., `a7z`, `k3p`; avoid sequential or word-like codes)
- name = kebab-case (e.g., `foo-bar`)
- NNN = 3-digit number, zero-padded, for versioning iterations (e.g., `001`, `002`)

Location: `plans/XXX-name/`
Files:
- `research.md` - Requirements, system architecture, constraints, prior art
- `research-review-NNN.md` - AI self-review of research findings
- `plan.md` - Main spec with motivation, goals, design, and implementation approach
- `plan-review-NNN.md` - AI self-review when iterating on plan
- `decision-XXX-name.md` - Optional ADR-style decisions as needed
- `devlog-NNN.md` - Implementation journal: what was done, tricky parts, decisions made
- `code-review-NNN.md` - AI self-review when iterating on code during implementation
- `pr.md` - PR description: summary paragraph, code walkthrough, test instructions

## Prompts

### 1:AI:Work (Research)
```
Read CONTRIBUTING.md for context. You are starting research for [feature/task].

Requirements: [paste requirements or link to issue]

Write research.md covering requirements, system architecture, constraints, prior art, and open questions.
```

### 1:AI:Review (Research Review)
```
Read CONTRIBUTING.md for context. Review research.md and write research-review-NNN.md following the template.
```

### 1:AI:Gate (Research Gate)
```
Read CONTRIBUTING.md for context. Read research.md and research-review-NNN.md. Are there any High gaps or unresolved questions? If yes, summarize what needs revision. If no, confirm ready for human review.
```

### 2:AI:Work (Plan)
```
Read CONTRIBUTING.md for context. Read research.md for decisions and context.

Write plan.md detailing the implementation approach.
```

### 2:AI:Review (Plan Review)
```
Read CONTRIBUTING.md for context. Review plan.md against research.md and write plan-review-NNN.md following the template.
```

### 2:AI:Gate (Plan Gate)
```
Read CONTRIBUTING.md for context. Read plan.md and plan-review-NNN.md. Are there any High concerns? If yes, summarize what needs revision. If no, confirm ready for human review.
```

### 3:AI:Work (Implement)
```
Read CONTRIBUTING.md for context. Read plan.md (or plan-NNN.md if revising).

Implement the plan. When done, write devlog-001.md covering what was done, tricky parts, and any decisions made.
```

### 3:AI:Review (Code Review)
```
Read CONTRIBUTING.md for context. Review the implementation against plan.md and write code-review-NNN.md following the template.
```

### 3:AI:Gate (Code Gate)
```
Read CONTRIBUTING.md for context. Read devlog-NNN.md and code-review-NNN.md. Are there any High issues? If yes, write plan-NNN.md with fixes needed. If no, write pr.md and confirm ready for human review.
```

## Templates

### research.md
```markdown
# Research: [Brief Title]

**Requester:** [Who asked]
**Date:** [Date]

## Requirements

### Original Request
[The ask verbatim or paraphrased]

### Context
[Context that came with the request]

### Open Questions
- [Questions to explore]

## System Architecture

### Related Components
[Overview of existing systems this feature touches]

### Data Flow
[How data moves through the relevant systems]

### Constraints
[Technical or business constraints to consider]

## Prior Art
[Similar implementations, patterns, or references]
```

### plan.md
```markdown
# Plan: [Feature Name]

**Status:** Draft | In Review | Approved | Implemented
**Author:** [Name]
**Created:** [Date]

## Summary
[One paragraph]

## Motivation
[Why is this needed?]

## Goals
- [What this achieves]

## Non-Goals
- [What this does not address]

## Technical Design
[Detailed approach]

## Implementation Approach
[Step-by-step implementation plan, key files to modify, order of operations]

## Alternatives Considered
[Other approaches and why not chosen]
```

### decision-XXX-name.md
```markdown
# Decision: [Brief Title]

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** [Date]
**Deciders:** [Who made the decision]

## Context
[What is the situation? What problem or question prompted this decision?]

## Options

### Option 1: [Name]
[Brief description]

**Pros:**
- [Advantage]

**Cons:**
- [Disadvantage]

### Option 2: [Name]
[Brief description]

**Pros:**
- [Advantage]

**Cons:**
- [Disadvantage]

## Decision
[Which option was chosen and why]

## Consequences
### Positive
- [Benefits of this decision]

### Negative
- [Drawbacks or tradeoffs]

### Neutral
- [Other effects]
```

### research-review-NNN.md
```markdown
# Research Review: [Brief Title]

**Reviewer:** AI
**Date:** [Date]
**Reviewing:** research.md

## Summary
[One paragraph assessment of the research]

## Strengths
- [What the research does well]

## Gaps

### High
- [Critical missing information that blocks planning]

### Medium
- [Important gaps that should be addressed]

### Low
- [Nice-to-have information]

## Questions
- [Clarifications needed before planning]

## Recommendation
[ ] Ready for human review
[ ] Needs revision (see gaps/questions above)
```

### plan-review-NNN.md
```markdown
# Plan Review: [Brief Title]

**Reviewer:** AI
**Date:** [Date]
**Reviewing:** plan.md (or plan-NNN.md)

## Summary
[One paragraph assessment of the plan]

## Strengths
- [What the plan does well]

## Concerns

### High
- [Critical issues that could cause failure]

### Medium
- [Significant risks or unclear areas]

### Low
- [Minor issues or suggestions]

## Suggestions
- [Improvements or alternatives to consider]

## Recommendation
[ ] Ready for human review
[ ] Needs revision (see concerns/suggestions above)
```

### devlog-NNN.md
```markdown
# Devlog: [Brief Title]

**Date:** [Date]
**Implementing:** plan.md (or plan-NNN.md)

## What Was Done
- [Completed work]

## Tricky Parts
- [Challenges encountered and how they were resolved]

## Decisions Made
- [Implementation decisions not covered in the plan]

## Deviations from Plan
- [Any changes from the original plan and why]

## Next Steps
- [If incomplete, what remains]
```

### code-review-NNN.md
```markdown
# Code Review: [Brief Title]

**Reviewer:** AI
**Date:** [Date]
**Reviewing:** [commit hash or file list]

## Summary
[One paragraph assessment of the implementation]

## What Works Well
- [Positive aspects of the code]

## Issues

### High
- [ ] [Critical bugs or security issues]

### Medium
- [ ] [Significant problems that should be fixed]

### Low
- [ ] [Minor improvements or style issues]

## Questions
- [Clarifications or design questions]

## Recommendation
[ ] Ready for human review
[ ] Needs revision (see issues above)
```

### pr.md
````markdown
# [PR Title]

[One paragraph: what changed and why]

## Architecture

```mermaid
[Diagram showing key components and data flow]
```

## Decisions
1. [list of decisions made during planning, one paragraph each]

## Code Walkthrough
1. [Recommended order of reading through code]

## Testing Instructions
1. [Steps to test]
````
