# Plan Review: arpi — Sandboxed RPI Workflow

**Reviewer:** AI
**Date:** 2026-02-27
**Reviewing:** plan.md (revised)

## Summary

The plan is well-structured and makes sound architectural decisions. The separation of concerns (arpi = orchestration, ARPI.md = agent instructions) is a strong design choice that makes the project more maintainable and customizable. The implementation approach is incremental and builds on all four accepted decisions coherently. The initial High concerns (fake network restriction and env var injection) have been addressed in the revised plan — network restriction now uses iptables-based egress filtering, and env var names are validated against a strict pattern. Remaining concerns are Medium and Low.

## Strengths

- **Clear separation of concerns.** Splitting flow orchestration (arpi script) from agent instructions (ARPI.md) is the plan's best design choice. It keeps the script small, makes prompts iterable without script changes, and gives teams ownership of their workflow.
- **Concrete code.** The plan provides real bash for every major component — `start_sandbox()`, `stop_sandbox()`, `run_claude()`, `ensure_base_image()`, `generate_entrypoint()`. This makes the implementation unambiguous and reviewable.
- **Content-addressed image caching.** Using a sha256 hash of `.arpi.Dockerfile` as the image tag is a smart cache-invalidation strategy. Avoids rebuilding when the Dockerfile hasn't changed.
- **Decision traceability.** Each section references its corresponding decision doc. Easy to trace why choices were made.
- **Zero-setup default is genuinely zero-setup.** No init, no config, no image prebuild. First `arpi yolo` triggers the image build and runs. This is critical for adoption.
- **Auth approach is pragmatic.** Mounting `~/.claude/` read-only covers subscription and API key users with one Docker flag.
- **Real network restriction.** The revised plan implements actual iptables egress filtering with `api.anthropic.com` always allowed and user-configurable `allowedHosts`. The `--cap-add=NET_ADMIN` tradeoff is well-documented and scoped to the container's namespace.
- **Env var validation.** Var names are now validated against `^[A-Z_][A-Z0-9_]*$` and forwarded with explicit `--env key=value` format.

## Concerns

### High

None — the two original High concerns (misleading network restriction and env var injection) have been addressed in the revised plan.

### Medium

- **Container cleanup on abnormal exit.** The plan uses `trap stop_sandbox EXIT` which handles normal exit and SIGTERM, but not SIGKILL. If the script is killed hard (kill -9, OOM, power loss), the container persists as `arpi-$$`. Over time, orphaned containers could accumulate. **Recommendation:** Add a startup check that cleans up any existing `arpi-*` containers from previous runs.
- **Gist dependency for ARPI.md.** `arpi init` fetches the default ARPI.md from a GitHub gist URL. If the gist is moved, deleted, or GitHub is unreachable, `arpi init` partially fails. **Recommendation:** Bundle the default ARPI.md content inline in the arpi script (like the Dockerfile) and use the gist as an optional update source.
- **The plan doesn't specify `--dangerously-skip-permissions` behavior.** The `run_claude()` code passes `--dangerously-skip-permissions` to claude inside the container. This is the core value proposition (safe because sandboxed), but it's not called out as a deliberate design choice. It should be explicit that this flag is always used inside the container and never used outside it, and why that's safe.
- **Entrypoint file lives briefly in project dir.** The generated `.arpi-entrypoint.sh` is written to `$PROJECT_ROOT` then cleaned up after container start. If the script crashes between write and cleanup, the file persists. Minor, but consider writing to `/tmp` instead to keep the project dir clean.

### Low

- **No Docker-not-installed check in the main script.** The install script checks for Docker, but the main `arpi` script doesn't. A user who installs arpi and then uninstalls Docker (or uses it on a different machine) gets a raw Docker error. A quick `command -v docker` check with a friendly error message would help.
- **`arpi init` interaction flow is underspecified.** The plan says init is "interactive" and "prompts for ARPI.md" but doesn't detail the prompts, order, or what happens if the user says no to everything. Implementation will have to invent this UX.
- **Install script is thin.** Four bullet points with no code. For a tool whose pitch is `curl | sh`, the installer deserves more specification — where it downloads from, how it handles PATH, what it does on failure, whether it's idempotent.
- **DNS resolution timing.** The entrypoint resolves domains to IPs at container startup. If Anthropic rotates IPs during a long run, Claude calls will fail. Documented as a known limitation, which is fine — just noting it for awareness.

## Suggestions

- Consider adding an `arpi doctor` or `arpi status` command that checks Docker availability, image existence, and container state. Useful for debugging when things go wrong.
- The plan could mention versioning strategy for the arpi script itself — how do users update? `arpi update` is mentioned for the Docker image in research.md but not in the plan.
- The Dockerfile installs claude via `npm install -g @anthropic-ai/claude-code` which pins to the latest version at build time. Consider documenting how to rebuild (`docker rmi arpi-sandbox && arpi yolo ...` triggers a rebuild) or adding an explicit `arpi rebuild` command.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns above)

The two original High concerns have been resolved. The remaining Medium concerns (orphaned container cleanup, gist dependency, entrypoint temp file location) are implementation details that can be addressed during implementation without changing the plan's architecture. The plan is ready for human review.
