# Decision: Runner Lifecycle for Per-Step Sandbox Modes

**Status:** Proposed
**Date:** 2026-03-06
**Deciders:** rjcorwin, AI

## Context

Decision 13 in research.md allows per-step sandbox mode overrides:

```json
{
  "sandbox": "agent",
  "steps": [
    { "prompt": "implement the feature", "agent": "claude", "sandbox": "agent" },
    { "prompt": "review the changes", "agent": "claude", "sandbox": "none" }
  ]
}
```

This means the runner may need to change between steps. Currently `agentLoop` receives a single `Sandbox` instance for the entire run. The question is: how does the loop manage multiple runners when sandbox mode varies per step?

## Options

### Option 1: Runner factory function

Pass a factory function to `agentLoop` instead of a runner instance. The loop creates a new runner per step based on that step's resolved sandbox mode.

```typescript
type RunnerFactory = (sandboxMode: "agent" | "docker" | "none") => AgentRunner

async function agentLoop(createRunner: RunnerFactory, steps: Step[]) {
  for (const step of steps) {
    const mode = step.sandbox ?? config.sandbox
    const runner = createRunner(mode)
    try {
      await runner.runAgent(step.agent, step.model, step.prompt)
    } finally {
      await runner.cleanup()
    }
  }
}
```

**Pros:**
- Clean separation — loop doesn't know about sandbox mode details
- Each runner's lifecycle is scoped to its step
- Cleanup is straightforward — each runner cleans up after its step

**Cons:**
- Docker runner has expensive setup (image build, container creation). Creating a new DockerSandbox per step that uses Docker is wasteful if multiple steps use Docker.
- Factory needs access to config to construct runners

### Option 2: Runner pool / cache

Create runners lazily and cache them by mode. Reuse runners across steps that share the same sandbox mode.

```typescript
class RunnerPool {
  private runners = new Map<string, AgentRunner>()

  get(mode: "agent" | "docker" | "none"): AgentRunner {
    if (!this.runners.has(mode)) {
      this.runners.set(mode, createRunner(mode))
    }
    return this.runners.get(mode)!
  }

  async cleanupAll() {
    for (const runner of this.runners.values()) {
      await runner.cleanup()
    }
  }
}
```

**Pros:**
- Docker container is created once and reused across all Docker steps
- NativeRunner temp dirs are created once and reused
- Cleanup happens once at the end

**Cons:**
- Runners live longer than needed — a Docker container stays running even during native-mode steps
- Cleanup only at end means temp dirs persist longer
- Slightly more complex lifecycle management

### Option 3: Pre-resolve runners before loop

Scan all steps, determine which sandbox modes are needed, create those runners upfront, then pass a map to the loop.

```typescript
const modes = new Set(steps.map(s => s.sandbox ?? config.sandbox))
const runners = new Map<string, AgentRunner>()
for (const mode of modes) {
  runners.set(mode, createRunner(mode))
}

async function agentLoop(runners: Map<string, AgentRunner>, steps: Step[]) {
  for (const step of steps) {
    const mode = step.sandbox ?? config.sandbox
    const runner = runners.get(mode)!
    await runner.runAgent(step.agent, step.model, step.prompt)
  }
}
// cleanup all after loop
```

**Pros:**
- All setup happens upfront — failures surface early (e.g., Docker not running)
- Simple loop — just looks up the runner
- Docker container reused across steps

**Cons:**
- Creates runners that might not be needed if an earlier step fails
- Same long-lived resource issue as Option 2
- Setup for all modes upfront may be slow (Docker build + native temp dirs)

## Decision

**Option 2: Runner pool / cache.**

Rationale:
- The common case is a single sandbox mode for all steps (top-level `sandbox` value, no per-step overrides). The pool degenerates to a single cached runner — no overhead.
- When per-step overrides exist, Docker reuse matters. Docker setup (image build, container creation) is the most expensive operation cook does. Building it once and reusing is worth the slightly longer container lifetime.
- Lazy creation (vs Option 3's upfront creation) avoids paying for modes that aren't reached due to early step failures.
- The pool is simple to implement — a Map with lazy initialization and a `cleanupAll()` method.
- NativeRunner's temp dir cleanup at end-of-run (rather than end-of-step) is acceptable since temp dirs are small and short-lived.

## Consequences

### Positive
- Docker containers are reused across steps — no redundant image builds
- Simple API: `pool.get(mode)` in the loop, `pool.cleanupAll()` at the end
- Lazy creation means no wasted setup

### Negative
- Runners (and their resources) live for the full duration of the cook run, even if only used in one step
- Must ensure `cleanupAll()` runs even on errors (try/finally)

### Neutral
- The `RunnerPool` is a new but small abstraction (~20 lines)
- The existing `Sandbox` class becomes `DockerSandbox` implementing `AgentRunner`, no behavior change
