# Research: No-Code Skill Eval

**Requester:** rjcorwin
**Date:** 2026-03-21

## Requirements

### Original Request

Design an eval for the no-code skill. Grade Claude on how well it follows the instructions as if it was a deterministic system. See where it falls down.

### Context

The no-code skill (`no-code/SKILL.md`) turns Claude into an interpreter of a mini orchestration language. Unlike the CLI version (which enforces behavior through code), the no-code version relies entirely on Claude following written instructions. This makes it inherently non-deterministic — the eval quantifies how far from deterministic it actually is.

A known failure has already been observed: Claude failing to create git worktrees correctly during race/vs operations.

### Open Questions

1. **How do we capture transcripts?** Claude Code doesn't have a built-in transcript export. Options:
   - Parse `~/.claude/projects/*/sessions/*/` JSONL files (if they exist and contain tool calls)
   - Use the Claude API directly (not Claude Code) to get structured tool-call logs
   - Screen-scrape / manual observation
   - Build a thin wrapper that logs all tool calls
   - **Does Claude Code on the web have session logs we can access?**

2. **What's the unit of evaluation?** Options:
   - Grade the full end-to-end run (realistic but noisy — one early failure cascades)
   - Grade individual phases independently (parsing, setup, execution, cleanup — more diagnostic but requires phase isolation)
   - Both: phase-level scores that roll up to an overall score

3. **How do we handle non-determinism in reviews?** The review loop's gate decision depends on what the review agent finds, which depends on what the work agent produced. Two runs of the same test may take different iteration counts. This is expected and correct. The eval should test the *structure* (did it loop? did it pass feedback?) not the *count* (did it take exactly 2 iterations?).

4. **Should we test with real work or mock work?** Options:
   - **Real work:** `/cook "Add a button" review` — tests the full system but slow, expensive, and noisy (work quality affects review outcomes)
   - **Mock/dry-run:** Ask Claude to explain what it *would* do step-by-step given the input — tests parsing and plan generation cheaply, but doesn't test actual execution
   - **Minimal real work:** Use a trivially simple repo (single empty file) so work agents finish fast and the orchestration is the bottleneck
   - **Hybrid:** Mock for parsing tests (Category 1), real for execution tests (Categories 2-7)

5. **How do we grade programmatically?** The key observable is the sequence of tool calls Claude makes. If we can extract tool calls from the transcript:
   - Count Agent() calls (right number of subagents?)
   - Check for Edit/Write calls from orchestrator (should be none — delegation check)
   - Check Bash calls for correct git commands in correct order
   - Check text output for status messages
   - But: can we reliably parse tool calls from Claude Code session logs?

6. **What models do we test?** The no-code skill could be used with any Claude model. Eval across:
   - Opus (expected best — most instruction-following)
   - Sonnet (likely production default — cost/quality tradeoff)
   - Haiku (stress test — will it even work?)
   - Does performance vary significantly by model? This is a key finding.

7. **How many runs per test case for statistical significance?** LLM outputs vary. A single run might pass or fail by luck. Options:
   - 1 run (fast, cheap, noisy)
   - 3 runs (minimum for spotting flaky behavior)
   - 5+ runs (real statistical power, but expensive)

8. **Where does the eval live and how is it run?** Options:
   - Manual: human runs each test, grades by reading transcript
   - Semi-auto: script sets up repo, triggers Claude Code, human grades
   - Full auto: script runs everything including grading (needs API access, not Claude Code CLI)
   - Cook itself: use `/cook` CLI to orchestrate the eval runs (meta but practical)

## System Architecture

### What we're evaluating

The no-code skill (`no-code/SKILL.md`) is a ~180-line prompt that instructs Claude to:

1. **Parse** a mini-language grammar (operators, composition)
2. **Confirm** the plan with the user before executing
3. **Execute** patterns using Agent() tool calls, Bash for git, and text for status
4. **Clean up** git worktrees and branches after race/vs

### Observable behavior (what the eval checks)

All eval signal comes from the **tool call sequence** and **text output** in the transcript:

| Observable | Tool/Output | What it tells us |
|-----------|-------------|-----------------|
| Plan confirmation | Text output | Parsing correctness |
| Work delegation | Agent() calls | Delegation fidelity |
| Review delegation | Agent() calls | Review loop structure |
| Gate decision | Text output | Gate logic correctness |
| Feedback forwarding | Agent() prompt content | Iteration fidelity |
| Worktree creation | Bash(git) calls | Race setup correctness |
| Parallel execution | Multiple Agent() in one message | Parallelism requirement |
| Status updates | Text output | Spec compliance |
| Cleanup | Bash(git) calls | Cleanup fidelity |

### Interaction with existing tests

The CLI version has 20 integration tests (`tests/SPEC.md`) that test the *CLI's* behavior. Those tests verify that the CLI code (parser.ts, executor.ts, etc.) works correctly. This eval is different — it tests whether *Claude following a prompt* produces the same behavior that the CLI enforces through code.

The test categories may overlap in structure (both test review loops, race, etc.) but the mechanism is completely different: CLI tests verify deterministic code; this eval measures prompt-following fidelity.

## Prior Art

### LLM evals generally

- **SWE-bench:** Tests whether LLMs can solve real GitHub issues. Grades on test pass/fail. Different goal (code quality vs instruction following).
- **Tool-use evals (e.g., BFCL):** Tests whether LLMs call the right functions with right args. Closer to what we need — our eval is essentially a tool-use-sequence eval.
- **AgentBench:** Tests LLMs as agents across environments. Similar spirit but broader scope.

### What's different here

Most evals test *outcomes* (did the code pass tests?). This eval tests *process* (did the orchestrator follow the protocol?). The closest analogy is testing whether a student followed the algorithm correctly, not whether they got the right answer. A correct answer via wrong process is a failure in this eval.

## Constraints

- **Cost:** Each full eval run (all categories, all test cases) spawns many Agent() calls. At current Opus pricing, a single run of Category 5 (race with 3 branches + resolver) is ~5-10 agent calls. Full eval suite could be 50+ agent calls.
- **Time:** Agent() calls take 30-120 seconds each. A full run could take 30-60 minutes.
- **Environment:** Needs a real git repo. Race/vs tests need clean working tree. Tests may interfere with each other (worktree leftovers).
- **Flakiness:** LLM non-determinism means some tests will be inherently flaky. Need to distinguish "sometimes fails" (prompt needs improvement) from "always fails" (fundamental limitation).

## Known Failure Modes (observed)

1. **Worktree creation fails** — Claude gets the git worktree sequence wrong (wrong order, wrong syntax, skips steps). Observed in production.

## Suspected Failure Modes (untested)

2. **Does work directly** — Edits files instead of spawning Agent(). Most likely with simple tasks ("just add a button").
3. **Skips confirmation** — Jumps to execution without asking user to proceed.
4. **Wrong composition** — `x3 review` treated same as `review x3`.
5. **Sequential instead of parallel** — Race branches spawned one at a time.
6. **Forgets cleanup** — Worktrees/branches left behind.
7. **Separate gate agent** — Spawns an agent for gate instead of deciding itself.
8. **Missing status updates** — Correct execution but silent.
9. **Review feedback lost** — On ITERATE, doesn't pass feedback to next work agent.
10. **Wrong defaults** — Review not defaulting to max 3, pick not default resolver.
11. **Improvises** — Adds steps not in the spec.
