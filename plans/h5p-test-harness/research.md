# Research: Test Harness

**Requester:** rj
**Date:** 2026-03-17

## Requirements

### Original Request
Add a test harness to the cook CLI. Tests should cover the full SPEC.md surface — parser, executor, review loop, ralph, composition (vN/vs/resolvers). The core open question is how to mock the agent: abstract runners into pluggable things so a test runner can be injected, or hardcode a test agent path that does nothing when invoked.

### Context
The codebase has zero tests today. The `add-test-harness` branch is the target. The primary concern is how to intercept agent invocations — real LLM calls cannot run in tests.

### Open Questions

- **How is `RunnerPool` currently constructed — by the CLI, or inside the executor itself?**
  Inside the executor. `executeWork`, `executeReview`, `executeRalph`, and `executeComposition` each call `createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)` from `race.ts` directly. The CLI does not construct or pass in a pool.

- **Does the `ExecutionContext.runAgents` injection point fully control all agent calls, or do some code paths bypass the pool?**
  `ctx.runAgents` is `AgentName[]` — a plain array of agent name strings used only to tell Docker which images to prepare. It is not a `RunnerPool`. All agent calls go through a pool created internally via `createRunnerPool`. To control those calls in tests, the `createRunnerPool` call itself must be intercepted (see injection decision below).

- **Do composition branches (worktrees) spin up their own runner pools, or inherit from the parent context?**
  They get their own. `executeComposition` creates one pool per worktree via `worktrees.map(wt => createRunnerPool(wt.worktreePath, ctx.config, ctx.runAgents))` and passes each pool directly into `executeBranchForComposition` as a parameter. There is no inheritance — each branch gets a distinct `RunnerPool` instance.

- **Do we test composition (git worktrees) in integration tests, or stub above the worktree layer?**
  Stub above for v1. Full composition integration tests require a real git repo with worktree support, coordinated multi-runner mock responses, and temp directory setup. The cost is high; the gain is lower than testing the executor's other paths. Skip composition integration tests for v1 and cover the resolver pure functions (`buildJudgePrompt`, `parseJudgeVerdict`) directly.

- **Do we test Ink/React UI components, or skip UI entirely for now?**
  Skip. UI tests are fragile, low-value for a first harness, and require a terminal renderer. The data layer (parser, executor, loop) is what needs coverage.

- **Should the test runner be a first-class export, or an internal test helper?**
  Internal test helper. Export it from a `src/testing/` directory — importable by tests but not part of the public API.

## Pure Functions — Start Here

These functions require zero mocking, zero infrastructure, zero framework debate. They are the fastest tests to write and cover the bulk of the critical business logic. Write these first, unconditionally, before touching any injection infrastructure.

**`parse()` — `parser.ts`**
Pure function: `parse(args: string[]) => { ast: Node; flags: ParsedFlags }`. No I/O, no side effects. Every AST node type (work, repeat, review, ralph, composition) is reachable via argument strings.

**`parseGateVerdict()` — `loop.ts`**
`parseGateVerdict(output: string): 'DONE' | 'ITERATE'`. Scans lines for DONE/PASS/COMPLETE/APPROVE/ACCEPT or ITERATE/REVISE/RETRY. When no keyword is found, defaults to `'ITERATE'` (fail-safe continue). Straightforward table-driven tests.

**`parseRalphVerdict()` — `executor.ts`**
`parseRalphVerdict(output: string): 'NEXT' | 'DONE'`. Scans for DONE/COMPLETE/FINISHED or NEXT/CONTINUE. When no keyword is found, defaults to `'DONE'` (fail-safe stop). This is the **opposite** default from `parseGateVerdict` — the asymmetry is intentional and exactly the kind of behavior that needs a test to document and guard.

**`parseJudgeVerdict()` — `race.ts`**
`parseJudgeVerdict(output: string, maxRun: number): number | null`. Parses `PICK N` from output; returns `null` if no valid pick is found. Boundary tests on `maxRun` are important.

**`buildJudgePrompt()` — `race.ts`**
`buildJudgePrompt(results: RunResult[], customCriteria?: string): string`. Pure string construction (reads log files from disk, so tests need temp files or mock `RunResult` objects with `status: 'error'` to skip the read path). The no-log-file path (`fs.existsSync` returns false) is worth testing separately.

**`renderTemplate()` — `template.ts`**
`renderTemplate(cookMD: string, ctx: LoopContext): string`. Uses `new Function()` internally to evaluate template expressions. Template errors surface as runtime exceptions — test the error path explicitly.

**`sessionId()` — `race.ts`**
Pure function with a random component. Test the format (regex against `YYYYMMDD-HHMMSS-xxxx`) rather than the value.

## System Architecture

### Related Components

