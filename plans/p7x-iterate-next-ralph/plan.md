# Plan: Iterate Prompt, Next Prompt, and Ralph Loop

**Status:** Draft
**Author:** rjcorwin + Claude
**Created:** 2026-03-15

## Summary

Add iterate and next prompts to the cook loop, a NEXT gate verdict that advances to new tasks without counting against the iteration limit, and a `ralph` keyword that composes with `race` using right-to-left nesting. Introduce duck-typed keyword segments in the CLI parser so that `race` and `ralph` params can be given in any order (number vs string determines meaning). Support both short flags (`-i`, `-n`) and long flags (`--iterate`, `--next`) for ergonomic use.

## Motivation

Today the gate can only say DONE or ITERATE. When working through a multi-step plan, ITERATE means "fix what's broken" — but there's no way to say "this step is good, move on to the next one." The ralph loop adds that outer progression, and the iterate prompt lets you give different instructions for fix-up passes vs. the initial work prompt.

## Goals

- Gate gains a third verdict: NEXT
- Optional iterate prompt (used on ITERATE instead of work prompt)
- Optional next prompt (used on NEXT to advance to next task)
- Two-tier iteration model: inner iterations reset on NEXT, outer nexts have their own limit
- `ralph` keyword in positional args, composable with `race`
- Duck-typed keyword params (number = count/limit, string = prompt/criteria)
- `--iterate`, `--next`, `--max-nexts` flags and `-i`, `-n` short flags
- Backward compat with all existing syntax

## Non-Goals

- Changing the default behavior when iterate/next/ralph are not specified
- Modifying COOK.md template format (just adding new context variables)
- Removing `xN` race syntax (kept as alias)

## Technical Design

### Positional grammar

The CLI args form a sequence of segments. The base segment is prompts + an optional number. Keywords (`race`, `ralph`) start new segments, each with duck-typed params.

```
cook <work> [review] [gate] [iterate] [max-iterations]
     [ralph <next-prompt|max-nexts>...]
     [race <count|criteria>...]
```

Duck typing rules for keyword params:
- A string that parses as a positive integer → it's the numeric param (count for race, max-nexts for ralph)
- Any other string → it's the string param (criteria for race, next prompt for ralph)
- Keywords and `--flags` are not consumed as keyword params

Examples:
```sh
cook "w" "r" "g" "i" 4 ralph "n" 5 race 3 "cleanest"
cook "w" "r" "g" "i" 4 ralph 5 "n" race "cleanest" 3   # same thing, duck typed
cook "w" ralph "see plan.md" race 3                      # defaults for limits
cook "w" race 3 ralph "n" 5                              # race inner, ralph outer
```

Right-to-left nesting: rightmost keyword = outermost wrapper. The parser peels keywords from right to left to build a nested execution plan.

### Keyword segment parsing

Replace `extractRaceMultiplier()` with a general keyword segment parser:

```ts
interface KeywordSegment {
  keyword: 'race' | 'ralph'
  numericParam?: number    // race count or ralph max-nexts
  stringParam?: string     // race criteria or ralph next-prompt
}

interface ParsedSegments {
  baseArgs: string[]                // everything before first keyword
  keywords: KeywordSegment[]        // in order of appearance (left to right)
}
```

The parser scans left-to-right for `race` or `ralph` tokens (case-insensitive) among positional args (not `--flags`). Everything before the first keyword is `baseArgs`. After each keyword, consume following positional args as duck-typed params until the next keyword, `--flag`, or end of args.

### Flag support

New flags parsed by `parseArgs()`:

| Flag | Short | Value | Default |
|------|-------|-------|---------|
| `--iterate` | `-i` | Optional string | Default iterate prompt |
| `--next` | `-n` | Optional string | Default next prompt |
| `--max-nexts` | | Number | 3 |

`--iterate` and `--next` are hybrid flags: they can be boolean (no value) or take a string value. If the next arg starts with `--` or is absent, treat as boolean (use default prompt). Otherwise consume the next arg as the prompt.

When `--iterate` is present (flag or positional), the iterate prompt is set. When `--next` or `ralph` keyword is present, the next prompt is set.

### Default prompts

```ts
const DEFAULT_ITERATE_PROMPT = `Address the issues found in the review.
Check the session log for the review findings and fix the High severity issues.`

const DEFAULT_NEXT_PROMPT = `The previous task passed review. Continue to the next task.
Check the session log for context on what was completed.`
```

