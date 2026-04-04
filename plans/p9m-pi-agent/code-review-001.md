# Code Review: Pi Agent Support

**Reviewer:** AI (3 parallel subagents)
**Date:** 2026-04-04
**Reviewing:** src/cli.ts, src/config.ts, src/native-runner.ts, src/sandbox.ts, README.md, index.html, tests/SPEC.md

## Summary

Three parallel reviews were run covering code correctness, security/sandbox enforcement, and consistency/completeness. Two bugs were found and fixed. One item (default model name format) remains unverified and needs manual confirmation against the Pi CLI.

## What Works Well

- **Sandbox enforcement is correct** — Pi is rejected in `native-runner.ts:31-33` before any execution, identical pattern to OpenCode. No bypass path exists.
- **Docker credential handling** — `copyAuthFiles` copies all three Pi config files; `hasPiContainerCredentials` covers auth.json + all three provider env vars; network hosts cover all three providers. These are mutually consistent.
- **`nativeAuthHint()` omits Pi intentionally** — Pi is rejected before the hint code runs, so no Pi case is needed there.
- **Doctor validation** — Pi and OpenCode are handled identically in the doctor command: unsupported in agent/native sandbox mode, flagged with a clear error.
- **Auth file location** — `~/.pi/agent/` was confirmed correct by the reviewer.
- **CLI command format** — `pi --model ... -p < /tmp/file` matches Pi's `-p`/`--print` flag for non-interactive stdin use.
- **npm package** — `@mariozechner/pi-coding-agent` confirmed present and maintained.

## Issues

### Fixed

**`checkPiAuth()` early-return bug** (`src/cli.ts:302-308`) — The loop returned `{ ok: false }` on the first API key found that wasn't in passthrough, without checking remaining keys. Example: if `ANTHROPIC_API_KEY` is set but not passed through, but `OPENAI_API_KEY` is set and passed through, the function incorrectly reported failure. Fixed by tracking the first blocked key and continuing the loop; only returning failure if no key passes through.

**`index.html` missing Pi in title, tagline, and Docker-only note** (`index.html:6, 525, 757`) — The `<title>`, hero tagline, and agents table blockquote all still said "Claude Code, Codex, and OpenCode". The Pi example block was added but these three references were missed. Fixed.

### Fixed (during live testing)

**Default model name** (`src/cli.ts:152`) — `'sonnet'` is not a valid Pi model. Pi's `--provider` defaults to `google`, and Google has no model named "sonnet". Confirmed by running Pi in Docker: it errors immediately. Fixed to `'google/gemini-2.0-flash'`, which is Pi's actual default provider and model.

**`GOOGLE_API_KEY` → `GEMINI_API_KEY`** (`src/cli.ts`, `src/sandbox.ts`) — Pi's provider docs confirm the correct env var for Google Gemini is `GEMINI_API_KEY`, not `GOOGLE_API_KEY`. All four references updated. The `checkPiAuth()` and `hasPiContainerCredentials()` checks and warning messages were all using the wrong variable name.

## Non-Issues Confirmed

- `hasPiContainerCredentials()` only checks `auth.json` (not `models.json`/`settings.json`) — correct, those are config files not auth files. The credential check is auth-only by design.
- No Pi case in `nativeAuthHint()` — intentional, see above.
- Stale project image after `cook rebuild` — expected Docker behavior; users need to remove the project-specific image manually or `cook rebuild` should handle it (separate issue).

## Live Test Result

Pi ran successfully end-to-end: doctor passed, Docker image built, container started, network restricted to three provider hosts, Pi binary found and executed, Google API authenticated. Run was killed early due to free-tier rate limits (15 RPM on AI Studio keys). Recommended auth path: `pi /login` with Gemini CLI subscription (free, higher limits, uses OAuth via `auth.json`).
