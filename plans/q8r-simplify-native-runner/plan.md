# Plan: Simplify Native Runner — Drop Docker Requirement

**Status:** Draft (rev 2 — addresses plan-review-001 concerns)
**Author:** AI
**Created:** 2026-03-07

## Summary

Replace Cook's Docker-only execution with a runner abstraction that supports three modes: `agent` (native, default), `docker` (existing behavior), and `none` (bare, no sandbox). Native mode spawns agents directly on the host and trusts them to manage their own OS-level sandboxes (Claude's Seatbelt/Landlock, Codex's workspace sandbox). No agent config management, no temp directory isolation — just spawn and go. Docker becomes optional, `dockerode` is lazy-imported only when needed.

## Motivation

Docker is heavyweight for agents that already sandbox themselves at the OS level. New users must install and configure Docker before trying Cook, which is unnecessary friction. The prior plan (n5x) added native execution but also introduced significant complexity (agent config management, TOML parser, temp config directories). This plan keeps the good parts (runner interface, `--sandbox` flag, pool pattern) and drops everything else.

## Goals

- Native execution as the default — no Docker required for `cook` to work
- Docker mode preserved as `--sandbox docker` for users who want full container isolation
- Bare mode as `--sandbox none` for users who explicitly opt out of all safety
- OpenCode blocked from native mode (no OS-level sandbox)
- Per-step sandbox overrides (e.g., work in Docker, review natively)
- `dockerode` only imported when Docker mode is used
- `cook doctor` checks for agent CLIs when in native mode
- `cook init` simplified (no `.cook/agents/` directory)

## Non-Goals

- Managing agent sandbox configurations (users do this themselves)
- Per-agent permission flag resolution
- Config directory isolation (`CLAUDE_CONFIG_DIR` temp dirs)
- Network restriction in native mode (this is Docker-specific)
- Supporting OpenCode in native/bare modes

## Technical Design

### Runner Interface

Extract a minimal interface from the current `Sandbox` class:

```typescript
// src/runner.ts
export interface AgentRunner {
  runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void
  ): Promise<string>
  stop(): Promise<void>
}

export type SandboxMode = 'agent' | 'docker' | 'none'
```

### Runner Implementations

**NativeRunner** (`src/native-runner.ts`):
- Spawns agent process directly via `child_process.spawn()`
- Passes minimal flags: model selection, print/pipe mode, stdin prompt
- Agent commands:
  - `claude --model <model> -p` (reads prompt from stdin)
  - `codex exec --model <model> --skip-git-repo-check -` (reads from stdin)
- OpenCode: throws error — no OS-level sandbox, not supported in native mode
- No `--dangerously-skip-permissions` — agent uses its own sandbox config
- `stop()`: kills the spawned child process (SIGTERM, then SIGKILL)
- Passes through environment variables from `config.env`
- Sets `cwd` to project root

**DockerSandbox** (`src/sandbox.ts`, renamed/refactored):
- Existing Docker execution path, largely unchanged
- Implements `AgentRunner` interface
- `startSandbox()` factory signature unchanged: `startSandbox(docker, projectRoot, config, agents: AgentName[])`
- The `agents` list is provided by the runner factory closure in `cli.ts`, which captures `runAgents` from `resolveAgentPlan()` — same list already computed today for network rules and auth checks. When `RunnerPool.get('docker')` is called (lazily, on first docker-mode step), the factory calls `startSandbox(new Docker(), projectRoot, config, runAgents)` with the full agent list, pre-copying auth files and configuring network rules for all agents that will use Docker
- Still handles network restriction, auth file copying, user mapping

**BareRunner** (`src/bare-runner.ts`):
- Extends `NativeRunner` — shares all spawn logic via inheritance
- Overrides a single `protected getBypassFlags(agent: AgentName): string[]` method:
  - `claude`: returns `['--dangerously-skip-permissions']`
  - `codex`: returns `['--dangerously-bypass-approvals-and-sandbox']`
  - `opencode`: throws (same as NativeRunner — no safety net)
- NativeRunner's `getBypassFlags()` returns `[]` by default — no bypass flags
- `runAgent()` calls `this.getBypassFlags(agent)` and splices the result into the command args
- Warning printed to stderr when BareRunner is created
- This avoids duplicating spawn logic across two files — the only difference is the flags

