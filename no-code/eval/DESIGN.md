# No-Code Skill Eval Design

## Goal

Grade Claude on how faithfully it follows `SKILL.md` as a deterministic orchestrator. We're not evaluating the quality of generated code — we're evaluating whether the **orchestration behavior** matches the spec. Every instruction in SKILL.md is a testable contract.

## What makes this hard

The no-code skill turns Claude into an interpreter of a mini-language. An interpreter should be deterministic: same input → same execution sequence. But Claude is a language model, so it will:

- Improvise (add steps not in the spec)
- Skip steps (forget cleanup, skip confirmation)
- Misparse (wrong operator precedence, wrong defaults)
- Conflate (merge two patterns into one)
- Over-help (do work itself instead of delegating)

The eval surfaces these failure modes systematically.

## Eval structure

Each test case is a **scenario** with:
1. **Input** — the `/cook` command
2. **Expected behavior** — a checklist of observable actions
3. **Grading** — binary per-checklist-item, scored as fraction

### Grading method

Run the scenario, capture the full transcript (all tool calls and text output). A grader (human or Claude) evaluates each checklist item as PASS/FAIL from the transcript.

**Score per test** = passed items / total items
**Overall score** = mean across all tests

## Test categories

### Category 1: Parsing → Plan confirmation

Tests whether Claude correctly parses the grammar and confirms the right plan before executing. These are fast — no actual execution needed. Just check the confirmation message.

| # | Input | Expected plan confirmation |
|---|-------|--------------------------|
| 1.1 | `"Add tests" review` | Review loop, max 3 iterations. Work prompt: "Add tests" |
| 1.2 | `"Add tests" review 5` | Review loop, max 5 iterations |
| 1.3 | `"Add tests" x3` | 3 repeat passes |
| 1.4 | `"Add tests" x3 review` | 3 repeat passes, then a review loop |
| 1.5 | `"Add tests" review x3` | Review loop repeated 3 times |
| 1.6 | `"Add tests" v3 pick "cleanest"` | Race 3, pick best by "cleanest" |
| 1.7 | `"A" vs "B" pick "best"` | Two approaches (A and B), pick by "best" |
| 1.8 | `"Next" ralph 5 "DONE if all done"` | Task-list progression, max 5 tasks, gate prompt specified |
| 1.9 | `"A" review vs "B" x3 merge "combine"` | Two branches: A with review loop, B with 3 passes. Merge resolver. |
| 1.10 | `"Add tests"` | Plain work, no operators |

**Checklist per test:**
- [ ] Confirms plan before executing (asks user to proceed)
- [ ] Work prompt correctly identified
- [ ] Operators correctly parsed (type, order, parameters)
- [ ] Composition direction correct (left-to-right wrapping)
- [ ] Default values applied correctly (e.g., review defaults to max 3)

### Category 2: Delegation (does it use subagents?)

The cardinal rule: "You do not do the work directly — you delegate to subagents." Test that Claude spawns Agent() calls instead of editing files itself.

| # | Input | Key check |
|---|-------|-----------|
| 2.1 | `"Add a button to index.html"` | Work done via Agent(), not direct Edit/Write |
| 2.2 | `"Fix the bug" review` | Work AND review both done via Agent() |
| 2.3 | `"Fix the bug" v3 pick "best"` | All 3 branches done via parallel Agent() calls |

**Checklist per test:**
- [ ] Orchestrator never uses Edit/Write/Bash to modify project files
- [ ] All work dispatched via Agent() tool calls
- [ ] Agent prompts include the work prompt
- [ ] Review agents instructed to use `git diff`

### Category 3: Review loop fidelity

Tests the work→review→gate cycle.

| # | Scenario | Key checks |
|---|----------|------------|
| 3.1 | `"Add feature" review` — review finds no high-severity issues | Gate decision: DONE. Loop stops after 1 work + 1 review. |
| 3.2 | `"Add feature" review` — review finds high-severity issue | Gate decision: ITERATE. Next work agent gets feedback from review. |
| 3.3 | `"Add feature" review` — 3 iterations, never resolves | Stops at max iterations with a message about hitting the limit. |
| 3.4 | `"Add feature" review 5` | Max iterations is 5, not 3. |
| 3.5 | `"Add feature" review "Check X" "DONE if X, else ITERATE"` | Custom review and gate prompts used verbatim. |

**Checklist per test:**
- [ ] Work agent spawned first
- [ ] Review agent spawned after work completes
- [ ] Gate decision made by orchestrator (not a separate agent)
- [ ] DONE/ITERATE decision matches the spec's severity logic
- [ ] On ITERATE: feedback from review included in next work prompt
- [ ] On max iterations: stops with appropriate message
- [ ] Status updates given at each milestone

### Category 4: Repeat (xN) fidelity

| # | Scenario | Key checks |
|---|----------|------------|
| 4.1 | `"Polish CSS" x3` | 3 sequential Agent() calls. Each sees state from previous. |
| 4.2 | `"Polish CSS" repeat 3` | Same as x3 — alias works. |

**Checklist per test:**
- [ ] Exactly N work agents spawned
- [ ] Sequential (not parallel)
- [ ] Status update after each pass: "Pass N/3 complete"

### Category 5: Race/vs fidelity

This is the most complex pattern and the most likely to break.

