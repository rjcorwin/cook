# Plan Review: arpi — Sandboxed RPI Workflow (Review 002)

**Reviewer:** AI
**Date:** 2026-02-27
**Reviewing:** plan.md (post-revision, with all five decision docs)

## Summary

The plan is architecturally sound and the two original High concerns from review-001 (fake network restriction and env var injection) were resolved. This second review focuses on correctness gaps that would cause runtime failures, an unresolved naming inconsistency with decision-005, and several Medium concerns carried forward from review-001 that remain unaddressed. Two new High issues were found: the base Docker image lacks `iptables` (breaking network restriction), and the host script depends on `jq` without declaring it.

## Strengths

All strengths from review-001 hold. Additionally:

- **Decision coverage is comprehensive.** Five decision docs cover architecture, setup, env vars, auth, and naming — each with clear options, tradeoffs, and rationale.
- **The ARPI.md separation of concerns is the plan's strongest design.** Moving prompts and templates out of the bash script and into a per-repo file makes the tool composable and team-customizable without touching the orchestrator.
- **Content-addressed image caching** (sha256 of `.arpi.Dockerfile` as tag) avoids unnecessary rebuilds while ensuring changes are picked up.

## Concerns

### High

- **Base image missing `iptables`.** The base Dockerfile installs only `git`:
  ```dockerfile
  FROM node:22-slim
  RUN npm install -g @anthropic-ai/claude-code
  RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
  ```
  When `network.mode: "restricted"` is active, the entrypoint script calls `iptables` — which is not present in `node:22-slim`. The container will crash on startup with `iptables: command not found`. **Fix:** Add `iptables` to the `apt-get install` line in the base image. It's small (~1MB) and harmless when unused.

- **Host dependency on `jq` not declared.** `start_sandbox()` parses `.arpi.config.json` with `jq` in multiple places (`jq -r '.network.mode // empty'`, `jq -r '.env[]? // empty'`, etc.). `jq` is not installed by default on macOS or many Linux distributions. A user with a config file but no `jq` gets a cryptic error. **Fix:** Either declare `jq` as a host prerequisite (check in the script, friendly error if missing), or parse the simple JSON with shell tools / a bundled parser. Given the config schema is small and flat, `jq` is the right tool — just needs to be declared and checked.

### Medium

- **Naming inconsistency with decision-005.** Decision-005 proposes renaming to `cook` (with status "Proposed"), but plan.md uses `arpi` throughout — script name, container names (`arpi-$$`), image names (`arpi-sandbox`), config files (`.arpi.config.json`), and the per-repo file (`ARPI.md`). If the rename is accepted, the plan needs a pass to update all references. If it's deferred, that should be stated. Currently the plan and the decision contradict each other, which will create confusion during implementation. **Recommendation:** Either accept the decision and update the plan, or explicitly note in the plan that naming is pending and implementation should use a variable/constant for the tool name.

- **Orphaned container cleanup** (carried from review-001, unaddressed). `trap stop_sandbox EXIT` handles normal exit and signals, but not `kill -9`, OOM, or power loss. Containers named `arpi-$$` (or `cook-$$`) will accumulate. **Recommendation:** Add a startup check: `docker ps -a --filter "name=arpi-" -q | xargs -r docker rm -f` to clean up stale containers from previous runs.

- **Gist dependency for default ARPI.md** (carried from review-001, unaddressed). `arpi init` fetches content from a GitHub gist URL. If the gist moves, is deleted, or GitHub is unreachable, init partially fails. **Recommendation:** Bundle the default content inline in the script (like the Dockerfile) and use the gist as an optional update source.

- **Entrypoint file written to project directory.** The generated `.arpi-entrypoint.sh` is created at `$PROJECT_ROOT/.arpi-entrypoint.sh`, then cleaned up after `docker run -d` returns. Two issues: (1) If the script crashes between write and cleanup, the file persists in the project dir. (2) `docker run -d` returns before the container's entrypoint has fully executed — deleting the file via the bind mount while the shell inside the container may still be reading it is a race condition. For a small script the kernel likely has it fully loaded, but it's fragile. **Recommendation:** Write to `/tmp/arpi-entrypoint-$$.sh` instead, or inject the script via `docker exec` after starting the container with a plain `sleep infinity` entrypoint.

- **`--dangerously-skip-permissions` not called out as deliberate** (carried from review-001). The `run_claude()` code passes this flag inside the container, which is the tool's core value proposition (safe because sandboxed). This design choice deserves an explicit callout — that the flag is always used inside the container and never outside it, and why that's acceptable. This helps future contributors and users understand the security model.

### Low

- **Entrypoint ignores Docker CMD convention.** The generated entrypoint script ends with `exec sleep infinity`, hardcoding the long-running command. Docker convention is `exec "$@"` (run whatever CMD was passed). The `sleep infinity` on the `docker run` command line is then redundant when restricted mode is active, and ignored. Not a bug — but deviating from convention could confuse contributors reading the code. Consider using `exec "$@"` in the entrypoint and relying on the `docker run` command's `sleep infinity` uniformly.

- **Install script underspecified** (carried from review-001). Four bullet points with no code. For a `curl | sh` tool, the installer deserves more detail: download URL, PATH handling, idempotency, failure modes, and now `jq`/Docker prerequisite checks.

- **`arpi init` interaction flow underspecified** (carried from review-001). The plan says it's "interactive" and "prompts" but doesn't detail the prompts, their order, or behavior when the user declines. Implementation will have to invent this UX.

- **DNS resolution timing.** Documented limitation but worth reiterating: if Anthropic rotates IPs during a long run, Claude API calls fail silently. For typical bounded runs this is acceptable.

## Suggestions

- Add `iptables` to the base image Dockerfile unconditionally. It's small, harmless when unused, and avoids a conditional image build based on whether network restriction is configured.
- Consider an `arpi doctor` command that verifies Docker, `jq`, image existence, and stale containers.
- The `ensure_base_image()` function should also check image freshness — a user who built the image months ago has a stale claude CLI. A `--rebuild` flag or timestamp check would help.
- If decision-005 is accepted, do a mechanical find-and-replace pass on the plan before implementation starts. The rename touches: script name, container prefix, image name, config file names, per-repo file name, Docker labels, and docs.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see High concerns above)

The two High issues (`iptables` missing from base image, `jq` undeclared as host dependency) are straightforward to fix — one is adding a package to a Dockerfile line, the other is adding a prerequisite check. Once addressed, the naming question (Medium) should be resolved or explicitly deferred before implementation starts. The remaining Medium items from review-001 (orphaned containers, gist dependency, entrypoint location) can be addressed during implementation without architectural changes.