### Runner Pool

```typescript
// src/runner.ts
export class RunnerPool {
  constructor(
    private factory: (mode: SandboxMode) => Promise<AgentRunner>
  ) {}

  async get(mode: SandboxMode): Promise<AgentRunner> {
    // Cache by mode — reuse runners across steps
    if (!this.runners.has(mode)) {
      this.runners.set(mode, await this.factory(mode))
    }
    return this.runners.get(mode)!
  }

  async stopAll(): Promise<void> {
    for (const runner of this.runners.values()) {
      await runner.stop()
    }
  }
}
```

### Config Changes

Extend `CookConfig` with a `sandbox` field:

```typescript
export interface CookConfig {
  sandbox: SandboxMode           // NEW — default: 'agent'
  network: { ... }               // existing, only relevant for docker mode
  env: string[]                  // existing
  animation: AnimationStyle      // existing
  agent: AgentName               // existing
  model?: string                 // existing
  steps: Record<StepName, StepAgentConfig & {
    sandbox?: SandboxMode        // NEW — per-step override
  }>
}
```

Default config changes:
- `sandbox: 'agent'` (was implicitly 'docker')
- Network config retained but only applied in docker mode

### CLI Changes

**`--sandbox` flag** on the main `cook` command:
- `--sandbox agent` (default): native execution
- `--sandbox docker`: existing Docker mode
- `--sandbox none`: bare execution with bypass flags

**`cook init`** generates:
- `COOK.md` (unchanged)
- `.cook.config.json` with `sandbox: "agent"` default
- `.cook.Dockerfile` (for docker mode, optional)
- `.cook/logs/` directory
- `.cook/.gitignore`

**`cook doctor`** checks:
- In `agent`/`none` mode: agent CLI is on PATH (`which claude`, `which codex`)
- In `docker` mode: Docker daemon reachable, base image present
- Auth credentials check (same as current, but native mode checks host paths directly)

### Loop Changes

`agentLoop()` signature changes from `sandbox: Sandbox` to a `getRunner` callback that resolves per-step sandbox modes:

```typescript
export async function agentLoop(
  getRunner: (mode: SandboxMode) => Promise<AgentRunner>,
  config: LoopConfig,
  cookMD: string,
  events: EventEmitter
): Promise<void>
```

`LoopStepConfig` gains an optional `sandbox` field:

```typescript
interface LoopStepConfig {
  agent: AgentName
  model: string
  sandbox: SandboxMode  // resolved from per-step override or global default
}
```

Inside the loop, each step resolves its runner via the callback:

```typescript
const runner = await getRunner(config.steps[step.name].sandbox)
output = await runner.runAgent(config.steps[step.name].agent, ...)
```

The `getRunner` callback is backed by `RunnerPool.get()`, which caches runners by mode — so a step using `docker` and a later step also using `docker` share the same container. The CLI creates the pool and passes `pool.get.bind(pool)` as the callback.

**Why a callback instead of `RunnerPool` directly**: The loop doesn't need to know about `RunnerPool` or `SandboxMode` semantics. It just needs "give me a runner for this step's mode." This keeps the loop's dependency surface minimal.

### Lazy Docker Import

`dockerode` and `tar-stream` are only imported when Docker mode is selected. The `RunnerPool` factory (shown above in CLI integration) uses dynamic `import()` inside the `'docker'` case. Since `src/sandbox.ts` imports `dockerode` and `tar-stream` at the top level, the lazy `import('./sandbox.js')` in the factory is sufficient — neither module is loaded until a Docker-mode step is actually requested.

The top-level `import Docker from 'dockerode'` in `cli.ts` (line 9) and `import { startSandbox } from './sandbox.js'` (line 13) must be removed and replaced with the dynamic imports inside the factory.

This means users who only use native mode never need Docker installed — the import won't fail because it never runs.

## Implementation Approach

### Phase 1: Runner Interface & NativeRunner

