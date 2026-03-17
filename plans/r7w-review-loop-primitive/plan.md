# Plan: Align Implementation to SPEC.md

**Status:** Draft
**Author:** rjcorwin
**Created:** 2026-03-17

## Summary

Rewrite cook's parser and execution engine so the implementation matches SPEC.md exactly. This is a breaking change: `xN` flips from parallel race to sequential repeat, resolver keywords rename (`judge`→`pick`, `summarize`→`compare`), and the `review` keyword becomes explicit. A new unified parser produces a recursive AST, and a new recursive executor walks it. Ralph (outer task loop) and the iterate step (4th prompt) are added.

## Motivation

The current implementation predates the spec. Three separate parsers (`parseArgs`, `extractRaceMultiplier`, `parseForkJoinArgs`) each handle a subset of the grammar with duplicated flag logic. `xN` means race (should mean repeat). `review` is always implicit (should be opt-in). Resolver names don't match the spec. Ralph doesn't exist. The iterate step doesn't exist. These gaps compound — users can't compose operators the way the spec promises.

## Goals

- Single unified parser producing a recursive AST from CLI args
- Recursive executor that walks the AST
- `xN` / `repeat N` = sequential repeat (not parallel)
- `vN` / `race N` = parallel versions in worktrees
- `review` as explicit keyword with optional positional prompts
- `iterate` as 4th step (distinct from work)
- `ralph` outer loop with NEXT/DONE gate
- Resolver rename: `pick` (default), `merge`, `compare`
- `vs` branches as full cook definitions (each can have xN, review, ralph)
- Second-level composition (`... pick "criteria" v3 pick "criteria"`)
- Template variables: `${ralphIteration}`, `${maxRalph}`, `${repeatPass}`, `${maxRepeatPasses}`

## Non-Goals

- New TUI components (reuse App.tsx and RaceApp.tsx, extend minimally)
- Docker sandbox changes
- New agent runner types
- Test framework setup (defer to a future plan)

## Technical Design

### AST

```typescript
// src/parser.ts

type Node =
  | { type: 'work'; prompt: string }
  | { type: 'repeat'; inner: Node; count: number }
  | { type: 'review'; inner: Node; reviewPrompt?: string; gatePrompt?: string; iteratePrompt?: string; maxIterations: number }
  | { type: 'ralph'; inner: Node; maxTasks: number; gatePrompt: string }
  | { type: 'composition'; branches: Node[]; resolver: Resolver; criteria?: string }

type Resolver = 'pick' | 'merge' | 'compare'
```

The parser consumes tokens left-to-right, building this tree bottom-up. Each operator wraps everything to its left. `vs` splits the token stream into branch segments, each parsed recursively into its own subtree.

### Executor

```typescript
// src/executor.ts

async function execute(node: Node, ctx: ExecutionContext): Promise<ExecutionResult>
```

Pattern-matches on `node.type`:

- **work**: single agent call via `agentLoop` (1 iteration, no review)
- **repeat**: run `execute(inner)` N times, threading `lastMessage` between passes
- **review**: run work→review→gate→iterate loop (the existing `agentLoop` with iterate added)
- **ralph**: outer loop — run `execute(inner)`, then ralph gate; repeat on NEXT, stop on DONE
- **composition**: create worktrees, run `execute(branch)` in each, resolve with pick/merge/compare

### Data flow

```
CLI args
  → tokenize (separate flags from positional tokens)
  → parse tokens → AST (Node tree)
  → resolve config (merge CLI flags + .cook/config.json)
  → execute(ast, config) recursively
```

### Positional prompt duck-typing

Unchanged from spec: after the work prompt, strings fill review → gate → iterate slots until a reserved keyword or number is hit. A bare number becomes `max-iterations`. This is equivalent to `review` keyword with those prompts.

```
cook "work" "review" "gate"           → ReviewLoop(Work("work"), review, gate, -, 3)
cook "work" "review" "gate" "iter" 5  → ReviewLoop(Work("work"), review, gate, iter, 5)
cook "work" review                    → ReviewLoop(Work("work"), -, -, -, 3)  (defaults)
cook "work"                           → Work("work")  (no review loop)
```

## Implementation Steps

