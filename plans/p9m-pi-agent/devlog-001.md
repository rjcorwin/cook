# Devlog: Pi Agent Support

**Date:** 2026-04-04
**Implementing:** plan.md, fixes from code-review-001.md

## What Was Done

**Branch assembly** — Cook ran 7 parallel branches (`v7`) for this feature. The pick agent hit a rate limit before resolving, so branches were manually reviewed and assembled:

- Branch 3 merged as base (only branch that correctly rejects Pi in native mode)
- `nativeAuthHint()` for claude/codex cherry-picked from branch 1
- `index.html` Pi example and `tests/SPEC.md` Pi test cases taken from branch 7

**`src/config.ts`** — Added `'pi'` to `AgentName` type and `isAgentName` guard.

**`src/cli.ts`** — Added `'pi'` to `parseAgent`, `defaultModelForAgent` (returns `'sonnet'`), and `checkPiAuth()`. Doctor command flags Pi as unsupported in native/agent sandbox mode, same logic path as OpenCode.

**`src/native-runner.ts`** — Added Pi rejection before execution (`throw new Error('pi is not supported in native mode ...')`). Added `nativeAuthHint()` for claude/codex auth error messages; no Pi case needed since Pi never reaches that code.

**`src/sandbox.ts`** — Dockerfile installs `@mariozechner/pi-coding-agent`. `copyAuthFiles` creates `~/.pi/agent/` in container and copies `auth.json`, `models.json`, `settings.json`. `hasPiContainerCredentials` checks auth.json or provider env vars. `requiredHostsForAgent` adds three provider API hosts. `runCommandForAgent` emits `pi --model "$COOK_MODEL" -p < /tmp/...`. Startup warning if Pi selected without usable credentials.

**`README.md`** — Added Pi to description line and requirements list.

**`skill/SKILL.md`** — Added Pi to agent list in description.

**`index.html`** — Added Pi to title, hero tagline, Docker-only blockquote note, and added a Pi usage example in the per-step agents section.

**`tests/SPEC.md`** — Added Pi agent test cases: single-agent (`--sandbox docker`) and mixed-agent review loop.

## Fixes from Code Review

**`checkPiAuth()` logic bug** — Original loop returned failure on the first API key found that wasn't passed through, skipping any remaining keys that might be valid. Refactored to track `blockedKey` and continue iterating; only reports failure after exhausting all keys with none passing through.

**`index.html` title/tagline/note** — Three references to the agent list were missed in the initial assembly. Fixed title tag, hero tagline paragraph, and agents table Docker-only blockquote note.

## Fixes from Live Testing

**Default model `'google/gemini-2.0-flash'`** — `'sonnet'` was rejected at runtime. Pi defaults to the `google` provider and requires a provider-prefixed model ID. Fixed to `'google/gemini-2.0-flash'`, which is Pi's own default.

**`GEMINI_API_KEY` (not `GOOGLE_API_KEY`)** — Pi's provider docs list `GEMINI_API_KEY` as the env var for Google Gemini. All references in `cli.ts` and `sandbox.ts` updated. Also found during testing: stale project-specific Docker image (`cook-project-*`) after `cook rebuild` — it doesn't inherit the new base automatically in this case; Docker layer cache invalidation requires the project image to be manually removed or cook rebuild to also purge project images.

## Tricky Parts

- **Branch 7's `index.html`** had a false claim: "Pi is supported in both agent and Docker modes." Corrected to Docker-only before inclusion.
- **Free tier rate limits** — Google AI Studio API keys are limited to 15 RPM. Pi handles this gracefully (retries with backoff), but coding tasks hit the limit quickly. Recommended setup is `pi /login` with Gemini CLI OAuth (free, much higher limits).

## Open Items

- `cook rebuild` should also remove stale project-specific images (`cook-project-*`) to avoid the stale image problem.