### Gate verdict changes

In `src/loop.ts`, update `parseGateVerdict()`:

```ts
const NEXT_KEYWORDS = ['NEXT', 'ADVANCE', 'CONTINUE']

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' | 'NEXT' {
  // ... existing logic plus NEXT detection
}
```

Update `DEFAULT_GATE_PROMPT` to include NEXT option when next/ralph is enabled:

```ts
const DEFAULT_GATE_PROMPT_WITH_NEXT = `Based on the review, respond with exactly DONE, ITERATE, or NEXT
on its own line, followed by a brief reason.

DONE if: all tasks are complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.
NEXT if: the current task is complete and correct, but there are more tasks to do.`
```

### Loop changes (two-tier model)

`agentLoop()` gains optional iterate/next config:

```ts
export interface LoopConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  iteratePrompt?: string    // NEW: used on ITERATE instead of workPrompt
  nextPrompt?: string       // NEW: used on NEXT
  maxNexts?: number         // NEW: max NEXT transitions
  steps: Record<StepName, LoopStepConfig>
  maxIterations: number
  projectRoot: string
}
```

The loop becomes:

```
nextCount = 0
iteration = 1
currentWorkPrompt = workPrompt

outer: while true
  run work(currentWorkPrompt) → review → gate

  if DONE → exit
  if ITERATE →
    iteration++
    if iteration > maxIterations → exit (max iterations)
    currentWorkPrompt = iteratePrompt ?? workPrompt
  if NEXT →
    if nextPrompt not configured → treat as DONE
    nextCount++
    if nextCount >= maxNexts → exit (max nexts)
    iteration = 1  // reset inner counter
    currentWorkPrompt = nextPrompt
```

### Template context additions

Add to `LoopContext` in `template.ts`:

```ts
export interface LoopContext {
  step: string
  prompt: string
  lastMessage: string
  iteration: number
  maxIterations: number
  logFile: string
  nextCount: number        // NEW
  maxNexts: number         // NEW
  isIterating: boolean     // NEW: true if this work step is from ITERATE
  isNext: boolean          // NEW: true if this work step is from NEXT
}
```

### Config file support

Add to `.cook/config.json`:

```json
{
  "iterate": true,
  "iteratePrompt": "custom iterate prompt",
  "next": true,
  "nextPrompt": "custom next prompt",
  "maxNexts": 5
}
```

Boolean `iterate`/`next` enable the feature with defaults. String `iteratePrompt`/`nextPrompt` override the default prompts. CLI flags override config.

### Race + Ralph composition

The execution model uses right-to-left nesting. The `main()` function in cli.ts builds an execution plan from the parsed keyword segments:

```ts
// keywords in left-to-right order from parser
// execution wraps right-to-left: rightmost is outermost

function buildExecution(baseConfig, keywords) {
  // Start with the base loop
  let execute = () => agentLoop(baseConfig)

  // Wrap from left to right (innermost first)
  for (const kw of keywords) {
    const inner = execute
    if (kw.keyword === 'race') {
      execute = () => runRace(kw.numericParam, inner, kw.stringParam)
    } else if (kw.keyword === 'ralph') {
      execute = () => runRalph(kw.numericParam, inner, kw.stringParam)
    }
  }

  return execute()
}
```

Wait — since rightmost = outermost, and we want to build inside-out, we iterate left-to-right wrapping each time. The first keyword wraps the base, the second wraps that, etc. So `cook base race ralph` → ralph(race(base)). That means ralph is the outer loop calling race(base) for each task. Correct.

For `cook base race1 ralph race2` → race2(ralph(race1(base))). race2 is outermost, spawning N worktrees each running ralph(race1(base)).

### Ralph execution (`runRalph`)

Ralph wraps an inner execution function. It's essentially the NEXT outer loop extracted:

```ts
async function runRalph(
  maxNexts: number,
  innerExecute: (nextPrompt?: string) => Promise<LoopResult>,
  nextPrompt?: string
): Promise<void> {
  for (let n = 0; n < maxNexts; n++) {
    const prompt = n === 0 ? undefined : nextPrompt  // first run uses work prompt
    const result = await innerExecute(prompt)
    if (result.verdict === 'DONE') return
    if (result.verdict !== 'NEXT') return  // ITERATE hitting max = stop
  }
}
```