### Step 1: `src/parser.ts` — Unified Parser

Create new file. Single exported function:

```typescript
export function parse(args: string[]): { ast: Node; flags: ParsedFlags }
```

**Token scanning (left-to-right):**

1. Separate `--flags` from positional tokens (reuse existing flag set + add `--iterate`, `--iterate-agent`, `--iterate-model`, `--ralph-agent`, `--ralph-model`)
2. Check for `vs` in positional tokens:
   - If present: split into branch segments at each `vs`, parse each segment into a subtree, then scan for resolver + optional second composition after the last branch
   - If absent: parse as single pipeline (below)

**Single pipeline parsing:**

1. First positional = work prompt → `Work(prompt)`
2. Scan remaining positional tokens in order:
   - `xN` or `repeat` + `N` → wrap current node in `Repeat(current, N)`
   - `review` keyword → enter review mode: consume optional review/gate/iterate prompts and max-iterations number → wrap in `ReviewLoop(current, ...)`
   - Bare string after work (not a keyword) → implicit review mode: fill review/gate/iterate slots → wrap in `ReviewLoop(current, ...)`
   - Bare number after work with no preceding strings → just set max-iterations on implicit review
   - `ralph` keyword → consume optional `N` (default 100), then required gate prompt string → wrap in `Ralph(current, N, gatePrompt)`
   - `vN` or `race` + `N` → wrap in `Composition([current] * N, resolver, criteria)` — consume resolver keyword + criteria after
   - `pick` / `merge` / `compare` → set resolver on pending composition
   - After resolver + criteria, another `vN` / `race N` → second-level composition wrapping the first

**Keyword detection:**

Reserved: `review`, `ralph`, `race`, `repeat`, `vs`, `pick`, `merge`, `compare`
Patterns: `/^x\d+$/i` (xN), `/^v\d+$/i` (vN)
Bare number: `/^\d+$/`

**vs branch parsing:**

Each segment between `vs` tokens is parsed as an independent pipeline (same rules as single pipeline above). After the last segment, remaining tokens are scanned for resolver + optional second composition.

```
cook "A" x3 vs "B" review pick "criteria" v3 pick "best"
  → Composition(
      branches: [Repeat(Work("A"), 3), ReviewLoop(Work("B"), defaults)],
      resolver: pick,
      criteria: "criteria"
    )
  → wrapped in second Composition(copies: 3, resolver: pick, criteria: "best")
```

**Validation:**
- Work prompt is required (first positional must be a non-keyword string)
- `ralph` requires a gate prompt string
- `compare` cannot be followed by second composition
- `v1` / `x1` are valid no-ops (parser can emit them; executor treats count=1 as passthrough)
- Each `vs` branch must have a work prompt

### Step 2: `src/config.ts` — Add iterate and ralph step types

- Extend `StepName` from `'work' | 'review' | 'gate'` to `'work' | 'review' | 'gate' | 'iterate' | 'ralph'`
- Update `loadConfig` to parse `steps.iterate` and `steps.ralph` from config.json
- Update `CookConfig.steps` type to include iterate and ralph
- Ralph step config falls back to gate config if not set (per spec)

### Step 3: `src/template.ts` — New template variables

