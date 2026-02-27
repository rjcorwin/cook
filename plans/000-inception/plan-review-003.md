# Plan Review: arpi — Sandboxed RPI Workflow (Review 003)

**Reviewer:** AI
**Date:** 2026-02-27
**Reviewing:** plan.md (post-revision, incorporating fixes from review-001 and review-002)

## Summary

The plan has been revised to address both High issues from review-002. The base Docker image now includes `iptables`, and `jq` is declared as a conditional host prerequisite with a friendly error message. The `check_prerequisites()` function is well-implemented — it only requires `jq` when `.arpi.config.json` is present, consistent with the zero-setup-by-default principle. No High issues remain. Five Medium concerns from prior reviews are still unaddressed but are implementable without architectural changes.

## Strengths

All strengths from reviews 001 and 002 hold. Additionally:

- **Prerequisites check is well-designed.** `check_prerequisites()` (plan.md lines 40-54) correctly makes `jq` conditional on the presence of `.arpi.config.json` rather than requiring it always. This preserves zero-setup for new users while catching the dependency before it causes a cryptic failure.
- **Base image is now correct for all modes.** The Dockerfile includes `iptables` unconditionally (line 228), avoiding the need for separate images for restricted vs default network modes.
- **Both previous High issues cleanly resolved.** The fixes are minimal and targeted — no over-engineering.

## Concerns

### High

None.

### Medium

These are carried forward from reviews 001/002, still unaddressed in the plan text. All are implementable during implementation without architectural changes, but noting them for completeness:

- **Naming inconsistency with decision-005.** Decision-005 proposes renaming to `cook` (status: Proposed) but plan.md uses `arpi` throughout — script name, container names (`arpi-$$`), image names (`arpi-sandbox`), config files (`.arpi.config.json`), per-repo file (`ARPI.md`). This should be resolved before implementation: either accept decision-005 and do a mechanical rename pass, or explicitly defer it and note that implementation uses `arpi` as a placeholder.

- **Orphaned container cleanup on abnormal exit.** `trap stop_sandbox EXIT` doesn't cover `kill -9`, OOM, or power loss. Containers named `arpi-$$` persist. A startup check (`docker ps -a --filter "name=arpi-" -q | xargs -r docker rm -f`) would clean stale containers from previous runs.

- **Gist dependency for default ARPI.md.** `arpi init` fetches from a GitHub gist URL (line 262). If the gist moves or GitHub is unreachable, init partially fails. Bundling the content inline (like the Dockerfile) with the gist as an optional update source would be more robust.

- **Entrypoint temp file race condition.** `.arpi-entrypoint.sh` is written to `$PROJECT_ROOT` (line 123-124), then deleted after `docker run -d` returns (line 152). Since `docker run -d` returns before the entrypoint fully executes, and the file is accessed via the bind mount, there's a race between the host deleting the file and the container reading it. For small scripts the kernel likely has it buffered, but it's fragile. Writing to `/tmp/arpi-entrypoint-$$.sh` avoids polluting the project dir and sidesteps the race (the bind mount doesn't include `/tmp`). Alternatively, injecting the script via `docker exec` after starting with a plain `sleep infinity` entrypoint avoids the issue entirely.

- **`--dangerously-skip-permissions` not called out as a deliberate design choice.** This flag appears in `run_claude()` (line 173) without explanation. Since the entire value proposition is "this flag is safe because it runs inside a sandbox," the plan should have an explicit section or callout explaining: the flag is always used inside the container, never outside it, and the combination of filesystem isolation + optional network restriction is what makes it acceptable. This helps future contributors and users understand the security model.

### Low

- **Env var values with spaces.** The `env_args` string is built via concatenation (line 109: `env_args+=" --env ${var}=${!var}"`) and used unquoted (line 140). If a forwarded env var's value contains spaces, word splitting breaks the `docker run` command. Unlikely for typical tokens/keys, but using bash arrays instead of string concatenation would be more robust.

- **Install script underspecified.** Still four bullet points (lines 417-420) with no code. For a `curl | sh` tool, more detail would help: download URL, PATH handling, idempotency, failure modes.

- **`arpi init` interaction flow underspecified.** The plan says "interactive" and "prompts" but doesn't detail the prompts, order, or behavior when the user declines each option.

## Suggestions

- Resolve decision-005 naming before implementation. A mechanical find-replace afterward is more error-prone than getting the name right upfront.
- Consider a brief "Security Model" section in the plan that explicitly states: filesystem isolation (only `$PROJECT_ROOT` mounted rw), auth isolation (`~/.claude/` mounted ro), `--dangerously-skip-permissions` contained by the sandbox, and optional network restriction. This makes the security story legible in one place.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see concerns above)

The two High issues from review-002 have been resolved. The remaining Medium concerns are implementation details — none require architectural changes to the plan. The plan is ready for human review, with the naming question (decision-005) being the most important item to resolve before implementation begins.
