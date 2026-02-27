# Plan: arpi — Sandboxed RPI Workflow

**Status:** Draft
**Author:** rjcorwin
**Created:** 2026-02-27

## Summary

Transform the existing `arpi` bash script from running `claude --dangerously-skip-permissions` on the host into running Claude inside a Docker container with filesystem isolation. The script keeps its current RPI workflow (new, research, plan, implement, yolo) but wraps every `claude` call in `docker exec` against a long-running sandbox container. An optional `arpi init` command lets projects opt into network restrictions, custom sandbox images, and a default ARPI.md.

## Motivation

arpi's target user already runs `claude --dangerously-skip-permissions` because the alternative (approving every tool use in a long automated pipeline) is impractical. arpi should make the safe thing the easy thing: same workflow, same output, but Claude can only touch the project directory, can't access SSH keys or cloud credentials, and can't reach arbitrary network endpoints.

## Goals

- Every `claude` call runs inside a container — never on the host
- Zero setup required: `arpi yolo "Add dark mode"` works immediately in any project with Docker installed
- Auth works for subscription users (OAuth via `~/.claude/`) and API key users alike
- Optional `arpi init` for projects that want network restriction, custom runtimes, or a ARPI.md scaffold
- Minimal changes to the existing script structure — same commands, same prompts, same output

## Non-Goals

- GUI or web interface
- Supporting non-Docker sandbox backends (bubblewrap, Firecracker) in v1
- Pre-built multi-arch images on a registry (local builds only for now)
- Running arpi itself inside the container
- Interactive `claude` sessions (only `claude -p` / `--print`)

## Technical Design

### Architecture (decision-001)

```
Host                              Container
────                              ─────────
arpi (bash script)                claude CLI + git + basic Unix tools
  ├── arg parsing                 mounted: $PROJECT_ROOT (rw)
  ├── plan dir management         mounted: ~/.claude/ (ro)
  ├── iteration loops             env: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL,
  ├── gate checks                      GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL
  ├── logging/colors              network: default (or restricted via config)
  └── docker exec ──────────────→ claude --print -p "..."
```

### Container lifecycle

arpi starts a long-running container on first `run_claude()` call and tears it down on script exit.

```bash
CONTAINER_ID=""

start_sandbox() {
    local image="arpi-sandbox"
    local network_args=""

    # Use project-specific image if .arpi.Dockerfile exists
    if [[ -f "$PROJECT_ROOT/.arpi.Dockerfile" ]]; then
        image="arpi-project-$(basename "$PROJECT_ROOT")"
        # Build if not cached (content-addressed via Dockerfile hash)
        local dockerfile_hash
        dockerfile_hash=$(sha256sum "$PROJECT_ROOT/.arpi.Dockerfile" | cut -c1-12)
        image="${image}:${dockerfile_hash}"
        if ! docker image inspect "$image" &>/dev/null; then
            docker build -t "$image" -f "$PROJECT_ROOT/.arpi.Dockerfile" "$PROJECT_ROOT"
        fi
    fi

    # Network restriction if configured
    if [[ -f "$PROJECT_ROOT/.arpi.config.json" ]]; then
        local network_mode
        network_mode=$(jq -r '.network.mode // empty' "$PROJECT_ROOT/.arpi.config.json" 2>/dev/null)
        if [[ "$network_mode" == "restricted" ]]; then
            ensure_restricted_network
            network_args="--network=arpi-restricted"
        fi
    fi

    # Derive git identity from host
    local git_name git_email
    git_name=$(git config user.name 2>/dev/null || echo "arpi")
    git_email=$(git config user.email 2>/dev/null || echo "arpi@localhost")

    # Collect extra env vars from config
    local env_args=""
    if [[ -f "$PROJECT_ROOT/.arpi.config.json" ]]; then
        local env_vars
        env_vars=$(jq -r '.env[]? // empty' "$PROJECT_ROOT/.arpi.config.json" 2>/dev/null)
        for var in $env_vars; do
            if [[ -n "${!var:-}" ]]; then
                env_args+=" -e ${var}"
            fi
        done
    fi

    CONTAINER_ID=$(docker run -d \
        --name "arpi-$$" \
        -v "$PROJECT_ROOT":"$PROJECT_ROOT" \
        -w "$PROJECT_ROOT" \
        -v "$HOME/.claude":"$HOME/.claude":ro \
        -e "GIT_AUTHOR_NAME=$git_name" \
        -e "GIT_AUTHOR_EMAIL=$git_email" \
        -e "GIT_COMMITTER_NAME=$git_name" \
        -e "GIT_COMMITTER_EMAIL=$git_email" \
        $env_args \
        $network_args \
        "$image" \
        sleep infinity)
}

stop_sandbox() {
    [[ -n "$CONTAINER_ID" ]] && docker rm -f "$CONTAINER_ID" &>/dev/null || true
}

trap stop_sandbox EXIT
```

### run_claude() replacement

The only change to the core workflow logic. Replace the current direct `claude` call with `docker exec`:

