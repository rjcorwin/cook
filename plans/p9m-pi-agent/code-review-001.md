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

### Open

**Default model name format** (`src/cli.ts:152`) — `defaultModelForAgent('pi')` returns `'sonnet'`. Pi may require a provider-prefixed format (e.g. `'anthropic/claude-sonnet-4-5'`) rather than a bare shorthand. Two of the seven race branches used a prefixed format. Needs verification by running `pi --model sonnet -p` and observing whether it errors. If Pi requires a prefix, this is a silent runtime failure.

## Non-Issues Confirmed

- `hasPiContainerCredentials()` only checks `auth.json` (not `models.json`/`settings.json`) — correct, those are config files not auth files. The credential check is auth-only by design.
- No Pi case in `nativeAuthHint()` — intentional, see above.
- `GOOGLE_API_KEY` env passthrough requires explicit user configuration — correct security behavior, not a gap.
