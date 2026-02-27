# Decision: Sandbox Architecture

**Status:** Accepted
**Date:** 2026-02-22
**Deciders:** rjcorwin

## Context

arpi chains multiple `claude -p` calls across research, plan, and implement phases. Each call currently runs on the host with `--dangerously-skip-permissions`. We need to sandbox these calls so Claude can read/write code and run commands without access to the broader host system. The question is how to structure the relationship between arpi (the orchestrator) and the sandboxed Claude invocations.

## Options

### Option 1: Disposable containers per call

Each `run_claude()` spawns a fresh `docker run --rm`. arpi orchestrates from the host.

**Pros:**
- Maximum isolation — no state leaks between calls
- Simple mental model

**Cons:**
- A full `yolo` run makes 15+ calls; startup overhead multiplied across all of them
- Many short-lived containers to manage

### Option 2: Long-running container, arpi shells in

Start one container per phase (or per full run) with `sleep infinity`. Use `docker exec` for each `claude` call. Tear down on exit.

**Pros:**
- One container startup cost per run
- Faster iteration — no repeated startup overhead
- Container state (caches, etc.) persists within the run
- arpi stays on host: easy to install, edit, debug, see output natively

**Cons:**
- Long-running container has a wider attack surface than disposable
- State leaks between calls within a phase (by design)
- Needs cleanup logic (trap on EXIT)

### Option 3: Everything inside the container

Package arpi + claude into the container. Host just runs `docker run arpi yolo "..."`.

**Pros:**
- Single command
- Everything sandboxed

**Cons:**
- Image rebuilds on every arpi change — friction during development
- Developer loses visibility into orchestration output
- Doesn't match the "lightweight script on your machine" pitch

### Option 4: Bubblewrap (Linux only)

Namespace isolation via bubblewrap instead of Docker.

**Pros:**
- No Docker dependency
- Near-zero overhead

**Cons:**
- Linux only — no Mac support, eliminates half the audience
- Network isolation requires additional setup beyond bubblewrap

### Option 5: Docker Desktop Sandbox

Use `docker sandbox run claude` from Docker Desktop 4.58+.

**Pros:**
- Firecracker microVM — strongest isolation

**Cons:**
- Requires Docker Desktop (paid on Linux)
- Not scriptable in the way arpi needs

## Decision

**Option 2: Long-running container, arpi shells in.**

The primary driver is performance. A full yolo run makes 15+ Claude calls, and paying container startup cost each time is unacceptable. The long-running container pays that cost once.

Keeping arpi on the host preserves the developer experience: `curl | sh` install, native terminal output, edit-and-rerun iteration. The container is still network-restricted and filesystem-isolated, and runs are bounded in time, so the wider attack surface of a long-running container is acceptable.

Mac support eliminates Option 4. Docker Desktop licensing eliminates Option 5. Option 3 adds friction without meaningful benefit.

## Consequences

### Positive
- Fast Claude calls after initial container startup
- arpi remains a simple host-side script
- Developers get native terminal experience for orchestration output

### Negative
- State can leak between Claude calls within a run (acceptable tradeoff)
- Cleanup logic required (EXIT trap to kill container)
- Developers need Docker Engine installed

### Neutral
- Container image must include claude CLI + git, pinning versions at build time
