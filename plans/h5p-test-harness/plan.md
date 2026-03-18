# Plan: Test Harness

**Status:** Draft
**Author:** AI
**Created:** 2026-03-17

## Summary

Add Vitest as a dev dependency, inject a `poolFactory` seam into `ExecutionContext` so tests can supply a `TestRunner` instead of real LLM runners, and write test files covering parser, loop, executor, race, and template. The result is a fast, zero-LLM test suite that runs with `npm test`.

## Motivation

The codebase has zero automated tests. Parser logic, the gate verdict parser, the ralph verdict parser, the judge verdict parser, and the agent loop are all critical business logic with no regression protection. Adding a test harness now, before the codebase grows further, establishes a baseline and makes future changes safer.

## Goals

- Install Vitest and configure it for the existing NodeNext/ES2022/TypeScript setup
- Add a `poolFactory?` optional field to `ExecutionContext` in `executor.ts`
- Replace the 4 direct `createRunnerPool(...)` calls in the primary executor functions with `(ctx.poolFactory ?? createRunnerPool)(...)`
- Create a `TestRunner` helper class at `src/testing/test-runner.ts`
- Export `parseRalphVerdict` from `executor.ts` and test it directly
- Write test files: `src/parser.test.ts`, `src/loop.test.ts`, `src/executor.test.ts`, `src/race.test.ts`, `src/template.test.ts`
- Add `"test": "vitest run"` script to `package.json`

## Non-Goals

- UI component tests (`App.tsx`, `RaceApp.tsx`, `LogStream.tsx`) — deferred
- Composition integration tests requiring real git worktrees — deferred to v1+
- Testing non-auto resolver paths that block on `process.stdin` (`confirm`, `pickOne`) — deferred
- Testing `resolvePick`, `resolveMerge`, `resolveCompare` at the integration level — deferred

## Technical Design

### 1. Vitest configuration

Create `vitest.config.ts` at the project root:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

Vitest handles NodeNext `.js`-extension imports in TypeScript source without a custom resolver when `environment: 'node'` is set. No additional transform config is needed. The `tsconfig.json` `moduleResolution: NodeNext` does not conflict with Vitest's default transform.

### 2. `ExecutionContext` change

In `src/executor.ts`, add one optional field to the `ExecutionContext` interface:

```typescript
export interface ExecutionContext {
  projectRoot: string
  config: CookConfig
  flags: ParsedFlags
  stepConfig: Record<StepName, StepSelection>
  runAgents: AgentName[]
  cookMD: string
  showRequest: boolean
  lastMessage: string
  repeatPass?: number
  maxRepeatPasses?: number
  ralphIteration?: number
  maxRalph?: number
  // Injectable factory for tests — omit in production to use createRunnerPool
  poolFactory?: (worktreePath: string, config: CookConfig, runAgents: AgentName[]) => RunnerPool
}
```

The field is optional (`?`). All production call sites that construct an `ExecutionContext` continue to work without change because the field is absent and the executor falls back to `createRunnerPool`.

### 3. The 4 call sites to update in `executor.ts`

Each of the four primary executor functions calls `createRunnerPool` directly. Replace each with the conditional form.

**Site 1 — `executeWork`, line 102:**
```typescript
// Before
const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
// After
const pool = (ctx.poolFactory ?? createRunnerPool)(ctx.projectRoot, ctx.config, ctx.runAgents)
```

**Site 2 — `executeReview`, line 189:**
```typescript
// Before
const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
// After
const pool = (ctx.poolFactory ?? createRunnerPool)(ctx.projectRoot, ctx.config, ctx.runAgents)
```

**Site 3 — `executeRalph`, line 307:**
```typescript
// Before
const pool = createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)
// After
const pool = (ctx.poolFactory ?? createRunnerPool)(ctx.projectRoot, ctx.config, ctx.runAgents)
```

**Site 4 — `executeComposition`, line 451:**
```typescript
// Before
const pools = worktrees.map(wt => createRunnerPool(wt.worktreePath, ctx.config, ctx.runAgents))
// After
const pools = worktrees.map(wt => (ctx.poolFactory ?? createRunnerPool)(wt.worktreePath, ctx.config, ctx.runAgents))
```