1. **Create `src/runner.ts`** — `AgentRunner` interface, `SandboxMode` type, `RunnerPool` class
2. **Create `src/native-runner.ts`** — `NativeRunner` class implementing `AgentRunner`
   - `runAgent()`: spawn agent process, pipe prompt via stdin, stream stdout lines
   - `stop()`: kill child process
   - OpenCode guard: throw if agent is 'opencode'
   - `protected getBypassFlags(agent): string[]` returns `[]` — no bypass flags
3. **Create `src/bare-runner.ts`** — `BareRunner extends NativeRunner`, overrides `getBypassFlags()` to return `--dangerously-*` flags per agent

### Phase 2: Refactor Existing Code

4. **Update `src/sandbox.ts`** — make `Sandbox` implement `AgentRunner` interface (already compatible, just add the `implements` clause)
5. **Update `src/loop.ts`** — change `sandbox` parameter to `getRunner: (mode: SandboxMode) => Promise<AgentRunner>` callback, add `sandbox` to `LoopStepConfig`, resolve runner per step
6. **Update `src/config.ts`** — add `sandbox` field to `CookConfig`, default to `'agent'`

### Phase 3: CLI Integration

7. **Update `src/cli.ts`**:
   - Add `--sandbox` flag parsing
   - Resolve per-step sandbox mode: `config.steps[step].sandbox ?? config.sandbox ?? parsed.sandbox ?? 'agent'`
   - Create runner factory closure that captures `runAgents` (from `resolveAgentPlan`), `config`, and `projectRoot`:
     ```typescript
     const pool = new RunnerPool(async (mode) => {
       switch (mode) {
         case 'agent': return new NativeRunner(projectRoot, config.env)
         case 'docker': {
           const Docker = (await import('dockerode')).default
           const { startSandbox } = await import('./sandbox.js')
           return startSandbox(new Docker(), projectRoot, config, runAgents)
         }
         case 'none': return new BareRunner(projectRoot, config.env)
       }
     })
     ```
   - Pass `pool.get.bind(pool)` as the `getRunner` callback to `agentLoop`
   - Update cleanup to use `pool.stopAll()`
8. **Update `cook init`** — add `sandbox: "agent"` to generated config
9. **Update `cook doctor`** — add native mode checks (agent CLI on PATH)

### Phase 4: Cleanup

10. **Move Docker-specific imports** — ensure `dockerode` and `tar-stream` are not top-level imports in cli.ts
11. **Update package.json** — mark `dockerode` and related types as optional peer dependencies (or keep as deps but document they're only needed for `--sandbox docker`)
12. **Test all three modes** end-to-end

### Key Files to Modify

| File | Change |
|------|--------|
| `src/runner.ts` | **NEW** — AgentRunner interface, SandboxMode, RunnerPool |
| `src/native-runner.ts` | **NEW** — NativeRunner class |
| `src/bare-runner.ts` | **NEW** — BareRunner class |
| `src/sandbox.ts` | Add `implements AgentRunner`, minor refactoring |
| `src/loop.ts` | Change parameter type from Sandbox to AgentRunner |
| `src/config.ts` | Add `sandbox` field to CookConfig |
| `src/cli.ts` | `--sandbox` flag, runner factory, lazy imports, updated init/doctor |

### Order of Operations

Phases 1 → 2 → 3 → 4, strictly sequential. Each phase builds on the previous. Phase 2 is the riskiest (refactoring existing code) but the changes are small — just a type rename and a parameter swap in loop.ts.

## Alternatives Considered

### Keep Docker as default, add native as opt-in
Rejected. The whole point is reducing friction for new users. Docker should be the opt-in for users who want extra isolation.

### Support OpenCode in native mode with advisory permissions
Rejected. OpenCode's permissions are advisory (user can approve anything). Running it natively without Docker gives a false sense of security. Better to be honest and block it.

### Manage agent configs in Cook (n5x approach)
Rejected. Adds ~200 lines of code (TOML parser, config templates, temp directory management) for marginal benefit. Users already configure their agents. Cook shouldn't duplicate that responsibility.

### Single Runner class with mode parameter instead of separate classes
Rejected. Separate classes are cleaner — each is small (~50-80 lines), has clear responsibility, and doesn't need conditional logic. The interface keeps them interchangeable.
