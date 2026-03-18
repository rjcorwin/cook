# Research: Test Harness

**Requester:** rj
**Date:** 2026-03-17

## Requirements

### Original Request
Add a test harness to the cook CLI. Tests should cover the full SPEC.md surface — parser, executor, review loop, ralph, composition (vN/vs/resolvers). The core open question is how to mock the agent: abstract runners into pluggable things so a test runner can be injected, or hardcode a test agent path that does nothing when invoked.

### Context
The codebase has zero tests today. The `add-test-harness` branch is the target. The primary concern is how to intercept agent invocations — real LLM calls cannot run in tests.

### Open Questions
- How is `RunnerPool` currently constructed — by the CLI, or inside the executor itself?
- Does the `ExecutionContext.runAgents` injection point fully control all agent calls, or do some code paths bypass the pool?
- Do composition branches (worktrees) spin up their own runner pools, or inherit from the parent context?
- Do we test composition (git worktrees) in integration tests, or stub above the worktree layer?
- Do we test Ink/React UI components, or skip UI entirely for now?
- Should the test runner be a first-class export, or an internal test helper?

## System Architecture

### Related Components

**`runner.ts` — `AgentRunner` interface + `RunnerPool`**
The `AgentRunner` interface (`runAgent(agent, model, prompt, onLine): Promise<string>` and `stop()`) is the single seam through which all LLM calls flow. `RunnerPool` lazily creates one runner per `SandboxMode` (`agent`, `docker`, `none`). This is the injection point.

**`executor.ts` — Recursive AST executor**
`execute(node, ctx: ExecutionContext)` dispatches on node type. `ExecutionContext` carries `runAgents: RunnerPool`. For compositions, `executeBranchForComposition()` runs each branch in its own git worktree with a separate runner pool instance. This is where the injection story gets complicated for composition tests.

**`loop.ts` — `agentLoop()`**
The `agentLoop()` function receives a `getRunner: () => Promise<AgentRunner>` factory callback — it does not hold a `RunnerPool` reference directly. This is a cleaner injection point than the pool itself.

**`parser.ts` — Recursive descent parser**
Pure function: `parse(args: string[]) => { ast: Node; flags: ParsedFlags }`. No I/O, no side effects. Straightforward to unit test without any mocking.

**`template.ts`, `config.ts`, `log.ts`**
Mostly pure or I/O-bound (filesystem). Template and config are unit-testable. Log writes to `.cook/logs/` which needs a temp directory in tests.

**`native-runner.ts`, `sandbox.ts`, `bare-runner.ts`**
All implement `AgentRunner`. These must never run in tests — they spawn real CLI processes or Docker containers.

### Data Flow

```
CLI args
  → parse() → AST + flags           [pure, testable as-is]
  → execute(ast, ctx)
      ctx.runAgents: RunnerPool      [injection seam]
      → pool.get(mode) → AgentRunner
      → runner.runAgent(...)         [mock here for tests]
      → agentLoop(getRunner, ...)
      → emit events (loopEvents)
```

For composition:
```
execute(composition, ctx)
  → git worktree add (per branch)
  → executeBranchForComposition(worktree, ...)
      → new RunnerPool()             [creates its own pool]
      → execute(branch, branchCtx)
  → resolver (pick/merge/compare)
      → runner.runAgent(...)         [judge/merge agent call]
```

The composition branches create their own `RunnerPool` instances. Any injection strategy must propagate into those branch contexts too.

### Constraints

- Node 20+, ES2022, TypeScript strict
- No test framework currently installed
- Composition tests require a real git repo with worktree support
- Tests must be fast — no real LLM calls, no Docker
- CI environment may not have `git worktree` available (check: `git worktree list`)
- `loopEvents` is a module-level singleton `EventEmitter` — parallel tests may interfere if they share it

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

### Vitest
Natural fit: TypeScript-native, ESM-native, no transform config overhead, compatible with Node 20. Vitest also provides `vi.fn()` and import mocking if needed. Jest requires extra transform setup for ES2022/NodeNext modules.

---

## Open Questions

1. **Runner pool injection in composition branches**: `executeBranchForComposition` currently calls `new RunnerPool()` or similar internally. Does the branch context accept an injectable runner factory, or does it hardcode real pool creation? If hardcoded, we need a refactor or we skip composition integration tests and test at a higher level of abstraction.

2. **`loopEvents` singleton**: The global `EventEmitter` in `loop.ts` is shared across all calls. Parallel Vitest workers or concurrent tests that trigger `agentLoop` will have event cross-talk. Mitigation: run executor tests serially, or refactor `loopEvents` to be passed in (dependency injection).

3. **Git worktree availability**: Composition tests need `git worktree add`. In a fresh temp dir, git must be initialized first. CI runners generally have git. We need to decide: (a) skip composition tests if worktrees aren't available, (b) mock git operations, or (c) always use a real temp git repo and accept the I/O cost.

4. **Test scope for composition**: Compositions (vN, vs, resolvers) are the most complex part of the executor. Full integration tests would require git, temp dirs, and multiple mock agent responses coordinated across branches. An alternative is to test the composition orchestration logic (branch creation, parallel execution, resolver dispatch) with mocked subprocess calls, trusting the resolver agent calls to the same `AgentRunner` mock.

5. **UI components**: Ink components (`App.tsx`, `RaceApp.tsx`, `LogStream.tsx`) render to terminal. `@inkjs/testing` provides a test renderer, but UI tests are fragile and low-value for a first harness. Recommend skipping UI tests in v1 and covering the data layer.

6. **`agentLoop` return shape vs events**: `agentLoop` both returns a `LoopResult` and emits events. Tests can assert on the return value directly (simpler). Event emission could be verified separately if needed, but is lower priority.

7. **Log file writes**: `agentLoop` and executor write to `.cook/logs/`. Tests need a temp project root to avoid polluting the real repo and to allow parallel test isolation.
