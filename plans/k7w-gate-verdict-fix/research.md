# Research: Gate Verdict Parsing Fix + NEXT Keyword

**Requester:** rjcorwin
**Date:** 2026-03-07

## Requirements

### Original Request
Fix a bug where the gate step fails to detect DONE when the agent wraps it in markdown formatting (e.g. `**DONE**`), causing infinite iteration loops. Additionally, add a NEXT keyword as a semantic variation of ITERATE — ITERATE means "fix what was just done", NEXT means "this step is good, move to the next phase".

### Context
A user hit a runaway loop (19 iterations) where the gate agent clearly said "DONE" but wrapped it in markdown bold (`**DONE**`). The `parseGateVerdict()` function uses `startsWith` on each line, so `**DONE**` doesn't match because the line starts with `**`.

Separately, the current gate vocabulary (DONE vs ITERATE) conflates two different "continue" scenarios:
1. The work has issues and needs revision (ITERATE)
2. The work is fine but there's a next phase/step to do (NEXT)

Both result in another loop iteration, but the semantic distinction helps agents make better decisions — especially when following multi-phase plans (like the RPI workflow in CONTRIBUTING.md).

### Open Questions
- Should NEXT be a separate return type from `parseGateVerdict`? **No.** Both NEXT and ITERATE cause the loop to continue. The distinction is semantic — it's guidance for the agent on what kind of work to do next, not a different control flow path.
- Should we use `includes` or strip formatting before `startsWith`? **Use `includes` on the full output.** Simpler, more robust. The keywords are distinctive enough (DONE, PASS, COMPLETE, etc.) that false positives from `includes` on the full output are unlikely. Checking the whole output rather than line-by-line also handles cases where the verdict is embedded in a sentence.
- Should DONE take priority if both DONE and ITERATE/NEXT appear? **Yes.** Check DONE keywords first. If an agent says "DONE" anywhere in its response, that should win — agents sometimes explain what ITERATE means while giving a DONE verdict.

## System Architecture

### Related Components

| File | What it does |
|------|--------------|
| `src/loop.ts:22-32` | `DONE_KEYWORDS`, `ITERATE_KEYWORDS`, `parseGateVerdict()` — keyword lists and verdict parser |
| `src/loop.ts:91-98` | Verdict check in `agentLoop()` — acts on DONE vs ITERATE |
| `src/cli.ts:23-27` | `DEFAULT_GATE_PROMPT` — instructs the gate agent on verdict format |
| `src/template.ts:13-31` | `DEFAULT_COOK_MD` — template that includes step context for agents |

### Data Flow

1. Gate agent runs and produces output text
2. `parseGateVerdict(output)` scans for keywords
3. Returns `'DONE'` or `'ITERATE'`
4. `agentLoop()` either stops the loop (DONE) or continues (ITERATE)

### Constraints

- NEXT must cause the same control flow as ITERATE (loop continues) — no new return type needed
- The fix must handle markdown formatting (`**DONE**`, `*DONE*`, `__DONE__`, etc.)
- DONE keywords should take priority over ITERATE/NEXT keywords when both appear
- Existing COOK.md files in user projects won't automatically get the new verdict docs — only new `cook init` projects will. This is acceptable.

## Prior Art

- Current keywords: DONE, PASS, COMPLETE, APPROVE, ACCEPT (done); ITERATE, REVISE, RETRY (continue)
- The gate prompt tells the agent to respond with "exactly DONE or ITERATE" but agents frequently add formatting, explanation, or use natural language around the keyword
