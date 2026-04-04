# Plan: Add Pi Agent Support

**Status:** Complete
**Author:** rjcorwin
**Created:** 2026-04-04

## Summary

Add [Pi](https://pi.dev/) as a supported agent alongside Claude Code, Codex, and OpenCode. Pi runs Docker-only (no OS-level sandbox), requires its own auth file and Docker npm package, and supports multiple LLM providers (Anthropic, OpenAI, Google).

## Motivation

Pi is an emerging coding agent with multi-provider support. Cook already supports Docker-sandboxed agents (OpenCode), so adding Pi follows the same pattern with a new auth path and npm package.

## Goals

- `--agent pi` works end-to-end in Docker sandbox mode
- Pi is rejected in native/agent sandbox mode with a clear error (same policy as OpenCode)
- `cook doctor` validates Pi credentials and sandbox mode correctly
- Auth files (`auth.json`, `models.json`, `settings.json`) copied into Docker container
- Full multi-provider support: Anthropic, OpenAI, Google API hosts allowed
- README, index.html, and SPEC.md updated to document Pi

## Non-Goals

- Native mode support for Pi (no OS-level sandbox — Docker only)
- Pi-specific TUI changes

## Technical Design

Pi follows the OpenCode pattern exactly:

- **`src/config.ts`**: Add `'pi'` to `AgentName` union and `isAgentName` guard
- **`src/cli.ts`**: Add `'pi'` to `parseAgent`, `defaultModelForAgent` (`'sonnet'`), and `checkPiAuth()`. Doctor validates Pi requires Docker sandbox, same logic as OpenCode.
- **`src/native-runner.ts`**: Throw before execution if `agent === 'pi'` (same error pattern as OpenCode)
- **`src/sandbox.ts`**:
  - Dockerfile: install `@mariozachner/pi-coding-agent`
  - `copyAuthFiles`: mkdir + copy `~/.pi/agent/{auth,models,settings}.json`
  - `hasPiContainerCredentials`: check auth.json or provider env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)
  - `requiredHostsForAgent`: allow api.anthropic.com, api.openai.com, generativelanguage.googleapis.com
  - `runCommandForAgent`: `pi --model "$COOK_MODEL" -p < /tmp/prompt`
  - Warn on startup if Pi selected but no credentials found

## Implementation Notes

Implemented via cook's own composition race (7 parallel branches, `v7`). Branch 3 was selected as the base for correct sandbox enforcement. Additional pieces cherry-picked:

- `nativeAuthHint()` for claude/codex auth error UX (from branch 1) — no Pi hint needed since Pi throws before reaching that code
- `index.html` Pi example and Docker note (from branch 7, with "both modes" claim corrected to Docker-only)
- `tests/SPEC.md` Pi test cases (from branch 7, with `--sandbox docker` flag added)

Post-merge fixes applied after code review (see `code-review-001.md`, `devlog-001.md`).
