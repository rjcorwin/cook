# Research: Rewrite cook in TypeScript with Ink TUI

**Requester:** rjcorwin
**Date:** 2026-03-01

## Requirements

### Original Request
Rewrite cook from Go to TypeScript with:
1. A TUI using [Ink](https://github.com/vadimdemedes/ink) (React for CLI) with a persistent status bar showing loop progress
2. Publish as an npm package
3. Replace Go `text/template` with JavaScript template literals for COOK.md, which is a more familiar templating approach

### Context
The current Go implementation works but has two UX issues:
- No persistent status display — the user must scroll through output or `tail -f` the log to understand where the loop is
- Go's `text/template` syntax (`{{.Step}}`, `{{if .LastMessage}}`) is unfamiliar to most developers; JS template literals (`${step}`, ternary operators) are more widely known

The Go codebase is ~850 lines across 5 files with one external dependency (Docker SDK). The architecture is clean and modular, making a rewrite tractable.

## System Architecture

### Current Go Architecture
```
main.go      — CLI entry, commands (init/rebuild/run), signal handling, defaults
config.go    — .cook.config.json parsing (CookConfig struct)
template.go  — COOK.md loading, LoopContext struct, default template
loop.go      — agentLoop(), session logging, gate verdict parsing
sandbox.go   — Docker lifecycle (build, start, exec, stop, network, auth)
```

### Proposed TypeScript Architecture
```
src/
  cli.ts          — CLI entry (args, commands, dispatch)
  config.ts       — .cook.config.json parsing
  template.ts     — COOK.md loading, JS template literal execution
  loop.ts         — Agent loop orchestration, gate verdict parsing
  sandbox.ts      — Docker lifecycle via dockerode
  log.ts          — Session log file management
  ui/
    App.tsx        — Root Ink component, layout
    StatusBar.tsx  — Persistent bottom bar (step, iteration, elapsed time)
    LogStream.tsx  — Scrolling log output area
```

### Key Components

**Ink TUI layout:**
```
┌──────────────────────────────────────────────┐
│ [Log output streams here, scrolling upward]  │
│ ...                                          │
│ ...                                          │
├──────────────────────────────────────────────┤
│ work 1/3 | model: opus | 2m 13s | tokens: ? │
└──────────────────────────────────────────────┘
```

The `<Static>` component from Ink renders items once and never re-renders them — ideal for streaming log lines. The status bar is a fixed `<Box>` at the bottom using flexbox layout.

**Template system change:**
- Go: `{{.Step}}`, `{{if .LastMessage}}...{{end}}`
- JS: `${step}`, `${lastMessage ? `### Previous Output\n${lastMessage}` : ''}`
- COOK.md becomes a JS module exporting a tagged template or function, or a plain file with `${...}` interpolation evaluated at runtime

### Data Flow (unchanged conceptually)
```
CLI → loadConfig → loadCookMD → startSandbox → agentLoop
  └─ for each iteration:
      └─ for each step (work, review, gate):
          └─ renderTemplate(cookMD, context)
          └─ sandbox.runClaude(prompt)
          └─ appendToLog()
          └─ updateUI()  ← NEW
      └─ parseGateVerdict()
      └─ if DONE, break
  └─ stopSandbox()
```

### Related Components
- **Docker**: Still needed for sandboxing. The `dockerode` npm package is the standard Node.js Docker client.
- **Claude CLI**: Still invoked inside the container via `docker exec`. No change to how Claude is called.
- **Session logs**: Same markdown format, same `.cook/logs/` directory.

## Technology Choices

### Ink v6.8.0 (latest, Feb 2025)
- ESM-only
- Requires Node.js >= 20, React >= 19
- Uses Yoga (Facebook's Flexbox engine compiled to WASM) for layout
- Key components: `<Box>`, `<Text>`, `<Static>`, `<Spacer>`
- `useStdout()` hook for terminal dimensions
- `@inkjs/ui` v2.0.0 companion library provides Spinner, ProgressBar, StatusMessage, etc.

### dockerode (Docker SDK for Node.js)
- Most mature Node.js Docker client (~4M weekly downloads)
- Covers the full Docker API: image build, container create/start/stop/exec, file copy
- Stream-based API for build output and exec output
- Maps well to the current Go Docker SDK usage

### Template Literals vs Go Templates
| Feature | Go `text/template` | JS Template Literals |
|---|---|---|
| Interpolation | `{{.Field}}` | `${field}` |
| Conditionals | `{{if .X}}...{{end}}` | `${x ? '...' : ''}` |
| Loops | `{{range .Items}}...{{end}}` | `${items.map(i => ...).join('')}` |
| Familiarity | Niche | Universal among JS/TS devs |
| Safety | Auto-escaping available | Raw interpolation (fine for prompts) |

**Approach**: COOK.md contains template literal syntax. At runtime, cook reads the file and evaluates it as a template literal using `new Function()` with the context variables in scope. This gives users the full power of JS expressions without requiring COOK.md to be a .js/.ts file.

## Distribution

### npm package
- Package name: `cook` or `@rjcorwin/cook` (if `cook` is taken)
- `bin` field in package.json points to compiled CLI entry
- Users install with `npm install -g cook` (or `npx cook`)
- TypeScript compiled to JS at publish time (tsup or tsc)

### Considerations
- The Go version produces a single static binary with zero runtime dependencies
- The npm version requires Node.js >= 20 on the host (but Docker is already required, so this isn't a big new dependency)
- `npx cook` enables zero-install usage

## Constraints

- **Docker must still be available** — the sandbox model is core to cook's value
- **Node.js >= 20** — required by Ink v6
- **ESM only** — Ink v6 dropped CJS support; the entire project must be ESM
- **COOK.md backwards compatibility** — existing Go template syntax will break; users must migrate to JS template literal syntax. Migration is straightforward but should be documented.

## Prior Art

- **[Ink](https://github.com/vadimdemedes/ink)** — React for CLIs. Used by Cloudflare Wrangler, Gatsby CLI, Prisma, and others for rich terminal UIs.
- **[@inkjs/ui](https://github.com/vadimdemedes/ink-ui)** — Component library with Spinner, ProgressBar, StatusMessage, Badge, Alert.
- **[dockerode](https://github.com/apocas/dockerode)** — Node.js Docker client. Used by VS Code Dev Containers, Testcontainers, etc.
- **[Claude Code](https://github.com/anthropics/claude-code)** — Anthropic's CLI for Claude, which cook invokes inside the sandbox.

## Open Questions

1. ~~**Package name**: Is `cook` available on npm?~~ **Resolved**: Use `@rjcorwin/cook` scoped package.

2. ~~**COOK.md template evaluation safety**~~ **Resolved**: `new Function()` with template literals is safe against injection from Claude's output. Template literals don't recursively evaluate — `${ctx.lastMessage}` resolves to a string value, so even if `lastMessage` contains `${process.exit(1)}`, it's treated as literal text, not re-parsed as a template expression. The only code that executes is the COOK.md template itself, which the user controls. Same trust model as the current Go `text/template`.

3. ~~**Streaming Claude output to the TUI**~~ **Resolved**: Yes, stream Claude's output in real-time. Use dockerode's exec stream API to pipe stdout incrementally into the Ink TUI as it's generated, rather than waiting for completion. The full output is still captured for the session log and `lastMessage` context.

4. ~~**Status bar content**~~ **Resolved**: Show current step and iteration, model name, elapsed time, and session log path. No token usage/cost for now.

5. ~~**`cook init` and default COOK.md**~~ **Resolved**: No backwards compat. Just use JS template literal syntax. Users update their COOK.md manually.

6. ~~**Build tooling**~~ **Resolved**: tsup. CLI-only project, no library consumers — single bundled file is all we need.

7. ~~**Alternate screen buffer**~~ **Resolved**: No alternate screen buffer. Render inline like mew-protocol — use Ink's `Static` component for streaming output (renders once, scrolls naturally) with a fixed status bar at the bottom via flexbox (`flexGrow: 1` on content, fixed height on status bar).

8. ~~**Docker SDK choice**~~ **Resolved**: dockerode (v4.0.9). Battle-tested, 3.1M downloads/week, CJS-only but ESM interop works fine. Not worth risking `@docker/node-sdk` at v0.0.17 with 4 months of silence.
