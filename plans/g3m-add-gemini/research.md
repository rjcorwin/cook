# Research: Add Gemini CLI Support

**Requester:** rj
**Date:** 2026-03-16

## Requirements

### Original Request

Add support for the Google Gemini CLI (`gemini`) as a fourth agent option alongside the existing `claude`, `codex`, and `opencode` agents.

### Context

Cook currently supports three agent CLIs: Claude Code (`claude`), OpenAI Codex (`codex`), and OpenCode (`opencode`). Each agent has a native runner invocation pattern, a bypass/approval-mode flag, a Docker image installation, API host allowlists for network sandboxing, and auth credential handling. Adding Gemini follows the same pattern across these same integration points.

The Gemini CLI is an open-source tool from Google (`google-gemini/gemini-cli` on GitHub, Apache 2.0) published as `@google/gemini-cli` on npm. The binary registered on PATH is `gemini`.

### Open Questions

- **OQ-1: Prompt delivery mechanism.** For `claude` and `codex`, cook writes the prompt to the process's stdin. For gemini, stdin piped content is treated as *context*, not a *prompt* — the actual question must come via the `-p`/`--prompt` flag or a positional arg. Can cook pass the full (potentially multi-line, multi-KB) cook prompt purely via stdin as a positional arg in non-TTY mode, or must it be passed as a `-p` string arg? Using `-p` as an inline string arg has OS ARG_MAX limits (~256 KB on macOS). The sandbox.ts approach of writing to a temp file and using stdin redirect may be necessary for native mode too.

- **OQ-2: ANSI / color output stripping.** Cook's `LogStream.tsx` and log files receive raw agent output. The gemini CLI has no `--no-color` flag. In non-TTY mode (piped output), does gemini suppress ANSI codes automatically, or do we need to strip them? Need to verify empirically.

- **OQ-3: `--screen-reader` vs `--output-format text`.** The `--screen-reader` flag is documented as producing "plain-text output for accessibility." Does this suppress ANSI codes in practice, and is it safe to use as a proxy for `--no-color`?

- **OQ-4: Output format for cook.** Cook currently consumes agent output as a plain text stream (line by line via `onLine`). Should we use `--output-format text` (default) or `--output-format stream-json` and extract the `message` chunks? Using `stream-json` would give structured data but requires JSONL parsing in the runner. Using `text` is simpler and consistent with how claude/codex are handled, but may include ANSI noise.

- **OQ-5: `--approval-mode=yolo` in bare runner.** The docs say yolo mode can *only* be set via CLI flag, not `settings.json`. This is confirmed as the bypass equivalent of `--dangerously-skip-permissions`. Question: is `--yolo` (the deprecated alias) still functional in the current release, or should we use `--approval-mode=yolo` exclusively?

- **OQ-6: npm package name for Docker image.** The binary is `gemini`, installed via `npm install -g @google/gemini-cli`. This needs confirmation against the published npm package before adding to `BASE_DOCKERFILE`.

- **OQ-7: API hosts for Docker network allowlist.** The `requiredHostsForAgent()` function in `sandbox.ts` allows outbound HTTPS to specific API endpoints. For Gemini we need the correct hostnames. Likely candidates: `generativelanguage.googleapis.com` (Gemini AI Studio / API key path) and various `*.googleapis.com` hosts for Vertex AI. Need to verify the exact set required for `GEMINI_API_KEY`-based auth.

- **OQ-8: Auth credential file in Docker.** Claude requires copying `~/.claude` credentials into the container. Gemini uses `GEMINI_API_KEY` as an environment variable, which is simpler — it can be passed via the `env` passthrough in `.cook/config.json` (e.g., `"env": ["GEMINI_API_KEY"]`). Is any file-based credential copying needed for the non-API-key auth paths (OAuth, Vertex ADC), or do we only need to document the `GEMINI_API_KEY` env var path for initial support?

- **OQ-9: Default model for cook.** `defaultModelForAgent()` in `cli.ts` assigns a default model per agent. What is the right default for gemini? `gemini-2.5-flash` (fast, lower cost) or `gemini-2.5-pro` (more capable)? The `auto` alias resolves to `gemini-2.5-pro` or a preview variant — is it stable enough to use as a cook default?

- **OQ-10: Turn limit exit code.** Gemini exits with code `53` when `model.maxSessionTurns` is hit. Cook's loop currently treats non-zero exit as an error. Should cook handle exit code `53` distinctly (e.g., surface it as a specific error message)?

- **OQ-11: Gemini CLI's own sandbox mode.** The gemini CLI has a built-in `--sandbox` / `-s` flag that activates its own container/seatbelt sandboxing. When cook runs gemini inside cook's Docker sandbox, gemini's own sandboxing should be disabled or left as default (off). Is there any interaction between cook's Docker sandbox and gemini's native sandbox that needs to be accounted for?

- **OQ-12: `--include-directories` flag.** When cook runs in a Docker container, the working directory is the project root. Does gemini auto-detect the workspace, or does it require `--include-directories` to be pointed at the project root explicitly?

---

## System Architecture

### Related Components