This means `agentLoop` needs to return its final verdict so the ralph wrapper can decide what to do.

### Updated `agentLoop` return type

```ts
export interface LoopResult {
  verdict: 'DONE' | 'ITERATE' | 'NEXT' | 'MAX_ITERATIONS'
  iterations: number
}

export async function agentLoop(...): Promise<LoopResult>
```

When ralph is NOT active (no next prompt configured), NEXT is treated as DONE (backward compat). When ralph IS active, agentLoop returns `{ verdict: 'NEXT' }` and the ralph wrapper handles the outer loop.

When ralph wraps the loop directly (no race), agentLoop handles both ITERATE and NEXT internally using the two-tier model described above. When ralph wraps race, each race run's agentLoop handles ITERATE internally, and NEXT propagates up to the ralph wrapper.

Actually, simpler: when ralph is a keyword segment, the NEXT handling always lives in the ralph wrapper. agentLoop just returns NEXT as its verdict. When ralph is NOT present but `--next`/`-n` is used, the two-tier model is internal to agentLoop. This keeps composition clean.

Decision: Two modes of NEXT handling:
1. **Inline mode** (no `ralph` keyword, just `--next`/`-n` flag): agentLoop handles NEXT internally with the two-tier loop.
2. **Composed mode** (`ralph` keyword): agentLoop returns NEXT verdict, ralph wrapper handles the outer loop.

Both modes use the same prompts and limits. The difference is just where the outer loop lives.

## Implementation Approach

### Step 1: Update gate verdict parsing (`src/loop.ts`)

1. Add NEXT_KEYWORDS to `parseGateVerdict()`
2. Return type becomes `'DONE' | 'ITERATE' | 'NEXT'`
3. Add `LoopResult` return type to `agentLoop()`
4. Add `iteratePrompt`, `nextPrompt`, `maxNexts` to `LoopConfig`
5. Implement two-tier loop logic in `agentLoop()` for inline mode
6. When `nextPrompt` is not set, treat NEXT as DONE (backward compat)

### Step 2: Update template context (`src/template.ts`)

1. Add `nextCount`, `maxNexts`, `isIterating`, `isNext` to `LoopContext`
2. Update `DEFAULT_COOK_MD` to optionally show next count

### Step 3: Update CLI parser (`src/cli.ts`)

1. Add keyword segment parser (replaces `extractRaceMultiplier`)
2. Add `--iterate`/`-i`, `--next`/`-n`, `--max-nexts` flags to `parseArgs()`
3. Update `ParsedArgs` interface
4. Keep `xN` as an alias (detected before keyword parsing)
5. Update default gate prompt when next is enabled
6. Add `DEFAULT_ITERATE_PROMPT` and `DEFAULT_NEXT_PROMPT`
7. Update usage text and banner

### Step 4: Add ralph execution (`src/ralph.ts` or extend `src/loop.ts`)

1. Create `runRalph()` function for composed mode
2. Wire into the keyword-based execution builder in cli.ts

### Step 5: Update race to support composition (`src/race.ts`)

1. Refactor `runRace()` to accept an inner execution function (not just agentLoop)
2. This allows `race(ralph(base))` and `ralph(race(base))` compositions

### Step 6: Update config (`src/config.ts`)

1. Add `iterate`, `iteratePrompt`, `next`, `nextPrompt`, `maxNexts` to config schema
2. Update `loadConfig()` to parse new fields

### Step 7: Update TUI (`src/ui/App.tsx`)

1. Show ralph step count in status bar when active
2. Distinguish iterate vs next vs initial work in step display

### Order of operations

Step 1-2 first (core loop changes, no CLI changes needed to test). Step 3 next (parser). Step 4-5 can be done together (ralph + race composition). Step 6-7 are polish.

## Alternatives Considered

**NEXT as a separate step instead of a gate verdict** — Could add a fourth step in the loop (work → review → gate → advance). But this adds complexity for no real benefit — the gate is already the decision point.

**Ralph as a config-only feature (no keyword)** — Could just use `--next` flag and handle it all inline. But the keyword approach composes naturally with race and matches the existing pattern. Users who don't need composition can still just use `--next`.

**Separate iteration counters per keyword layer** — Each race/ralph layer could have its own max-iterations. Decided against: the base `maxIterations` applies to each inner agentLoop invocation regardless of wrapping. Ralph's `maxNexts` is the outer limit. This keeps the mental model simple.