Note: `resolvePick`, `resolveMerge`, and `resolveCompare` also call `createRunnerPool` directly. These resolver functions receive `ctx: ExecutionContext` as a parameter, so the substitution is identical. The exact call sites are:

- **`resolvePick`, line 711:** `const pool = createRunnerPool(projectRoot, ctx.config, ctx.runAgents)`
- **`resolveMerge`, line 789:** `const mergePool = createRunnerPool(mergeWt.worktreePath, ctx.config, ctx.runAgents)`
- **`resolveCompare`, line 911:** `const pool = createRunnerPool(projectRoot, ctx.config, ctx.runAgents)`

Update these three additional call sites with the same pattern. This brings the total to 7 replacements, but the four listed above are the primary executor dispatch paths covered by tests in this plan; the resolver paths are not tested in v1.

### 4. `TestRunner` implementation

Create `src/testing/test-runner.ts`:

```typescript
// src/testing/test-runner.ts
import type { AgentRunner, SandboxMode } from '../runner.js'
import type { AgentName } from '../config.js'
import { RunnerPool } from '../runner.js'

/**
 * A mock AgentRunner for use in tests.
 *
 * Responses are consumed in order from the queue. When the queue is empty,
 * the runner returns 'DONE' by default (or a custom fallback if provided).
 *
 * Each response string is also fed line-by-line to the onLine callback,
 * matching the behavior of real runners.
 */
export class TestRunner implements AgentRunner {
  private responses: string[]
  private fallback: string

  constructor(responses: string[], fallback = 'DONE') {
    this.responses = [...responses]
    this.fallback = fallback
  }

  async runAgent(
    _agent: AgentName,
    _model: string,
    _prompt: string,
    onLine: (line: string) => void,
  ): Promise<string> {
    const response = this.responses.shift() ?? this.fallback
    for (const line of response.split('\n')) {
      onLine(line)
    }
    return response
  }

  async stop(): Promise<void> {}
}

/**
 * Build a RunnerPool that always returns the given TestRunner,
 * regardless of SandboxMode. Pass the returned pool as the poolFactory
 * result in ExecutionContext.
 */
export function makeTestPool(runner: TestRunner): RunnerPool {
  return new RunnerPool(async (_mode: SandboxMode) => runner)
}

/**
 * Convenience: build a poolFactory suitable for ExecutionContext.poolFactory.
 *
 * Usage:
 *   const ctx: ExecutionContext = {
 *     ...baseCtx,
 *     poolFactory: testPoolFactory(new TestRunner(['DONE'])),
 *   }
 */
export function testPoolFactory(
  runner: TestRunner,
): (_worktreePath: string, _config: unknown, _runAgents: unknown) => RunnerPool {
  return () => makeTestPool(runner)
}
```

### 5. Temp directory pattern

Tests that exercise paths which write to disk (log files, session logs) must use a temporary directory as `projectRoot`. Use Node's `os.tmpdir()` and `fs.mkdtempSync` in a `beforeEach`/`afterEach` pair:

```typescript
import os from 'os'
import fs from 'fs'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```

Pass `tmpDir` as `projectRoot` in any `ExecutionContext` or `LoopConfig` that writes logs.

### 6. `parseRalphVerdict` — export and test directly

`parseRalphVerdict` is a module-private function in `executor.ts` (line 369). Export it by changing `function parseRalphVerdict` to `export function parseRalphVerdict`.

After creating `src/testing/test-runner.ts` in Step 6, export `parseRalphVerdict` from `executor.ts`. Add direct unit tests for it in `executor.test.ts`:

- `parseRalphVerdict('DONE')` → `'DONE'`
- `parseRalphVerdict('NEXT\nsome explanation')` → `'NEXT'`
- `parseRalphVerdict('text with no keyword')` → `'DONE'` (fail-safe default)
- `parseRalphVerdict('APPROVE')` → `'DONE'` (DONE-family keyword)
- `parseRalphVerdict('CONTINUE')` → `'NEXT'` (NEXT-family keyword)

The behavior-level tests in `executor.test.ts` (exercising `executeRalph` via `execute()`) remain in addition to these direct tests — they verify the function is wired up correctly in the execution path.

### 7. Mocking `render()` from Ink in `executor.test.ts`

Every test in `executor.test.ts` that calls `execute()` on a node that bottoms out at a `work` or `review` node will trigger `render()` from Ink. This includes `executeWork`, `executeReview`, `executeRalph`, and `executeRepeat` tests — all of them. In a non-TTY test environment, `render()` may write noise to stdout/stderr or hang.

