# Contributing

This guide covers the development workflow for contributing to this project.

## Lifecycle Stages

1. **Research** - Create a plan folder; write research.md with requirements, system architecture, and open questions
2. **Plan** - Write decision-XXX.md file(s) based on open questions; write plan.md; write plan-review-XXX.md and iterate on plan
3. **Implement** - Write code and then summarize in devlog-XXX.md; write code-review-XXX.md and iterate on code; update main spec and write pr.md; create PR and iterate on peer feedback

## Plan Structure

Location: `spec/plans/XXX-name/`
- XXX = 3-char alphanumeric code (e.g., `a7z`, `k3p`; avoid sequential or word-like codes)
- name = kebab-case (e.g., `cool-feature`)

Files:
- `research.md` - Requirements, system architecture, constraints, prior art
- `decision-XXX-name.md` - ADR-style decisions as needed
- `plan.md` - Main spec with motivation, goals, design, and implementation approach
- `plan-review-XXX.md` - Reviews when iterating on plan
- `devlog-XXX.md` - A summary of what was implemented, what was tricky, and decisions made not covered in plan.md
- `code-review-XXX.md` - Reviews when iterating on code during implementation
- `pr.md` - PR description: summary paragraph, code walkthrough, test instructions

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

### devlog.md
```markdown
# Devlog - [datetime]

[summary of changes]

## Tricky parts

[summary of various parts that seemed particularly tricky]

## Decision made during implementation

### [decision description]

[summary of decision with options concsidered]
```

### pr.md
```markdown
# [PR Title]

[One paragraph: what changed and why]

## Decisions
1. [list of decisions made during planning, one paragraph each]

## Code Walkthrough
1. [Recommended order of reading through code]

## Testing Instructions
1. [Steps to test]
```
