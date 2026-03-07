# Research: Config Restructure — Move Files into .cook/, Split Docker Config

**Requester:** rjcorwin
**Date:** 2026-03-07

## Requirements

### Original Request
Move the Dockerfile and config into the `.cook/` directory, split Docker-specific config out into its own file, and add a `.gitignore` to `.cook/`. Currently config files are scattered in the project root (`.cook.config.json`, `.cook.Dockerfile`) while only logs live inside `.cook/`. This should be consolidated.

### Context
After the 2.0 release (q8r), Docker is no longer the default — native agent mode is. The config file still has Docker-specific fields (`network`) mixed in with general settings (`sandbox`, `agent`, `model`, `steps`, `env`, `animation`). With Docker as an optional mode, its config should live separately so the main config stays clean for the common native case.

Current file layout in a user's project after `cook init`:
```
project/
├── COOK.md                  # agent loop template (stays in root — users edit this)
├── .cook.config.json        # all config (general + Docker network)
├── .cook.Dockerfile         # Docker image customization
└── .cook/
    └── logs/                # session logs
```

### Open Questions
- Should `COOK.md` move into `.cook/`? **No.** It's the primary file users edit to customize prompts. It belongs in the project root for visibility, similar to how `README.md` stays at root.
- Should the main config file be JSON or another format? **Stay with JSON.** It's what we have, it works, no reason to change.
- What goes in the `.gitignore`? **Logs.** The `logs/` directory contains session-specific output that shouldn't be committed. Config files and the Dockerfile should be committed.
- Should we support the old file locations for backward compatibility? **Yes, with a migration warning.** Detect old-location files and warn the user to move them, but still load from old locations as a fallback. This avoids breaking existing projects on upgrade.
- Should Docker config be a separate file or a nested key in the main config? **Separate file.** Docker config (`network`, `allowedHosts`) is only relevant for `--sandbox docker` users. Keeping it in the main config clutters the common case. A separate `.cook/docker.json` keeps things clean.

## System Architecture

### Related Components

**Files that reference config/Dockerfile paths:**

| File | Reference | What it does |
|------|-----------|--------------|
| `src/config.ts:52` | `.cook.config.json` | Loads main config from project root |
| `src/sandbox.ts:104` | `.cook.Dockerfile` | Reads Dockerfile for Docker image build |
| `src/cli.ts:128-129` | `.cook.config.json`, `.cook.Dockerfile` | `cook init` generates these in project root |
| `src/cli.ts:146` | `.cook/logs/` | `cook init` creates logs directory |
| `src/cli.ts:150-151` | `.cook.config.json`, `.cook.Dockerfile` | `cook init` post-init instructions |
| `src/log.ts:34` | `.cook/logs/` | Session log writes |
| `src/cli.ts:389,409,425` | `.cook.config.json` | Auth check error messages reference config file name |

**Config fields currently in `CookConfig`:**
- General: `sandbox`, `agent`, `model`, `steps`, `env`, `animation`
- Docker-specific: `network` (`mode`, `allowedHosts`)

### Data Flow

1. `cook init` generates files at hardcoded paths
2. `loadConfig()` in `config.ts` reads `.cook.config.json` from project root
3. `getProjectImageTag()` in `sandbox.ts` reads `.cook.Dockerfile` from project root
4. `createSessionLog()` in `log.ts` writes to `.cook/logs/`
5. Docker `network` config is passed through `CookConfig` to `startSandbox()` in `sandbox.ts`

### Constraints

- Must not break existing projects — old file locations should still work with a deprecation warning
- `COOK.md` stays in project root (high visibility, frequently edited)
- `.cook/logs/` already lives in `.cook/` — no change needed
- Docker config is only read when `--sandbox docker` is used — can be loaded lazily alongside `dockerode`
- The `.cook/` directory is already created by `cook init` for logs

## Prior Art

### Similar tools
- **ESLint**: `.eslintrc` in root, with option for `eslint.config.js`
- **Prettier**: `.prettierrc` in root
- **Vite/Next.js**: Config in root, build artifacts in subdirectory
- **Claude Code**: `CLAUDE.md` in root, `.claude/` directory for internal state, `.claude/settings.json` for config

The pattern of "primary config visible in root, internal state in dotdir" is common. For Cook, `COOK.md` is the primary user-facing file (like `CLAUDE.md`), while `.cook/` holds operational config and state.

### Current `.cook/` directory
Already exists and is created by `cook init`. Currently only holds `logs/`. Adding config files here is a natural extension.