At the **top level** of `executor.test.ts` (not inside any test or describe block), add:

```typescript
vi.mock('ink', () => ({
  render: () => ({ unmount: () => {}, waitUntilExit: async () => {} }),
}))
```

This must be a top-level call so Vitest's module mock hoisting applies before any imports are evaluated.

---

## Implementation Approach

Steps must be followed in order. Each step is independently verifiable before proceeding.

### Step 1 — Install Vitest

```
npm install --save-dev vitest
```

Verify: `node_modules/.bin/vitest --version` prints a version number.

### Step 2 — Add `vitest.config.ts`

Create `vitest.config.ts` at the project root with the content shown in Technical Design §1.

### Step 3 — Add `"test"` script to `package.json`

In the `"scripts"` block, add:

```json
"test": "vitest run"
```

Verify: `npm test` runs (and immediately reports no test files found — that is expected at this step).

### Step 4 — Add `poolFactory?` to `ExecutionContext`

Edit `src/executor.ts`. Add the `poolFactory?` field to the `ExecutionContext` interface as shown in Technical Design §2. No other changes yet.

TypeScript must still compile without errors (`npm run build`).

### Step 5 — Replace `createRunnerPool` call sites

Edit `src/executor.ts`. Replace the 7 call sites as described in Technical Design §3. The pattern is always:

```typescript
(ctx.poolFactory ?? createRunnerPool)(...)
```

For resolver functions (`resolvePick`, `resolveMerge`, `resolveCompare`) that already receive `ctx: ExecutionContext`, apply the same substitution.

After editing, run `npm run build` to verify TypeScript compilation succeeds with no errors.

### Step 6 — Create `src/testing/test-runner.ts` and export `parseRalphVerdict`

Create the file as shown in Technical Design §4.

Then export `parseRalphVerdict` from `executor.ts`: change `function parseRalphVerdict` to `export function parseRalphVerdict`.

### Step 7 — Write `src/parser.test.ts`

The parser is a pure function. No infrastructure or temp dirs needed. All tests use `parse(args)` directly.

Tests to write:

- `parse(['do the work'])` → `ast.type === 'work'` and `ast.prompt === 'do the work'`
- `parse(['do the work', 'review'])` → `ast.type === 'review'`, `ast.inner.type === 'work'`, `ast.maxIterations === 3`
- `parse(['do the work', 'x3'])` → `ast.type === 'repeat'`, `ast.count === 3`, `ast.inner.type === 'work'`
- `parse(['do the work', 'ralph', 'check done'])` → `ast.type === 'ralph'`, `ast.maxTasks === 100`, `ast.gatePrompt === 'check done'`
- `parse(['do the work', 'v2', 'pick'])` → `ast.type === 'composition'`, `ast.branches.length === 2`, `ast.resolver === 'pick'`
- `parse(['work a', 'vs', 'work b', 'merge'])` → `ast.type === 'composition'`, `ast.branches.length === 2`, both branches have `type === 'work'`, `ast.resolver === 'merge'`
- Flag `--agent claude` → `flags.agent === 'claude'`
- Flag `--model gpt-4o` → `flags.model === 'gpt-4o'`
- Flag `--sandbox docker` → `flags.sandbox === 'docker'`
- Flag `--work "custom work prompt"` → `ast.prompt === 'custom work prompt'`
- Flag `--review "custom review"` → `ast.reviewPrompt` on the review node equals `'custom review'` (requires `parse(['prompt', 'review', '--review', 'custom review'])`)
- Flag `--gate "custom gate"` → `ast.gatePrompt` on the review node
- Flag `--max-iterations 5` → review node `maxIterations === 5`
- Edge case: `parse([])` → throws `'Work prompt is required'`
- Edge case: `parse(['review'])` → throws (reserved keyword as first token)
- Edge case: bare number as max-iterations — `parse(['do work', '5'])` → review node with `maxIterations === 5`

### Step 8 — Write `src/loop.test.ts`

Split into two describe blocks: `parseGateVerdict` (pure, no infra) and `agentLoop` (needs temp dir).

