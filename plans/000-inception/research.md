# Research: arpi — Sandboxed RPI Workflow

## What arpi Is

arpi is a bash script that automates a Research-Plan-Implement workflow using chained `claude -p` calls. Each phase (research, plan, implement) includes AI-driven review iterations with gate checks before proceeding. The output is a structured `plans/` directory with research docs, architectural decisions, devlogs, and a PR description.

The current prototype lives as a single bash script. It uses `--dangerously-skip-permissions` by default because the workflow requires Claude to read code, write files, and run commands without interactive prompts.

## Who It's For

Developers who:
- Already have the `claude` CLI installed and use it regularly
- Are on Mac or Linux
- Likely have Docker installed (or would install it for this)
- May or may not already follow an RPI-style workflow
- Are currently running `claude --dangerously-skip-permissions` on their host machine out of convenience
- Want a structured way to go from feature ask to PR with AI assistance

The key persona is a developer who knows skip-permissions is risky but does it anyway because the alternative (approving every tool use in a long automated pipeline) is impractical. arpi should make the safe thing the easy thing.

## Requirements

### Core
- One-command install (`curl | sh`)
- Run from any project directory: `arpi yolo "Add dark mode"`
- Every `claude` invocation runs inside a sandboxed container, never on the host
- The developer never needs to think about Docker — arpi manages the container lifecycle
- Works on Mac (Intel + Apple Silicon) and Linux (Ubuntu, Debian, Fedora)

### Sandbox Properties
- **Filesystem isolation:** Claude can only read/write the mounted project directory. No access to home dir, SSH keys, other repos, etc.
- **Network restriction:** Outbound traffic limited to Anthropic API (and optionally package registries). No arbitrary HTTP calls, no data exfiltration to unknown hosts.
- **Disposable:** Each `claude` invocation is a fresh `docker run --rm`. No state persists in the container between calls.
- **Git access:** Claude needs to run git commands inside the container (diff, log, commit, branch). The mounted project dir is a git repo.

### Ergonomics
- arpi itself runs on the host — orchestration logic (arg parsing, iteration loops, gate checks, logging) stays native
- Only the `claude -p` calls are containerized
- Auth via `ANTHROPIC_API_KEY` environment variable, passed into the container
- No need to install claude, node, or arpi inside the container image
- Startup overhead per `claude` call should be minimal (container reuse or fast image)

### Workflow (inherited from current prototype)
- `arpi new "feature ask"` — create plan directory with ask.md
- `arpi research <slug>` — AI researches the codebase, writes research.md, iterates with reviews
- `arpi plan <slug>` — AI writes plan.md + decision docs, iterates with reviews
- `arpi implement <slug>` — AI implements the plan, iterates with code reviews, generates pr.md
- `arpi yolo "feature ask"` — run all phases end-to-end
- Configurable: `--iterations N`, `--model MODEL`

## Options Explored

### Option 1: arpi on host, claude in disposable containers

arpi runs natively. Each `run_claude()` call does a `docker run --rm` with the project directory mounted and network locked down.

```bash
run_claude() {
    local prompt="$1"
    docker run --rm \
        -v "$PROJECT_ROOT":"$PROJECT_ROOT" \
        -w "$PROJECT_ROOT" \
        -e ANTHROPIC_API_KEY \
        --network=arpi-restricted \
        arpi-sandbox \
        claude --model "$MODEL" --dangerously-skip-permissions -p "$prompt"
}
```

Network restriction via a Docker network with an iptables-based egress firewall (only allow Anthropic API endpoints).

**Pros:**
- Minimal container image (just claude CLI + git)
- arpi logic stays native — fast, easy to debug, no Docker overhead for orchestration
- Each call is isolated and disposable
- Simple mental model: arpi is the orchestrator, container is the sandbox

**Cons:**
- Many short-lived containers per run (research + review + gate = ~5 containers per phase, ~15+ for a full yolo)
- Docker network setup for egress filtering adds initial setup complexity
- Container startup time multiplied across many invocations

### Option 2: Long-running container, arpi shells in

Start one container at the beginning of a phase, run multiple `claude` calls inside it via `docker exec`, tear it down at the end.

```bash
start_sandbox() {
    CONTAINER_ID=$(docker run -d \
        -v "$PROJECT_ROOT":"$PROJECT_ROOT" \
        -w "$PROJECT_ROOT" \
        -e ANTHROPIC_API_KEY \
        --network=arpi-restricted \
        arpi-sandbox sleep infinity)
}

run_claude() {
    docker exec "$CONTAINER_ID" \
        claude --model "$MODEL" --dangerously-skip-permissions -p "$1"
}

stop_sandbox() {
    docker rm -f "$CONTAINER_ID"
}
```

**Pros:**
- One container startup per phase (or per full run)
- Faster — no repeated container startup overhead
- Container state (npm cache, etc.) persists within the run

**Cons:**
- Long-running container is a wider attack surface than disposable
- State leaks between claude calls within a phase (by design, but worth noting)
- Need cleanup logic (trap on EXIT to kill container)

### Option 3: arpi itself runs inside the container

Package both arpi and claude into the container. The host just does `docker run arpi yolo "..."`.

**Pros:**
- Single `docker run` command
- Everything sandboxed including arpi's own logic

**Cons:**
- Requires rebuilding the image when arpi changes (friction during development)
- Logging and terminal colors may behave differently inside container
- Harder to debug — can't just edit the script and rerun
- Developer loses visibility into what's happening (arpi's output is inside the container)
- Doesn't match the "arpi is a lightweight script on your machine" pitch