| # | Scenario | Key checks |
|---|----------|------------|
| 5.1 | `"Add stats" v3 pick "cleanest"` | 3 worktrees created, 3 parallel agents, pick resolves |
| 5.2 | `"A" vs "B" pick "best"` | 2 worktrees, different prompts, pick resolves |
| 5.3 | `"A" vs "B" merge "combine"` | Merge agent synthesizes instead of picking |
| 5.4 | `"A" vs "B" compare` | Comparison doc written, no merge |

**Checklist per test:**
- [ ] Git worktrees created with correct naming (`cook-race-{session}-{i}`)
- [ ] Branches created before worktrees
- [ ] All branch agents spawned in a **single message** (parallel)
- [ ] Each agent told to work in its worktree directory
- [ ] For `vs`: each branch gets its own prompt
- [ ] Resolver agent spawned after all branches complete
- [ ] For `pick`: diffs compared, winner merged via `git merge`
- [ ] For `merge`: synthesis agent creates new implementation
- [ ] For `compare`: doc written, no merge
- [ ] Worktrees and branches cleaned up after resolution

### Category 6: Composition correctness

The hardest category. Tests that operators compose left-to-right correctly.

| # | Input | Expected behavior |
|---|-------|-------------------|
| 6.1 | `"Fix" x3 review` | Inner: 3 sequential passes. Outer: review loop wraps the whole thing. |
| 6.2 | `"Fix" review x3` | Inner: review loop. Outer: repeat that 3 times. |
| 6.3 | `"Fix" review v3 pick "best"` | Inner: review loop. Outer: race 3 branches each running a review loop. |

**Checklist per test:**
- [ ] Inner pattern executes correctly
- [ ] Outer pattern wraps inner correctly
- [ ] Not confused (e.g., `x3 review` ≠ `review x3`)

### Category 7: Ralph fidelity

| # | Scenario | Key checks |
|---|----------|------------|
| 7.1 | Basic ralph: `"Do next task" ralph 3 "DONE if all done, else NEXT"` | Work, gate, loop on NEXT. Stop on DONE or max. |
| 7.2 | Ralph + review: `"Do next task" review ralph 3 "gate prompt"` | Each task gets review loop, then ralph gate. |

**Checklist per test:**
- [ ] Work executed (inner pattern)
- [ ] Ralph gate agent spawned after inner completes
- [ ] DONE → stops, NEXT → continues
- [ ] Respects max task count

### Category 8: Status updates

Cross-cutting: test that status messages appear at the right milestones.

**Expected messages** (from SKILL.md):
- [ ] "Starting review loop (max N iterations)"
- [ ] "Iteration N: work complete, reviewing..."
- [ ] "Gate: ITERATE — starting iteration N with feedback"
- [ ] "Gate: DONE — review loop complete"
- [ ] "Racing N branches..."
- [ ] "All branches complete. Comparing diffs..."
- [ ] "Picked branch N. Merging..."
- [ ] "Ralph task N/M: complete. Gate: NEXT/DONE"
- [ ] "Pass N/M complete" (for repeat)

## Running the eval

### Prerequisites

- A repo with at least one file (e.g., `index.html`)
- Git initialized with at least one commit
- The no-code skill installed in `.claude/skills/cook/SKILL.md`

### Execution

For each test case:

1. Start a fresh Claude Code session
2. Send the `/cook` input
3. Capture the full transcript (tool calls + text)
4. Grade against the checklist

### Automation options

**Option A: Human grading.** Run each test, manually check the transcript. Slow but accurate.

**Option B: Claude-as-grader.** Feed the transcript + checklist to another Claude instance and ask it to grade each item PASS/FAIL with evidence. Fast but needs calibration.

**Option C: Tool-call analysis.** Parse the transcript programmatically. Count Agent() calls, check for Edit/Write calls from the orchestrator, verify git commands. Most objective but doesn't catch nuance (e.g., "was feedback included in the next prompt?").

**Recommended: B + C combined.** Programmatic checks for objective items (agent count, tool call types, git commands), Claude-as-grader for subjective items (plan confirmation quality, feedback inclusion, status message accuracy).

## Expected failure modes

Based on the skill design, these are the likely weak spots:

1. **Does work itself** — instead of delegating to Agent(), directly edits files. Most common failure.
2. **Skips confirmation** — jumps straight to execution without confirming the plan.
3. **Wrong composition** — `x3 review` treated same as `review x3`.
4. **Parallel as sequential** — race branches spawned one at a time instead of all in one message.
5. **Forgets cleanup** — worktrees and branches left behind after race.
6. **Gate logic wrong** — uses a separate agent for gate instead of deciding itself.
7. **Missing status updates** — executes correctly but silently.
8. **Review feedback lost** — on ITERATE, doesn't pass review feedback to next work agent.
9. **Wrong defaults** — review doesn't default to max 3, or pick isn't the default resolver.
10. **Improvises operators** — invents steps not in the spec (e.g., "let me also run tests").

## Scoring

| Grade | Score | Meaning |
|-------|-------|---------|
| A | 90-100% | Near-deterministic. Follows spec reliably. |
| B | 75-89% | Mostly correct. Minor deviations (e.g., missing status updates). |
| C | 60-74% | Functional but sloppy. Skips steps, wrong defaults. |
| D | 40-59% | Partially broken. Major pattern errors. |
| F | <40% | Does not follow the spec. |

## Next steps

1. Build a minimal test harness (repo setup, transcript capture)
2. Run Category 1 (parsing) first — cheapest, fastest signal
3. Run Category 2 (delegation) — most critical correctness check
4. Run Categories 3-7 — full execution fidelity
5. Aggregate scores, identify failure patterns
6. Iterate on SKILL.md to fix systematic failures
