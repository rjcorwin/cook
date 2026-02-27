# Decision: Sandbox Environment Setup

**Status:** Accepted
**Date:** 2026-02-22
**Deciders:** rjcorwin

## Context

With Option 2 (long-running container) decided, we need to determine what the sandbox environment includes and how much setup arpi performs before Claude starts working. The sandbox needs Docker image(s) and network configuration. The key tension: a fully-provisioned environment (language runtimes, package managers, network-restricted Docker network) gives Claude more capability but adds install complexity and maintenance burden. A minimal environment is easier to ship but limits what Claude can do.

An important observation: Claude can accomplish a lot with just a text editor and git. Research, planning, code generation, code review, and even many implementation tasks don't require running the code at all. The RPI workflow is primarily about reading code, writing files, and reasoning — not executing builds or tests.

## Options

### Option 1: Full provisioning

arpi's install/first-run sets up everything: builds a Docker image with claude CLI, git, common language runtimes (Node, Python), and creates a network-restricted Docker network with iptables egress rules (Anthropic API only).

**Pros:**
- Claude can install deps, run tests, execute code inside the container
- Network restriction prevents data exfiltration from day one
- "It just works" for the common case

**Cons:**
- Large Docker image (multiple runtimes)
- Longer first-run setup
- Image maintenance burden — runtimes go stale, need rebuilds
- Many projects won't need all (or any) of the bundled runtimes
- Network setup (custom Docker network + iptables rules in entrypoint) adds fragility across platforms
- Higher barrier to first use — developer hits Docker builds before seeing any value

### Option 2: Minimal image, no network restriction

Ship a thin image: claude CLI + git + basic Unix tools. No language runtimes. No custom Docker network — use default Docker networking. The container's filesystem isolation (only project dir mounted) is the primary sandbox boundary.

**Pros:**
- Tiny image, fast to build, fast to start
- Works immediately — almost nothing to set up
- Claude can still do the entire RPI workflow: read code, write research/plan/implementation files, run git commands
- Developers see value on first run without a provisioning step
- No image maintenance burden for runtimes
- Avoids the "which runtimes to include" question entirely

**Cons:**
- Claude can't run tests, install deps, or execute project code
- No network egress restriction — Claude could theoretically make outbound HTTP calls (though it has no browser/curl and limited motivation to do so)
- Some implementation tasks (e.g., "fix this test") would be degraded

### Option 3: Minimal image, add network restriction

Same thin image as Option 2, but create a restricted Docker network on first run that limits egress to Anthropic API endpoints.

**Pros:**
- Small image, relatively quick setup
- Network restriction closes the exfiltration vector
- Claude can still do the full RPI workflow

**Cons:**
- Docker network + iptables/nftables rules vary across platforms (Docker Desktop on Mac vs Docker Engine on Linux)
- DNS resolution for api.anthropic.com needs to be allowed, and IPs can change
- Adds a failure mode on first run ("network creation failed") before the developer sees any value
- Marginal security benefit given filesystem isolation already limits what's accessible

### Option 4: Layered approach — start minimal, grow on demand

Start with Option 2 (minimal, no network restriction). Provide optional commands to add capabilities:
- `arpi sandbox add-runtime node` — rebuilds image with Node
- `arpi sandbox restrict-network` — creates the restricted Docker network
- `arpi sandbox add-runtime python` — etc.

**Pros:**
- Fastest time-to-value: first run is near-instant
- Developers opt into complexity only when they need it
- Each layer is independently testable and debuggable
- "Make the simple thing easy and the complex thing possible"
- Image stays small unless the developer explicitly grows it

**Cons:**
- More commands to document and maintain
- Developer needs to know what they need (though arpi could suggest based on project type)
- Customized images per developer make support harder
- Risk of scope creep in the layering system

## Decision

**Zero-setup default with opt-in project-level configuration via `arpi init`.**

This is closest to Option 4 but with a specific mechanism: project-local config files rather than arpi subcommands.

### Default behavior (no setup)

Running `arpi yolo "Add dark mode"` in any project directory works immediately. arpi uses a built-in minimal Docker image (claude CLI + git + basic Unix tools), default Docker networking, and no custom Dockerfile. No `arpi init`, no config files, no image builds required.

This works because the RPI workflow doesn't require executing project code. Claude reads the codebase, reasons about it, and writes files. That's the 80% case and it needs nothing beyond a text editor and git.

### `arpi init` (opt-in)

Running `arpi init` in a project root is interactive. It creates config files and optionally scaffolds workflow files:

**`ARPI.md`** (optional, prompted) — Default workflow guide with templates for research.md, plan.md, decision docs, devlogs, and pr.md. The RPI phase prompts reference this file for output structure. Without it arpi still works (prompts degrade gracefully), but with it output is consistent. Sourced from https://gist.github.com/rjcorwin/296885590dc8a4ebc64e70879dc04a0f. If one already exists, prompts whether to replace it.

It also creates two config files:

**`.arpi.config.json`** — Project-level arpi configuration.
```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": [
      "api.anthropic.com",
      "registry.npmjs.org"
    ]
  }
}
```

When `network.mode` is `"restricted"`, arpi creates a Docker network with egress limited to the listed hosts. When `.arpi.config.json` doesn't exist or `network` is absent, arpi uses default Docker networking (unrestricted).

Other config could live here too (default model, iteration counts, etc.) but network is the primary use case.

**`.arpi.Dockerfile`** — Custom Dockerfile for the sandbox image.
```dockerfile
FROM arpi-base

RUN apt-get update && apt-get install -y nodejs npm
RUN npm install -g typescript
```

When this file exists, arpi builds a project-specific image from it on first run (and caches it). When it doesn't exist, arpi uses the built-in minimal image. This lets developers add language runtimes, tools, or dependencies their project needs for Claude to run tests, install packages, etc.

### Why this approach

- **Zero friction by default.** The biggest adoption threat is first-run failure. A developer who types `arpi yolo "..."` and hits a Docker build error before seeing any output will go back to `--dangerously-skip-permissions`. The default path has no setup steps that can fail (beyond Docker itself being installed).
- **Project-local, version-controllable.** `.arpi.config.json` and `.arpi.Dockerfile` live in the project root. Teams can commit them so everyone gets the same sandbox configuration. This is better than per-user arpi commands that customize a global image.
- **Familiar patterns.** A project-level Dockerfile and JSON config are patterns developers already know. No new abstractions to learn.
- **Network restriction is opt-in, not default.** The container already has filesystem isolation (only project dir mounted) and no access to secrets. Network restriction adds defense-in-depth but isn't critical for v1. Developers who want it can add it via config.
- **Avoids the "which runtimes" question.** arpi doesn't guess what your project needs. You tell it via a Dockerfile, or you don't, and it works either way.

## Consequences

### Positive
- Developers see value on first run with zero configuration
- Teams can standardize sandbox setup by committing `.arpi.config.json` and `.arpi.Dockerfile`
- Network restriction available for security-conscious users without burdening everyone
- Custom Dockerfile means any runtime/tool can be added — arpi doesn't need to anticipate project types
- Clear upgrade path: start with defaults, add config when you need more

### Negative
- Default (no network restriction) means Claude could theoretically make outbound calls, though it has no secrets to exfiltrate and limited tools to do so
- Developers who need runtimes must write a Dockerfile — small but real friction
- Two config files to explain (though both are optional and familiar formats)

### Neutral
- `.arpi.config.json` and `.arpi.Dockerfile` should be added to project `.gitignore` templates or documented as opt-in committable files — teams will vary on whether they want these shared
