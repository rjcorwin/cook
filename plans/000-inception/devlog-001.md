# Devlog: Sandboxed RPI Workflow — Initial Implementation

**Date:** 2026-02-28
**Implementing:** plan.md

## What Was Done

- Created `cook` script (renamed from `arpi` per decision-005) implementing the full sandboxed RPI workflow:
  - **Prerequisites check**: `check_prerequisites()` validates Docker, git, and conditional jq dependency
  - **Docker sandbox management**: `cleanup_stale_containers()`, `ensure_base_image()`, `start_sandbox()`, `stop_sandbox()` with EXIT trap
  - **Container-based Claude execution**: `run_claude()` and `gate_check()` use `docker exec` against a long-running container instead of direct host calls
  - **Network restriction**: `generate_iptables_script()` for opt-in egress filtering via iptables inside the container
  - **`cook init` command**: Interactive setup for COOK.md, `.cook.config.json`, and `.cook.Dockerfile`
  - **Simplified prompts**: All phase prompts reduced to minimal context (phase, plan dir, iteration) pointing Claude to COOK.md for detailed instructions
  - **Bundled COOK.md**: Default content embedded via `default_cook_md()` function — works offline, no gist dependency
- Created `install.sh` curl-pipe-sh installer that downloads cook to `~/.local/bin/cook`, checks prerequisites, and prints getting-started guidance

## Tricky Parts

- **Bash array expansion with `set -u`**: Empty arrays (`env_args`, `cap_args`) cause unbound variable errors with `set -u`. Used the `"${arr[@]+"${arr[@]}"}"` pattern which expands to nothing when the array is empty, avoiding the error while preserving correct word splitting for populated arrays.

- **Cross-platform sha256**: Linux has `sha256sum`, macOS has `shasum -a 256`. Added a `sha256_short()` helper that detects which is available.

- **iptables script injection**: The plan's approach of injecting iptables rules via `docker exec` after container start (instead of a bind-mounted entrypoint script) eliminates the race condition where the host deletes the entrypoint file while the container is still reading it. The `generate_iptables_script()` function builds the script as a string with placeholder substitution.

- **Prompt simplification vs. usability without COOK.md**: The plan calls for minimal prompts that just say "Read COOK.md for your instructions." If COOK.md doesn't exist, Claude gets very little guidance. This is by design (graceful degradation) — the plan explicitly accepts this tradeoff in exchange for keeping the script thin and making prompt improvements a per-repo concern rather than a script update.

## Decisions Made

- **Removed `--permissions`/`--skip-permissions` flags**: Since `--dangerously-skip-permissions` is always used inside the container (the entire security model), exposing this as a CLI option no longer makes sense. Unknown flags get a clean error message.

- **`log_err` writes to stderr**: Changed from the original `arpi` which wrote errors to stdout. Error messages should go to stderr so they don't get mixed into captured output.

- **`check_prerequisites` runs before dispatch**: Unlike `ensure_base_image` (which runs lazily on first `run_claude()` call), prerequisites are checked upfront so users get fast feedback about missing dependencies before any work begins.

- **`cmd_init` is fully interactive with read prompts**: The plan said "interactive" without specifying the exact UX. Implemented with `read -rp` prompts: COOK.md asks before creating/replacing, config and Dockerfile are created only if they don't exist.

## Deviations from Plan

- **Plan status update removed**: The original `arpi` had a step in `cmd_plan` that asked Claude to change the plan status from "Draft" to "Approved" after the gate passed. This was removed as part of prompt simplification — the status field is a human concern, not an automated one.

- **Display output includes project root**: Added `Project: ${PROJECT_ROOT}` to the startup banner since cook now runs from any directory (not just the repo it lives in). Users need to see which project cook detected.

## Next Steps

- Code review (per CONTRIBUTING.md step 3:AI:Review)
