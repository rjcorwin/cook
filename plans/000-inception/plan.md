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

## Naming

This plan uses `arpi` as the working name throughout — script, container names (`arpi-$$`), image names (`arpi-sandbox`), config files (`.arpi.config.json`), and the per-repo instructions file (`ARPI.md`). Decision-005 proposes renaming to `cook` (status: Proposed). If the rename is accepted before implementation, it is a mechanical find-replace across the plan and code — no architectural changes needed. The name appears in: the script filename, container name prefix, Docker image name, config file names, the per-repo instructions file, and documentation.

## Non-Goals

- GUI or web interface
- Supporting non-Docker sandbox backends (bubblewrap, Firecracker) in v1
- Pre-built multi-arch images on a registry (local builds only for now)
- Running arpi itself inside the container
- Interactive `claude` sessions (only `claude -p` / `--print`)

## Host Prerequisites

- **Docker** — Docker Engine or Docker Desktop. arpi manages all container lifecycle; the user just needs `docker` on PATH.
- **jq** — used to parse `.arpi.config.json` for network restriction and env var forwarding. Not needed if no config file exists, but arpi checks for it early and prints a friendly error if missing and a config file is present.
- **git** — for `PROJECT_ROOT` detection and deriving git identity.

arpi checks these on startup:

```bash
check_prerequisites() {
    if ! command -v docker &>/dev/null; then
        log_err "Docker is required but not installed. See https://docs.docker.com/get-docker/"
        exit 1
    fi
    if ! command -v git &>/dev/null; then
        log_err "git is required but not installed."
        exit 1
    fi
    if [[ -f "$PROJECT_ROOT/.arpi.config.json" ]] && ! command -v jq &>/dev/null; then
        log_err "jq is required to read .arpi.config.json but not installed."
        log_err "Install: brew install jq (Mac) or apt-get install jq (Linux)"
        exit 1
    fi
}
```

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

cleanup_stale_containers() {
    # Remove leftover containers from previous runs that exited abnormally
    # (kill -9, OOM, power loss — cases where the EXIT trap doesn't fire)
    docker ps -a --filter "name=arpi-" --format '{{.ID}}' | xargs -r docker rm -f &>/dev/null || true
}