**`parseGateVerdict` tests:**
- `'DONE'` → `'DONE'`
- `'PASS'` → `'DONE'`
- `'COMPLETE'` → `'DONE'`
- `'APPROVE'` → `'DONE'`
- `'ACCEPT'` → `'DONE'`
- `'ITERATE'` → `'ITERATE'`
- `'REVISE'` → `'ITERATE'`
- `'RETRY'` → `'ITERATE'`
- No keyword → `'ITERATE'` (default)
- Multi-line: `'some text\nDONE\nmore text'` → `'DONE'` (first matching line wins)
- Leading/trailing whitespace: `'  done  '` → `'DONE'` (case insensitive)
- Case insensitive: `'done'` → `'DONE'`

**`agentLoop` tests** (use temp dir via `beforeEach`/`afterEach`):

Each test constructs a minimal `LoopConfig` and passes `new EventEmitter()` as the events parameter. The `getRunner` argument is `async () => testRunner`.

- Single iteration returning DONE: `TestRunner(['work output', 'review output', 'DONE'])` → `LoopResult.verdict === 'DONE'`, `iterations === 1`
- Multiple iterations before DONE: runner returns ITERATE on first gate, DONE on second → `LoopResult.verdict === 'DONE'`, `iterations === 2`
- Max iterations reached: runner always returns ITERATE, `maxIterations: 2` → `LoopResult.verdict === 'MAX_ITERATIONS'`, `iterations === 2`
- `skipFirstWork: true` with `maxIterations: 1`: supply a `TestRunner` with exactly 2 responses `['review output', 'DONE']`. If the work step erroneously runs, it consumes `'review output'` as the work response and `'DONE'` as the review response, leaving the gate to receive the fallback — wrong behavior. Assert `result.iterations === 1` and `result.lastMessage === 'DONE'` to confirm the correct path (review → gate → DONE, no work call).
- `LoopResult` shape: verify `verdict`, `iterations`, `lastMessage` (equals last runner output), `logFile` (non-empty string pointing into tmpDir)

### Step 9 — Write `src/executor.test.ts`

At the top of `executor.test.ts` (before any imports that pull in Ink transitively), add the mock described in Technical Design §7:

```typescript
vi.mock('ink', () => ({
  render: () => ({ unmount: () => {}, waitUntilExit: async () => {} }),
}))
```

Use `test.sequential` for all tests in this file (Vitest sequential mode) to avoid `loopEvents` singleton cross-talk.

Each test builds a full `ExecutionContext`. Use a helper `makeCtx(runner: TestRunner, overrides?)` to reduce repetition. Import `ParsedFlags` from `parser.ts`. The base context needs:
- `projectRoot`: `tmpDir`
- `config`: valid `CookConfig`:
  ```typescript
  config: {
    sandbox: 'agent' as const,
    env: [],
    animation: 'strip' as const,
    agent: 'claude' as const,
    steps: { work: {}, review: {}, gate: {}, iterate: {}, ralph: {} },
  },
  ```
- `flags`: `{} as ParsedFlags`
- `stepConfig`: a minimal step config record with `work`, `review`, `gate`, `ralph`, `iterate` each set to `{ agent: 'claude', model: 'claude-sonnet', sandbox: 'none' }`
- `runAgents`: `['claude']`
- `cookMD`: `DEFAULT_COOK_MD` from `template.ts`
- `showRequest`: `false`
- `lastMessage`: `''`
- `poolFactory`: `testPoolFactory(runner)`

**Tests:**