- Extend `LoopContext` with optional fields: `ralphIteration?: number`, `maxRalph?: number`, `repeatPass?: number`, `maxRepeatPasses?: number`
- Update `renderTemplate` to pass these through (they're already dynamic via `Object.keys(ctx)`)
- Update `DEFAULT_COOK_MD` — no change needed (users add repeat/ralph vars when they use those features)

### Step 4: `src/loop.ts` — Add iterate step

- Add optional `iteratePrompt` to `LoopConfig`
- Modify `agentLoop` loop body:
  - Iteration 1: work → review → gate
  - Iteration 2+: iterate (or work if no iteratePrompt) → review → gate
- Add `ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses` to the context passed to `renderTemplate`
- Return `LoopResult` instead of void:

```typescript
export interface LoopResult {
  verdict: 'DONE' | 'ITERATE' | 'MAX_ITERATIONS'
  iterations: number
  lastMessage: string
  logFile: string
}
```

This lets the executor inspect the outcome (needed for ralph, which checks if the inner loop converged).

### Step 5: `src/executor.ts` — Recursive Executor

Create new file. Main export:

```typescript
export interface ExecutionContext {
  projectRoot: string
  config: CookConfig
  flags: ParsedFlags
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
  cookMD: string
  showRequest: boolean
  // Threading state (mutable, passed down)
  lastMessage: string
  repeatPass?: number
  maxRepeatPasses?: number
  ralphIteration?: number
  maxRalph?: number
}

export async function execute(node: Node, ctx: ExecutionContext): Promise<ExecutionResult>
```

**Work node:**
- Call `agentLoop` with maxIterations=1, no review/gate prompts
- Actually: just run a single agent call directly (work step only, no review loop). Simpler than agentLoop for this case.
- Return the output as `lastMessage`

**Repeat node:**
- For `pass = 1..count`: `execute(inner, { ...ctx, repeatPass: pass, maxRepeatPasses: count })`
- Thread `lastMessage` between passes

**ReviewLoop node:**
- Call `agentLoop` with the configured prompts and maxIterations
- Pass `ctx.repeatPass`, `ctx.ralphIteration` etc. through to template context
- Return the `LoopResult`

**Ralph node:**
- For `task = 1..maxTasks`:
  - `execute(inner, { ...ctx, ralphIteration: task, maxRalph: maxTasks })`
  - Run ralph gate agent with gatePrompt
  - Parse verdict: NEXT → continue, DONE → break
  - If inner loop hit max iterations without DONE → stop ralph with warning (per research Q10)

**Composition node:**
- Create worktrees (one per branch)
- For each branch: `execute(branchNode, { ...ctx, projectRoot: worktreePath })`
- Commit changes in each worktree
- Dispatch to resolver:
  - **pick**: reuse `buildJudgePrompt`/`parseJudgeVerdict` from race.ts (rename references from "judge" to "pick" in user-facing messages)
  - **merge**: create merge worktree, inject MERGE_CONTEXT.md, run agentLoop
  - **compare**: write `.cook/compare-<session>.md`
- Handle second-level composition by wrapping the entire composition in another Composition node (already represented in AST)

### Step 6: `src/cli.ts` — Rewire main

Replace the current dispatch logic. New `main()`:

```typescript
async function main() {
  const command = args[0]
  switch (command) {
    case 'init':    cmdInit(findProjectRoot()); break
    case 'rebuild': await cmdRebuild(); break
    case 'doctor':  await cmdDoctor(args.slice(1)); break
    case 'help':
    case '--help':
    case '-h':      usage(); break
    case undefined:  usage(); break
    default: {
      const { ast, flags } = parse(args)
      const config = loadConfig(projectRoot)
      const ctx = buildExecutionContext(flags, config, projectRoot)
      await execute(ast, ctx)
      break
    }
  }
}
```

Remove:
- `parseArgs()` — replaced by `parse()` in parser.ts
- `extractRaceMultiplier()` — handled by parser
- `parseForkJoinArgs()` / `hasForkJoinSyntax()` / `tripleToBranch()` — handled by parser
- `cmdRace()` / `cmdRaceFromMultiplier()` / `cmdForkJoin()` — replaced by executor
- `runLoop()` — replaced by executor

Keep:
- `cmdInit()`, `cmdRebuild()`, `cmdDoctor()` — unchanged
- `findProjectRoot()`, `resolveAgentPlan()`, `resolveStepSelection()` — refactor into executor context builder
- Flag parsing utilities — move to parser.ts
- Default prompts — move to a shared constants file or keep at top of parser.ts
- `usage()` — update to reflect new grammar

### Step 7: `src/race.ts` — Refactor to library

The executor handles orchestration. `race.ts` becomes a utility library:

Keep (exported):
- `sessionId()` — session ID generation
- `createWorktree()` / `removeWorktree()` — worktree management
- `createRunnerPool()` — runner factory
- `buildJudgePrompt()` / `parseJudgeVerdict()` — pick resolver logic
- `confirm()` / `pickOne()` — user prompts
- `RunResult` type

Remove:
- `runRace()` — replaced by executor's Composition handler

Rename in user-facing messages:
- "Judge" → "Pick" in log output and prompts
- `JUDGE_PROMPT` constant text updated but `PICK <N>` response format stays the same

### Step 8: `src/fork-join.ts` — Remove or gut

Most logic moves to executor.ts:
- Branch execution → executor's Composition handler
- Judge/merge/summarize → executor's resolver dispatch
- Meta-parallelism → executor's second-level Composition
- `cleanupActiveForkJoins` → move to executor cleanup

Keep if still useful as utilities, otherwise delete entirely. The executor imports worktree utilities from race.ts directly.

### Step 9: Update `usage()` and docs

Update `usage()` in cli.ts to reflect the new grammar:

```
cook "work"                          Single LLM call (no review)
cook "work" review                   Work + review loop (default prompts)
cook "work" "review" "gate"          Work + review loop (custom prompts)
cook "work" review x3                Review loop repeated 3 times
cook "work" x3 review               Work repeated 3 times, then review
cook "work" review ralph 5 "gate"   Review loop + ralph outer loop
cook "work" v3 pick "criteria"       3 parallel versions, pick best
cook "A" vs "B" pick "criteria"     Fork-join: two approaches
cook "A" vs "B" merge "criteria"    Fork-join: synthesize best parts
cook "A" vs "B" compare             Fork-join: comparison document
```

Update `--iterate`, `--iterate-agent`, `--iterate-model`, `--ralph-agent`, `--ralph-model` flags.

### Step 10: `.cook/config.json` default and init

Update `DEFAULT_COOK_CONFIG_JSON` in cli.ts to include iterate and ralph steps:

```json
{
  "agent": "claude",
  "sandbox": "agent",
  "steps": {
    "work": {},
    "review": {},
    "gate": {},
    "iterate": {},
    "ralph": {}
  },
  "env": []
}
```

Update `.cook/.gitignore` to include `compare-*.md` pattern.

## Step Dependencies

```
Step 1 (parser) ─────────┐
Step 2 (config) ──────────┤
Step 3 (template) ────────┤
Step 4 (loop.ts) ─────────┼─→ Step 5 (executor) ─→ Step 6 (cli.ts rewire) ─→ Step 9 (usage/docs)
Step 7 (race.ts refactor) ┤                                                  ─→ Step 10 (config defaults)
Step 8 (fork-join remove) ┘
```

Steps 1–4 and 7–8 can be done in parallel. Step 5 depends on all of them. Steps 6, 9, 10 are sequential after 5.

## Risk / Complexity Assessment

**Breaking change**: `xN` flips meaning. Users with `cook "work" x3` scripts will get 3 sequential passes instead of 3 parallel worktrees. This is intentional (spec alignment) but needs a clear major version bump.

**Parser complexity**: The grammar is strictly left-to-right with no ambiguity. The hardest part is `vs` branch segmentation — each segment needs independent parsing. A recursive approach (parse each segment, then combine) keeps this manageable.

**Executor depth**: Ralph wrapping ReviewLoop wrapping Repeat wrapping Work is the deepest nesting. Each level is straightforward recursion. The main complexity is threading context (lastMessage, repeat/ralph counters, log file) through the tree.

**TUI integration**: The current TUI expects a flat event stream from `agentLoop`. Repeat and ralph add outer loops. The simplest approach: emit extra events for repeat/ralph boundaries, and have the TUI show them as phase markers. RaceApp already handles multiple parallel runs — composition reuses this directly.

## Alternatives Considered

**Incremental migration (rename keywords only, defer AST)**: Cheaper but leaves three parsers and ad-hoc routing in place. Every future feature would hit the same structural problem. The AST rewrite pays off immediately because ralph, iterate, and proper xN semantics all fall out naturally.

**Parser generator (PEG, nearley)**: Overkill for this grammar. The cook grammar has no ambiguity, no precedence, and no grouping beyond leftward wrapping. A hand-written scanner is simpler, has zero dependencies, and is easier to debug.

**Keep `fork-join.ts` as a separate module**: The join strategy logic (merge worktree, MERGE_CONTEXT.md, compare output) is substantial. Could keep it as `src/resolvers.ts` instead of inlining in executor.ts. Worth considering during implementation — if executor.ts gets too long, extract resolvers.