start_sandbox() {
    cleanup_stale_containers
    local image="arpi-sandbox"

    # Use project-specific image if .arpi.Dockerfile exists
    if [[ -f "$PROJECT_ROOT/.arpi.Dockerfile" ]]; then
        image="arpi-project-$(basename "$PROJECT_ROOT")"
        local dockerfile_hash
        dockerfile_hash=$(sha256sum "$PROJECT_ROOT/.arpi.Dockerfile" | cut -c1-12)
        image="${image}:${dockerfile_hash}"
        if ! docker image inspect "$image" &>/dev/null; then
            docker build -t "$image" -f "$PROJECT_ROOT/.arpi.Dockerfile" "$PROJECT_ROOT"
        fi
    fi

    # Derive git identity from host
    local git_name git_email
    git_name=$(git config user.name 2>/dev/null || echo "arpi")
    git_email=$(git config user.email 2>/dev/null || echo "arpi@localhost")

    # Collect extra env vars from config (validated names only)
    local env_args=""
    if [[ -f "$PROJECT_ROOT/.arpi.config.json" ]]; then
        while IFS= read -r var; do
            [[ -z "$var" ]] && continue
            if [[ ! "$var" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
                log_err "Invalid env var name in config: $var (skipping)"
                continue
            fi
            if [[ -n "${!var:-}" ]]; then
                env_args+=" --env ${var}=${!var}"
            fi
        done < <(jq -r '.env[]? // empty' "$PROJECT_ROOT/.arpi.config.json" 2>/dev/null)
    fi

    # Network restriction: start container first, then inject iptables via docker exec.
    # This avoids the entrypoint temp file race condition (writing a file to the bind
    # mount and deleting it before the container finishes reading it).
    local cap_args=""
    local restricted=false
    local allowed_hosts=""
    if [[ -f "$PROJECT_ROOT/.arpi.config.json" ]]; then
        local network_mode
        network_mode=$(jq -r '.network.mode // empty' "$PROJECT_ROOT/.arpi.config.json" 2>/dev/null)
        if [[ "$network_mode" == "restricted" ]]; then
            restricted=true
            allowed_hosts=$(jq -r '.network.allowedHosts[]? // empty' "$PROJECT_ROOT/.arpi.config.json" 2>/dev/null | tr '\n' ' ')
            cap_args="--cap-add=NET_ADMIN"
        fi
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
        $cap_args \
        "$image" \
        sleep infinity)

    if [[ -z "$CONTAINER_ID" ]]; then
        log_err "Failed to start sandbox container"
        exit 1
    fi

    # Apply network restriction after container is running (no temp files, no race)
    if [[ "$restricted" == true ]]; then
        local iptables_script
        iptables_script=$(generate_iptables_script "$allowed_hosts")
        docker exec "$CONTAINER_ID" sh -c "$iptables_script"
    fi
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
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
```

`node:22-slim` is the smallest base that gives us npm for installing claude. The image includes only claude CLI, git, iptables (for network restriction), and standard Unix tools. No language runtimes beyond Node (which is there for claude, not for the user's project). iptables is ~1MB and harmless when unused — including it unconditionally avoids needing a separate image for restricted-network projects.

arpi checks for the image on startup and builds it if missing:

```bash
ensure_base_image() {
    if ! docker image inspect arpi-sandbox &>/dev/null; then
        log_step "Building sandbox image (first run)..."
        docker build -t arpi-sandbox - <<'DOCKERFILE'
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
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

1. **`ARPI.md`** — Prompts whether to install the default workflow guide (even if one exists, asks whether to replace). The default content is bundled inline in the arpi script itself (like the Dockerfile), so `arpi init` works offline with no external dependencies. The canonical source is https://gist.github.com/rjcorwin/296885590dc8a4ebc64e70879dc04a0f — updates to the gist can be pulled in by future versions of arpi, but the bundled copy is always the fallback. This file provides templates that the RPI phase prompts reference for output structure.

2. **`.arpi.config.json`** — Project-level config. Starts with a sensible default:
   ```json
   {
     "network": {
       "mode": "default",
       "allowedHosts": []
     },
     "env": []
   }
   ```
   To enable network restriction, change `"mode"` to `"restricted"` and add any hosts beyond `api.anthropic.com` (which is always allowed) to `allowedHosts`:
   ```json
   {
     "network": {
       "mode": "restricted",
       "allowedHosts": [
         "registry.npmjs.org",
         "pypi.org"
       ]
     },
     "env": ["NPM_TOKEN"]
   }
   ```

3. **`.arpi.Dockerfile`** — Custom sandbox Dockerfile extending the base image. Created with a commented template:
   ```dockerfile
   FROM arpi-sandbox
   # Add project-specific dependencies below.
   # Examples:
   #   RUN apt-get update && apt-get install -y python3 python3-pip
   #   RUN npm install -g typescript
   ```

### Network restriction (opt-in via config)

When `.arpi.config.json` has `network.mode: "restricted"`, arpi enforces egress filtering via iptables inside the container. The config specifies which hosts the container can reach:

```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": [
      "registry.npmjs.org"
    ]
  }
}
```

`api.anthropic.com` is always allowed (Claude can't function without it) and does not need to be listed. Additional hosts (package registries, internal APIs, etc.) are added to `allowedHosts`.

When mode is `"default"` or the config is absent, no network restriction is applied.

**How it works:** arpi starts the container with `sleep infinity` (no custom entrypoint), then injects iptables rules via `docker exec` before any Claude calls run. This avoids temp files in the project directory and eliminates the race condition of deleting a bind-mounted entrypoint while the container reads it.

The injection:
1. Resolves each allowed domain to IP addresses via `getent hosts` inside the container
2. Sets iptables rules: default DROP on OUTPUT, then ACCEPT for loopback, established connections, DNS (UDP/TCP 53 to Docker's DNS at 127.0.0.11), and TCP 443 to each resolved IP

The container runs with `--cap-add=NET_ADMIN` when restricted mode is active. This grants iptables access within the container's own network namespace only — it does not grant host network access.

```bash
generate_iptables_script() {
    local allowed_hosts="$1"  # space-separated list
    cat <<'IPTABLES_EOF'
set -e

# Resolve allowed hosts to IPs
ALLOWED_IPS=""
for host in api.anthropic.com ALLOWED_HOSTS_PLACEHOLDER; do
    ips=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' || true)
    ALLOWED_IPS="$ALLOWED_IPS $ips"
done

# Default policy: drop all outbound
iptables -P OUTPUT DROP

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established/related (responses to allowed requests)
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS to Docker's embedded DNS
iptables -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT

# Allow HTTPS to each resolved IP
for ip in $ALLOWED_IPS; do
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
done
IPTABLES_EOF
}
# The function replaces ALLOWED_HOSTS_PLACEHOLDER with the actual hosts before returning.
# (Implementation detail: sed or parameter substitution — kept simple here for readability.)
```

**Limitations (documented, not hidden):**
- Domain-to-IP resolution happens at container startup. If a service's IPs change mid-run, the new IPs won't be allowed. This is acceptable for bounded-duration runs.
- `--cap-add=NET_ADMIN` is required for iptables. This is scoped to the container's network namespace and does not affect the host.
- Only port 443 (HTTPS) is allowed to resolved IPs. If a service uses a non-standard port, it won't be reachable. This is intentional — the allowlist is for HTTPS APIs, not arbitrary services.

### Security Model

arpi's core value proposition is making `--dangerously-skip-permissions` safe by containing it. Here's how:

**`--dangerously-skip-permissions` is always used inside the container, never on the host.** The flag tells Claude CLI to execute tool calls (file writes, shell commands, etc.) without interactive approval. This is necessary because arpi runs non-interactive `claude -p` calls — there's no human at the terminal to approve each action. Without a sandbox, this gives Claude unrestricted access to the host machine. With arpi's sandbox, Claude's unrestricted actions are bounded by the container's isolation:

- **Filesystem:** Claude can only read/write `$PROJECT_ROOT` (bind-mounted rw). No access to home directory, SSH keys, cloud credentials, other repos, or system files. `~/.claude/` is mounted read-only — Claude can authenticate but not modify auth state.
- **Network (default):** Unrestricted. Claude can make outbound requests but has no secrets to exfiltrate beyond what's in the project directory.
- **Network (restricted):** When `.arpi.config.json` enables restricted mode, outbound traffic is limited to `api.anthropic.com` and explicitly allowed hosts. Claude cannot reach arbitrary endpoints.
- **Process:** Claude runs as a regular user inside the container. The container is torn down on script exit. No persistent services, no cron jobs, no daemons survive the run.

This is the tradeoff: `--dangerously-skip-permissions` is dangerous on a host machine, but acceptable inside a container that limits what "unrestricted" actually means. The flag enables the automated workflow; the sandbox constrains its blast radius.

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

The default ARPI.md is bundled inline in the arpi script. The canonical source is https://gist.github.com/rjcorwin/296885590dc8a4ebc64e70879dc04a0f — `arpi init` uses the bundled copy (works offline) and future arpi versions may pull updates from the gist. Teams customize it from there. Below is its structure for reference — this is the repo's file, not arpi's.

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