```bash
run_claude() {
    local prompt="$1"
    local output
    log_step "Running Claude..."
    [[ -z "$CONTAINER_ID" ]] && start_sandbox
    if output=$(docker exec "$CONTAINER_ID" \
        claude --model "$MODEL" --dangerously-skip-permissions --print "$prompt" 2>&1); then
        echo "$output"
        return 0
    else
        log_err "Claude exited with error"
        echo "$output"
        return 1
    fi
}
```

The gate_check function gets the same treatment — its inline `claude` call becomes a `docker exec`.

### Separation of concerns: arpi owns the flow, ARPI.md owns the instructions

The current `arpi` script embeds long, detailed prompts inline in bash. This is fragile, hard to iterate on, and not customizable per project.

The new approach separates two concerns:

**arpi (the script)** is opinionated about flow only:
- What steps run in what order (research → review → gate → plan → review → gate → implement → review → gate)
- Iteration loops and max iteration limits
- Gate check logic (PROCEED vs ITERATE)
- Container lifecycle, file existence checks, logging

**ARPI.md (per-repo file)** defines what the agent does at each step:
- Prompts for each phase (what to research, how to review, what to check at the gate)
- Templates for output files (research.md, plan.md, devlog, etc.)
- Review criteria, conventions, expectations

This is a per-repository file. Teams customize it to match their conventions — different template formats, different review criteria, different output expectations. `arpi init` scaffolds a default version; the team owns it from there.

The script sends minimal context to Claude:

```
Phase: Research — AI:Work
Plan directory: plans/a7z-add-dark-mode/
Iteration: 1/3

Read ARPI.md for your instructions.
```

This means:
- Prompt improvements don't require updating arpi
- Each repo controls its own agent behavior
- The script stays small and focused on orchestration
- When ARPI.md is absent, arpi still runs the flow but Claude has no step-level instructions (graceful degradation)

### Base Docker image

A minimal Dockerfile bundled inline in the arpi script (or shipped alongside it). Built on first run if the image doesn't exist.

```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
```