| File | Role |
|------|------|
| `src/config.ts` | Defines `AgentName` type and validation. Central type must be updated. |
| `src/cli.ts` | CLI arg parsing, `parseAgent()`, `defaultModelForAgent()`, help text, doctor command. |
| `src/native-runner.ts` | `buildCommand()` constructs the shell command for native invocation. Prompt written to stdin. |
| `src/bare-runner.ts` | `getBypassFlags()` returns agent-specific permission bypass flags. |
| `src/sandbox.ts` | `BASE_DOCKERFILE`, `requiredHostsForAgent()`, `runCommandForAgent()`, auth credential copying. |
| `src/runner.ts` | `AgentRunner` interface — no changes expected. |

### Data Flow

For a native (non-Docker) run:

```
cli.ts (parseAgent) → loop.ts → native-runner.ts
  buildCommand(agent='gemini', model) → { cmd: 'gemini', args: [...] }
  spawn(cmd, args, { cwd })
  child.stdin.write(prompt); child.stdin.end()   ← or -p flag?
  collect stdout lines via onLine callback
  return full output string
```

For a Docker run:

```
cli.ts → loop.ts → sandbox.ts
  BASE_DOCKERFILE: installs @google/gemini-cli
  requiredHostsForAgent('gemini') → iptables allowlist
  prompt written to /tmp/cook-prompt-<ts>.txt in container
  containerExec: `gemini --model "$COOK_MODEL" --approval-mode=yolo -p < /tmp/...`
  env includes COOK_MODEL and any GEMINI_API_KEY passthrough
```

### Constraints

- **ARG_MAX / prompt size:** Cook prompts can be large (template + full prior log). Passing as a `-p` string arg may hit OS limits. The sandbox already uses a temp file + stdin redirect to avoid this; the native runner should adopt the same pattern or use stdin piping (see OQ-1).
- **No `--no-color`:** Must verify non-TTY behavior or use `--screen-reader` (see OQ-2, OQ-3).
- **`--approval-mode=yolo` CLI-flag-only:** Cannot be baked into `settings.json`; must be passed on every invocation for bare/sandbox modes.
- **Rate limits:** Gemini free tier is 60 req/min / 1,000 req/day. Cook loops can exhaust this quickly. Not cook's problem to solve, but worth noting in docs.
- **Node 20+:** Gemini CLI requires Node 20+. Cook already requires Node 20+, so no additional constraint.

---

## Prior Art

### How Existing Agents Are Integrated

**Claude (native):**
```
cmd: 'claude'
args: ['--model', model, '--permission-mode', 'acceptEdits', '-p']
bypass: '--dangerously-skip-permissions'
prompt: via stdin
```

**Codex (native):**
```
cmd: 'codex'
args: ['exec', '--model', model, '--full-auto', '--skip-git-repo-check', '-']
bypass: '--dangerously-bypass-approvals-and-sandbox'
prompt: via stdin (the trailing '-' signals stdin)
```

**OpenCode:** Not supported in native mode; Docker only.

**Gemini (proposed):**
```
cmd: 'gemini'
args: ['-m', model, '--approval-mode=yolo', ???]   ← prompt delivery TBD (OQ-1)
bypass: '--approval-mode=yolo'  (also the normal non-interactive flag)
prompt: TBD — stdin pipe or -p flag
```

Note: For gemini, the bypass flag and the non-interactive "accept all" flag are the same (`--approval-mode=yolo`). Claude has separate concerns: `-p` for non-interactive and `--dangerously-skip-permissions` for bypass. This simplifies gemini's invocation slightly.

### Docker Dockerfile Pattern

Current `BASE_DOCKERFILE` in `sandbox.ts`:
```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
```

Gemini would add `@google/gemini-cli` to the npm install line.

### Auth Patterns

| Agent | Auth mechanism | Cook integration |
|-------|----------------|------------------|
| claude | Credential files at `~/.claude/` | Copied into container; checked in doctor |
| codex | `OPENAI_API_KEY` env var | Passed via `env` config |
| opencode | Various env vars | Passed via `env` config |
| gemini (proposed) | `GEMINI_API_KEY` env var (simplest) or OAuth cache or Vertex AI | `GEMINI_API_KEY` via `env` config; OAuth cache would require file copying |

For v1, targeting `GEMINI_API_KEY`-based auth is the simplest path. OAuth credential file copying can be a follow-up.

### Gemini CLI Flags Reference (relevant subset)

| Flag | Purpose | Used in cook? |
|------|---------|---------------|
| `-p` / `--prompt` | Prompt string, forces headless | Yes (or stdin) |
| `-m` / `--model` | Model selection | Yes |
| `--approval-mode=yolo` | Auto-approve all tool actions | Yes (bypass) |
| `--output-format` | `text` / `json` / `stream-json` | Likely `text` (default) |
| `--screen-reader` | Plain-text output (no rich formatting) | Possibly, for ANSI suppression |
| `--sandbox` / `-s` | Gemini's own sandboxing | No (cook provides sandboxing) |

### Exit Codes

| Code | Meaning | Cook handling needed? |
|------|---------|----------------------|
| `0` | Success | Normal |
| `1` | General error | Normal (treated as failure) |
| `42` | Input error | Maybe surface as user-facing message |
| `53` | Turn limit exceeded | Maybe surface distinctly (see OQ-10) |