- `executeWork` via `execute(workNode, ctx)`: `TestRunner(['hello from agent'])` → `result.lastMessage === 'hello from agent'`
- `executeReview` via `execute(reviewNode, ctx)`, DONE on first gate: `TestRunner(['work output', 'review output', 'DONE'])` → `result.verdict === 'DONE'`, `result.iterations === 1`
- `executeReview` via `execute(reviewNode, ctx)`, iterate once then DONE: `TestRunner(['work', 'review', 'ITERATE', 'work2', 'review2', 'DONE'])` with `maxIterations: 3` → `result.verdict === 'DONE'`, `result.iterations === 2`
- `executeRalph` via `execute(ralphNode, ctx)`, NEXT then DONE: inner is a work node, ralph gate runner returns `'NEXT'` on task 1 then `'DONE'` on task 2. The runner queue must interleave work and ralph gate calls: `['work1', 'NEXT', 'work2', 'DONE']` (the ralph gate call is a separate runner call after each inner execute). Verify `result.lastMessage === 'DONE'` (the ralph gate's last output).
- `executeRepeat` via `execute(repeatNode, ctx)`, inner work runs N times: `TestRunner(['pass1', 'pass2', 'pass3'])` with `count: 3` → runner called 3 times, `result.lastMessage === 'pass3'`

Note on `render()`: all `execute()` paths in this file call `render()` from Ink. The top-level `vi.mock('ink', ...)` call above stubs it out for all tests — this is required, not optional.

### Step 10 — Write `src/race.test.ts`

All tests here are pure function tests except `buildJudgePrompt` which reads log files.

**`parseJudgeVerdict` tests:**
- `'PICK 1'` with `maxRun: 3` → `1`
- `'PICK 2'` with `maxRun: 3` → `2`
- `'PICK 3'` with `maxRun: 3` → `3`
- `'PICK 4'` with `maxRun: 3` → `null` (out of range)
- `'PICK 0'` with `maxRun: 3` → `null` (below range)
- No `PICK` keyword → `null`
- Case insensitive: `'pick 2'` with `maxRun: 3` → `2`
- Leading whitespace: `'  PICK 1'` with `maxRun: 2` → `1`
- Multi-line: `'some output\nPICK 2\nreason'` with `maxRun: 3` → `2`

**`buildJudgePrompt` tests** (use temp dir for log files):
- Two results with `status: 'done'` and actual log files written to tmpDir → output contains `'--- Run 1 Log ---'` and `'--- Run 2 Log ---'`
- Result with `status: 'error'` → filtered out, not included in the prompt output
- With `customCriteria: 'prefer brevity'` → output contains `'Additional criteria: prefer brevity'`
- Log file that does not exist → output contains `'(no log)'`

**`sessionId` tests:**
- Format matches `/^\d{8}-\d{6}-[a-z0-9]{4}$/`
- Two calls return different values (probabilistic — `Math.random` is different each call)

### Step 11 — Write `src/template.test.ts`

**`renderTemplate` tests:**
- All `LoopContext` variables substituted: template `'Step: ${step}, iter: ${iteration}'`, ctx with those values → correct string
- Optional variables (`ralphIteration`, `maxRalph`, `repeatPass`, `maxRepeatPasses`) can be `undefined` → no crash, missing variable renders as empty string or `'undefined'` (document actual behavior)
- Template syntax error: template containing `${` followed by invalid JS → throws `Error` with message containing `'Template error in COOK.md'`

**`loadCookMD` tests:**
- Directory with no `COOK.md` → returns `DEFAULT_COOK_MD`
- Directory with a `COOK.md` file containing custom content → returns that content

For `loadCookMD`, use `tmpDir` to write a test `COOK.md` file.

### Step 12 — Run the full test suite

```
npm test
```

All tests must pass. If any test fails, fix before proceeding.

### Step 13 — Verify build still passes

```
npm run build
```

No TypeScript errors. The `dist/` output is not broken by the new `poolFactory` field.

---

## Alternatives Considered

### Fake CLI binary (shell script)

A shell script at a known path that prints a canned response. `NativeRunner` is pointed at it. No code changes. Rejected: requires filesystem coordination per test, env-var passing for responses is fragile across parallel tests, and the binary path must be on `PATH`. The `poolFactory` seam is cleaner.

### `vi.mock` module-level patching

Mock `race.ts`'s `createRunnerPool` export at the module level using Vitest's `vi.mock`. Rejected: module mocking is fragile, order-dependent, and affects the entire module for the duration of the test file. The `poolFactory` field is explicit, typed, and self-documenting.

### `RunnerPool` subclass or static factory

Add a `RunnerPool.withRunner(testRunner)` static method. Rejected: unnecessary API surface change to a production class. `testPoolFactory` in `src/testing/test-runner.ts` does the same thing without touching the production `RunnerPool`.

### Export `parseRalphVerdict` for direct unit testing

Make `parseRalphVerdict` an exported function so tests can call it directly. Adopted: this is a CLI tool, not a library, so there is no meaningful "public API surface" concern. The function has clear inputs and outputs, and testing it directly is more readable than inferring its behavior through the full `executeRalph` path. Both direct unit tests and behavior-level tests are included.