`node:22-slim` is the smallest base that gives us npm for installing claude. The image includes only claude CLI, git, and standard Unix tools. No language runtimes beyond Node (which is there for claude, not for the user's project).

arpi checks for the image on startup and builds it if missing:

```bash
ensure_base_image() {
    if ! docker image inspect arpi-sandbox &>/dev/null; then
        log_step "Building sandbox image (first run)..."
        docker build -t arpi-sandbox - <<'DOCKERFILE'
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
DOCKERFILE
    fi
}
```

### Auth (decision-004)

`~/.claude/` is bind-mounted read-only into the container. This supports subscription users (OAuth tokens stored there) and API key users (Claude CLI checks env vars first, then stored credentials). No `ANTHROPIC_API_KEY` required.

### Env vars (decision-003)

Hardcoded: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — derived from host's `git config`.

Configurable: additional var names listed in `.arpi.config.json` `"env"` array, read from host environment at runtime.

### `arpi init` (decision-002)

New command. Interactive. Creates:

1. **`ARPI.md`** — Prompts whether to install the default workflow guide (even if one exists, asks whether to replace). Sources content from https://gist.github.com/rjcorwin/296885590dc8a4ebc64e70879dc04a0f. This file provides templates that the RPI phase prompts reference for output structure.

2. **`.arpi.config.json`** — Project-level config. Starts with a sensible default:
   ```json
   {
     "network": {
       "mode": "default"
     },
     "env": []
   }
   ```
   Developer can edit to add `"mode": "restricted"` with `"allowedHosts"`, extra env var names, etc.

3. **`.arpi.Dockerfile`** — Custom sandbox Dockerfile extending the base image. Created with a commented template:
   ```dockerfile
   FROM arpi-sandbox
   # Add project-specific dependencies below.
   # Examples:
   #   RUN apt-get update && apt-get install -y python3 python3-pip
   #   RUN npm install -g typescript
   ```

### Network restriction (opt-in via config)

When `.arpi.config.json` has `network.mode: "restricted"`:

```bash
ensure_restricted_network() {
    if ! docker network inspect arpi-restricted &>/dev/null; then
        docker network create arpi-restricted
        # Note: actual egress filtering requires iptables rules
        # in the container entrypoint or a sidecar proxy.
        # For v1, the network creation is the foundation;
        # egress rules are a follow-up hardening step.
    fi
}
```

Full iptables-based egress filtering (resolving `allowedHosts` to IPs, setting rules in an entrypoint script) is a follow-up. The v1 restricted network creates the Docker network isolation boundary; actual host-level filtering is deferred.

### PROJECT_ROOT detection

The current script derives `PROJECT_ROOT` from its own location (`$SCRIPT_DIR/..`). This needs to change — arpi should work from any project directory. `PROJECT_ROOT` becomes the current working directory (or the git repo root if inside a git repo):

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
```

### Install

`curl | sh` installer that:
1. Downloads the `arpi` script to `~/.local/bin/arpi` (or `/usr/local/bin/arpi`)
2. Makes it executable
3. Checks Docker is available, prints guidance if not
4. Does NOT build the Docker image (that happens on first run)

## Implementation Approach

The changes are almost entirely in the `arpi` script itself. No new files except the Dockerfile (which can be inline).

### Step 1: Sandbox plumbing

Modify `arpi` to add:
- `ensure_base_image()` — build the sandbox image if it doesn't exist
- `start_sandbox()` — start the long-running container
- `stop_sandbox()` — tear down on exit (EXIT trap)
- `PROJECT_ROOT` detection via git or pwd

### Step 2: Containerize claude calls and simplify prompts

Replace `run_claude()` body with `docker exec`. Replace the inline `claude` call in `gate_check()` the same way. At the same time, strip out all the verbose inline prompts from cmd_research, cmd_plan, cmd_implement, and gate_check. Replace them with minimal context strings (phase, step, iteration, plan dir) that point Claude to ARPI.md for full instructions. The bash script becomes a thin orchestrator.

### Step 3: `arpi init` command

Add `cmd_init()`:
- Prompt for ARPI.md (fetch from gist or embed)
- Write `.arpi.config.json` with defaults
- Write `.arpi.Dockerfile` with commented template
- Add `init` to the command dispatch

### Step 4: Config-aware sandbox startup

Extend `start_sandbox()` to:
- Check for `.arpi.Dockerfile` and build project-specific image if present
- Check for `.arpi.config.json` and apply network/env settings
- Fall back to defaults when no config exists

### Step 5: Install script

Write a `curl | sh` installer that places `arpi` on PATH and checks for Docker.

## Reference: Default ARPI.md

The default ARPI.md (source: https://gist.github.com/rjcorwin/296885590dc8a4ebc64e70879dc04a0f) is what `arpi init` scaffolds. Teams customize it from there. Below is its structure for reference — this is the repo's file, not arpi's.

### Workflow steps

```
1. Research
   - AI:Work     → Write research.md
   - AI:Review   → Write research-review-NNN.md
   - AI:Gate     → Proceed or revise?
   - Human:Review

2. Plan
   - AI:Work     → Write plan.md (+ decision docs)
   - AI:Review   → Write plan-review-NNN.md
   - AI:Gate     → Proceed or revise?
   - Human:Review

3. Implement
   - AI:Work     → Implement plan, write devlog-NNN.md
   - AI:Review   → Write code-review-NNN.md
   - AI:Gate     → Proceed (write pr.md) or revise (write plan-NNN.md)?
   - Human:Review
```

### Prompts from ARPI.md

**1:AI:Work (Research)**
```
Read ARPI.md for context. You are starting research for [feature/task].
Requirements: [paste requirements or link to issue]
Write research.md covering requirements, system architecture, constraints, prior art, and open questions.
```

**1:AI:Review**
```
Read ARPI.md for context. Review research.md and write research-review-NNN.md following the template.
```

**1:AI:Gate**
```
Read ARPI.md for context. Read research.md and research-review-NNN.md. Are there any High gaps or unresolved questions? If yes, summarize what needs revision. If no, confirm ready for human review.
```

**2:AI:Work (Plan)**
```
Read ARPI.md for context. Read research.md for decisions and context.
Write plan.md detailing the implementation approach.
```

**2:AI:Review**
```
Read ARPI.md for context. Review plan.md against research.md and write plan-review-NNN.md following the template.
```

**2:AI:Gate**
```
Read ARPI.md for context. Read plan.md and plan-review-NNN.md. Are there any High concerns? If yes, summarize what needs revision. If no, confirm ready for human review.
```

**3:AI:Work (Implement)**
```
Read ARPI.md for context. Read plan.md (or plan-NNN.md if revising).
Implement the plan. When done, write devlog-NNN.md covering what was done, tricky parts, and any decisions made.
```

**3:AI:Review**
```
Read ARPI.md for context. Review the implementation against plan.md and write code-review-NNN.md following the template.
```

**3:AI:Gate**
```
Read ARPI.md for context. Read devlog-NNN.md and code-review-NNN.md. Are there any High issues? If yes, write plan-NNN.md with fixes needed. If no, write pr.md and confirm ready for human review.
```

### Templates defined in ARPI.md

ARPI.md includes full markdown templates for: research.md, plan.md, decision-XXX-name.md, research-review-NNN.md, plan-review-NNN.md, devlog-NNN.md, code-review-NNN.md, and pr.md. Claude reads these from the file at runtime.

## Alternatives Considered

See decision docs:
- **decision-001**: Disposable containers, everything-in-container, bubblewrap, Docker Desktop sandbox — all rejected in favor of long-running container with host-side orchestration.
- **decision-002**: Full provisioning, minimal+network, layered commands — all rejected in favor of zero-setup default with opt-in config files.
- **decision-003**: Hardcoded-only, explicit-only, pass-everything — rejected in favor of hardcoded defaults + configurable extras.
- **decision-004**: Surgical auth mount, require API key, auto-detect — rejected in favor of mounting `~/.claude/` read-only.