### Option 4: No Docker — use bubblewrap (Linux only)

Replace Docker with bubblewrap namespace isolation.

**Pros:**
- No Docker dependency
- Near-zero overhead
- Fine-grained filesystem control

**Cons:**
- Linux only — no Mac support, which eliminates half the target audience
- Network isolation requires additional setup (network namespaces, not just bubblewrap)
- Less familiar to most developers

### Option 5: Docker Sandbox (Docker Desktop feature)

Use `docker sandbox run claude` from Docker Desktop 4.58+.

**Pros:**
- Firecracker microVM — strongest isolation
- Claude CLI pre-installed

**Cons:**
- Requires Docker Desktop (paid license on Linux)
- Not scriptable in the way arpi needs (designed for interactive use)
- Can't easily control per-invocation lifecycle from a host script

## Recommendation

**Option 2: Long-running container, arpi shells in.**

Reasoning:
- A full `yolo` run makes 15+ `claude` calls. Disposable containers (Option 1) multiply startup overhead unacceptably. Option 2 pays the startup cost once.
- Keeping arpi on the host (not Option 3) means the developer can `curl | sh` to install, edit the script freely, see output natively, and not deal with image rebuilds during iteration.
- The long-running container's "wider attack surface" is acceptable because: the container is still network-restricted and filesystem-isolated, the run is bounded in time (minutes to hours, not days), and cleanup is handled by a trap.
- Mac support eliminates Option 4 (bubblewrap). Docker Desktop licensing eliminates Option 5 for broad adoption. Docker Engine is free on both Mac and Linux.

### Architecture

```
Host                          Container
────                          ─────────
arpi (bash script)            claude CLI + git
  ├── arg parsing             mounted: $PROJECT_ROOT (rw)
  ├── plan dir management     network: arpi-restricted
  ├── iteration loops           (egress: Anthropic API only)
  ├── gate checks             env: ANTHROPIC_API_KEY
  ├── logging/colors
  └── docker exec → ─────────→ claude -p "..."
```

### Container lifecycle

```bash
# On first run_claude() call, start container
# On script exit (success or failure), tear down
trap 'docker rm -f "$CONTAINER_ID" 2>/dev/null' EXIT

start_sandbox() {
    docker run -d --rm \
        --name "arpi-$$" \
        -v "$PROJECT_ROOT":"$PROJECT_ROOT" \
        -w "$PROJECT_ROOT" \
        -e ANTHROPIC_API_KEY \
        --network=arpi-restricted \
        arpi-sandbox \
        sleep infinity
    CONTAINER_ID="arpi-$$"
}

run_claude() {
    [[ -z "$CONTAINER_ID" ]] && start_sandbox
    docker exec "$CONTAINER_ID" \
        claude --model "$MODEL" --dangerously-skip-permissions -p "$1"
}
```

### Network restriction

Create a Docker network on first run that only allows egress to Anthropic API:

```bash
# One-time setup (idempotent)
docker network create arpi-restricted 2>/dev/null || true

# Container uses iptables in entrypoint to restrict egress
# Allow: api.anthropic.com (and DNS for resolution)
# Deny: everything else
```

The container entrypoint script sets iptables rules before exec-ing into `sleep infinity`. This way the restriction is baked into the container, not dependent on host firewall config.

## Important Context

### Auth
- `ANTHROPIC_API_KEY` is the only credential passed into the container. No `.claude/` config dirs, no SSH keys, no git credentials.
- This means Claude inside the container authenticates via API key only, not OAuth.
- Developers need the API key in their environment. The install script should check for this and provide guidance.

### Git inside the container
- The project dir is mounted read-write, so git operations work against the real repo.
- Git needs `user.name` and `user.email` for commits. Options: mount `~/.gitconfig` read-only (leaks some info), pass them as env vars, or set them in the container entrypoint.
- Recommendation: pass `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` as env vars derived from the host's git config. Minimal info exposure.

### Claude CLI inside the container
- The container image must include `claude` CLI (`npm install -g @anthropic-ai/claude-code`).
- This pins the claude version at image build time. The image should be rebuilt periodically or use a version tag.
- Alternative: mount the host's claude binary into the container. This avoids version pinning but couples to host's node/npm setup and may have dynamic linking issues across OS boundaries.
- Recommendation: install claude in the image. Accept the version pinning. Provide an `arpi update` command that rebuilds the image.

### CONTRIBUTING.md and CLAUDE.md dependency
- The current arpi prompts reference `CONTRIBUTING.md` and `CLAUDE.md` in the project root. These provide workflow templates and project context.
- For adoption: arpi should work without these files (graceful degradation). The prompts should be self-contained enough to produce useful output even if these files don't exist.
- Stretch: `arpi init` could scaffold minimal versions of these files.

### Image distribution
- Option A: Developer builds locally (`arpi` runs `docker build` on first use from a bundled Dockerfile).
- Option B: Pre-built image on Docker Hub / GitHub Container Registry.
- Recommendation: start with local builds (simpler, no registry account needed). Move to pre-built images once the Dockerfile stabilizes. The install script can bundle the Dockerfile inline or download it.

### Platform considerations
- Docker Engine on Mac requires Docker Desktop (or alternatives like Colima, Rancher Desktop, OrbStack). The install script should detect what's available.
- On Linux, Docker Engine is free and standalone.
- Apple Silicon (ARM) vs Intel: the container image needs to be multi-arch or built locally.
- Recommendation: build locally by default (handles arch automatically). Offer multi-arch pre-built images later.