**`runner.ts` — `AgentRunner` interface + `RunnerPool`**
The `AgentRunner` interface (`runAgent(agent, model, prompt, onLine): Promise<string>` and `stop()`) is the single seam through which all LLM calls flow. `RunnerPool` wraps a factory `(mode: SandboxMode) => Promise<AgentRunner>` and lazily creates one runner per mode. The constructor takes the factory directly — `new RunnerPool(async () => testRunner)` is how tests create a pool that always returns a fixed mock runner.

**`executor.ts` — Recursive AST executor**
`execute(node, ctx: ExecutionContext)` dispatches on node type. `ExecutionContext` carries `runAgents: AgentName[]` (a plain string array, not a pool). Each executor function — `executeWork`, `executeReview`, `executeRalph`, `executeComposition` — calls `createRunnerPool(ctx.projectRoot, ctx.config, ctx.runAgents)` internally to build its own pool. The injection seam is in how `createRunnerPool` is called, not in `ExecutionContext` directly.

**`loop.ts` — `agentLoop()`**
`agentLoop(getRunner, config, cookMD, events)` receives a `getRunner: (mode: SandboxMode) => Promise<AgentRunner>` factory callback and an `EventEmitter`. It does not hold a `RunnerPool` reference. Tests that call `agentLoop` directly pass their own `EventEmitter`, bypassing the `loopEvents` singleton entirely.

**`race.ts` — `createRunnerPool()`, resolvers, user prompts**
`createRunnerPool(worktreePath, config, runAgents)` is the factory that wraps real runners (`NativeRunner`, `BareRunner`, Docker). This is the function tests must replace. Also contains `confirm()` and `pickOne()`, which read from `process.stdin` — see constraint below.

**`parser.ts` — Recursive descent parser**
Pure function. No I/O, no side effects.

**`template.ts`, `config.ts`, `log.ts`**
Mostly pure or I/O-bound (filesystem). Template and config are unit-testable. Log writes to `.cook/logs/` which needs a temp directory in tests.

**`native-runner.ts`, `sandbox.ts`, `bare-runner.ts`**
All implement `AgentRunner`. These must never run in tests — they spawn real CLI processes or Docker containers.

### Data Flow

```
CLI args
  → parse() → AST + flags           [pure, testable as-is]
  → execute(ast, ctx)
      ctx.runAgents: AgentName[]     [string array, not a pool]
      → ctx.poolFactory(worktreePath, config, runAgents)
          → pool.get(mode) → AgentRunner
          → runner.runAgent(...)     [mock here for tests]
      → agentLoop(pool.get.bind(pool), ...)
      → emit events (loopEvents)
```

For composition:
```
execute(composition, ctx)
  → git worktree add (per branch)
  → pools = worktrees.map(wt => ctx.poolFactory(wt.worktreePath, config, runAgents))
  → executeBranchForComposition(branchNode, branchCtx, pools[i], emitters[i])
      → pool.get(mode) → AgentRunner
  → resolver (pick/merge/compare)
      → runner.runAgent(...)         [judge/merge agent call — same pool]
```

The composition injection story is clean: `executeBranchForComposition` already accepts `pool` as a direct parameter. `executeComposition` creates pools (one per worktree) and passes them in. Controlling how `createRunnerPool` is called in `executeComposition` gives full control over all branch runners.

### Constraints

- Node 20+, ES2022, TypeScript strict
- No test framework currently installed
- Composition integration tests require a real git repo with worktree support — deferred to v1+
- Tests must be fast — no real LLM calls, no Docker
- CI environment may not have `git worktree` available (check: `git worktree list`)
- `loopEvents` is a module-level singleton `EventEmitter` — parallel tests that go through the executor path may have event cross-talk (see mitigation below)
- `confirm()` and `pickOne()` in `race.ts` read from `process.stdin` — any test that exercises the non-auto resolver paths (`resolvePick` without auto-pick, `resolveCompare`) will hang waiting for input. Tests must either exercise only the auto-resolve paths or mock stdin.

## Prior Art

### `AgentRunner` interface
Already well-defined. A `TestRunner` implementing this interface is the natural mock object:

```typescript
class TestRunner implements AgentRunner {
  constructor(private responses: string[]) {}
  async runAgent(agent, model, prompt, onLine): Promise<string> {
    const response = this.responses.shift() ?? 'DONE'
    for (const line of response.split('\n')) onLine(line)
    return response
  }
  async stop() {}
}
```

### Option: Fake CLI binary
A shell script at a known path that reads `COOK_TEST_RESPONSE` from env and prints it. The `NativeRunner` would be pointed at this binary. No code changes needed, but: requires filesystem setup per test, env var coordination across parallel tests is fragile, and the script path must be on `PATH`.

### Option: Interface injection
Pass a `TestRunner` (or a factory) into `ExecutionContext`. Tests construct the context directly and never touch `NativeRunner`. This is cleanest but requires the executor to accept an injectable runner factory, not just a `RunnerPool` of real modes.

### Option: `RunnerPool` subclass / factory
Add a static factory or constructor param to `RunnerPool` so you can say `RunnerPool.withRunner(testRunner)`. The pool's `get()` method returns the injected runner regardless of mode. Minimal API surface change.

### Chosen approach: `poolFactory` field on `ExecutionContext`

Add a `poolFactory` field to `ExecutionContext`:

```typescript
export interface ExecutionContext {
  // ... existing fields ...
  poolFactory?: (worktreePath: string, config: CookConfig, runAgents: AgentName[]) => RunnerPool
}
```

Each executor function (`executeWork`, `executeReview`, `executeRalph`, `executeComposition`) replaces its direct `createRunnerPool(...)` call with `(ctx.poolFactory ?? createRunnerPool)(ctx.projectRoot, ctx.config, ctx.runAgents)`. In production, the field is absent and `createRunnerPool` from `race.ts` is used. In tests:

```typescript
const testRunner = new TestRunner(['DONE'])
const ctx: ExecutionContext = {
  // ...
  poolFactory: () => new RunnerPool(async () => testRunner),
}
```

One field. No subclass. No binary. No `vi.mock` module-level patching. This covers `executeWork`, `executeReview`, `executeRalph`, and `executeComposition` (which also uses `createRunnerPool` for the per-worktree pools — replacing it via `poolFactory` gives control over all branch runners automatically).

### Vitest
Natural fit: TypeScript-native, ESM-native, no transform config overhead, compatible with Node 20. Vitest also provides `vi.fn()` and import mocking if needed. Jest requires extra transform setup for ES2022/NodeNext modules.

## `loopEvents` Singleton

`agentLoop` already accepts `events: EventEmitter` as a parameter. Tests that call `agentLoop` directly pass their own `EventEmitter` — the `loopEvents` singleton is never touched. The singleton is only a hazard for tests that go through the executor path (`executeWork`, `executeReview`), since those functions pass `loopEvents` by name.

Mitigation: use `test.sequential` in Vitest for executor-level tests. No refactor needed for v1.

## Recommended Test File Layout

Co-locate test files next to source:

```
src/
  parser.test.ts
  loop.test.ts        (parseGateVerdict, agentLoop)
  executor.test.ts    (executeWork, executeReview, executeRalph — sequential)
  race.test.ts        (parseJudgeVerdict, buildJudgePrompt, sessionId)
  template.test.ts
```

Vitest config for a `NodeNext` module resolution project:

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

The `NodeNext` resolution used by the main `tsconfig.json` requires `.js` extensions on imports. Vitest handles this without a custom resolver when `environment: 'node'` is set, but verify that `tsconfig.json`'s `moduleResolution` is not overriding Vitest's default transform.

## Open Questions

1. **Runner pool injection in composition branches**: Resolved. `executeBranchForComposition` already accepts `pool` as a direct parameter. `executeComposition` creates the pools and passes them in. With `poolFactory` on `ExecutionContext`, `executeComposition` will use `ctx.poolFactory` when building those pools, and all branches receive the test runner automatically.

2. **`loopEvents` singleton**: Resolved. Tests that call `agentLoop` directly pass their own `EventEmitter` and bypass the singleton. Executor-level tests use `test.sequential` in Vitest to prevent cross-talk without any code refactor.

3. **Git worktree availability**: Resolved for v1. Composition integration tests are deferred. Pure function tests for `buildJudgePrompt` and `parseJudgeVerdict` need no git at all. If composition integration tests are added later, guard them with a `git worktree list` check and `test.skipIf`.

4. **Test scope for composition**: Decided. V1 covers: (a) pure functions in `race.ts`, and (b) the composition orchestration logic at the `executeComposition` level using `poolFactory` injection with a temp git repo if needed. Full resolver integration with real worktrees is v1+. The auto-pick path of `resolvePick` is testable without stdin interaction; non-auto paths require stdin mocking and are deferred.

5. **UI components**: Skip for v1. Ink components (`App.tsx`, `RaceApp.tsx`, `LogStream.tsx`) render to terminal. `@inkjs/testing` provides a test renderer but UI tests are fragile and low-value for a first harness.

6. **`agentLoop` return shape vs events**: Tests assert on the `LoopResult` return value directly. Event emission can be verified by inspecting the `EventEmitter` passed in, but is lower priority.

7. **Log file writes**: `agentLoop` and executor functions write to `.cook/logs/`. Tests use a temp directory (e.g., from `os.tmpdir()`) as `projectRoot` to avoid polluting the real repo and to enable parallel test isolation for non-executor tests.
