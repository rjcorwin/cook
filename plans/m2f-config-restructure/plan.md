# Plan: Config Restructure — Move Files into .cook/, Split Docker Config

**Status:** Implemented
**Author:** rjcorwin + Claude
**Created:** 2026-03-07

## Summary

Consolidate config files into the `.cook/` directory and split Docker-specific config into its own file. The root-level `.cook.config.json` moves to `.cook/config.json`, `.cook.Dockerfile` moves to `.cook/Dockerfile`, Docker network config moves to `.cook/docker.json`, and a `.gitignore` is added to `.cook/` to exclude logs. Old file locations are supported with deprecation warnings.

## Motivation

After the 2.0 release, native agent mode is the default. Most users never touch Docker config, but it clutters `.cook.config.json` alongside general settings. Config files are scattered between the project root and `.cook/` — consolidating them makes the project cleaner and follows the pattern established by tools like Claude Code (`.claude/settings.json` inside `.claude/`).

## Goals

- Move `.cook.config.json` to `.cook/config.json`
- Move `.cook.Dockerfile` to `.cook/Dockerfile`
- Extract `network` config into `.cook/docker.json`
- Add `.cook/.gitignore` to exclude `logs/`
- Backward compatibility: detect old-location files, load them as fallback, warn user to migrate
- Update `cook init` to generate files in new locations

## Non-Goals

- Moving `COOK.md` — it stays in root for visibility
- Changing config format (stays JSON)
- Automatic migration (user moves files manually after seeing the warning)

## Technical Design

### New file layout

```
project/
├── COOK.md                    # stays in root
└── .cook/
    ├── .gitignore             # ignores logs/
    ├── config.json            # general config (sandbox, agent, model, steps, env, animation)
    ├── docker.json            # Docker-only config (network mode, allowedHosts)
    ├── Dockerfile             # Docker image customization
    └── logs/                  # session logs (gitignored)
```

### Config shape changes

**`.cook/config.json`** (formerly `.cook.config.json`):
```json
{
  "agent": "claude",
  "sandbox": "agent",
  "model": "opus",
  "animation": "strip",
  "env": [],
  "steps": {
    "work": {},
    "review": {},
    "gate": {}
  }
}
```

The `network` field is removed from this file.

**`.cook/docker.json`** (new):
```json
{
  "network": {
    "mode": "restricted",
    "allowedHosts": []
  }
}
```

### Type changes in `src/config.ts`

Split `CookConfig` so Docker network config is separate:

```ts
// General config — loaded always
export interface CookConfig {
  sandbox: SandboxMode
  agent: AgentName
  model?: string
  animation: AnimationStyle
  env: string[]
  steps: Record<StepName, StepAgentConfig>
}

// Docker config — loaded only when sandbox=docker
export interface DockerConfig {
  network: {
    mode: 'restricted' | 'unrestricted'
    allowedHosts: string[]
  }
}
```

### File resolution with fallback

Add a helper that checks new location first, falls back to old, and warns:

```ts
function resolveConfigFile(projectRoot: string): string | null {
  const newPath = path.join(projectRoot, '.cook', 'config.json')
  const oldPath = path.join(projectRoot, '.cook.config.json')
  if (fs.existsSync(newPath)) return newPath
  if (fs.existsSync(oldPath)) {
    logWarn(`Deprecated: .cook.config.json found in project root. Move it to .cook/config.json`)
    return oldPath
  }
  return null
}
```

Same pattern for Dockerfile and docker.json (with the old `network` key in `.cook.config.json` as the legacy source for docker config).

### `.cook/.gitignore`

```
logs/
```

## Implementation Approach

### Step 1: Update `src/config.ts`

1. Split `CookConfig` interface — remove `network` field
2. Add `DockerConfig` interface
3. Add `loadDockerConfig(projectRoot): DockerConfig` function
4. Update `loadConfig()` to resolve from `.cook/config.json` with fallback to `.cook.config.json`
5. In the fallback path, if old config has `network`, warn about migration to `.cook/docker.json`
6. `loadDockerConfig()` reads `.cook/docker.json`, falls back to `network` key in old `.cook.config.json`

### Step 2: Update `src/sandbox.ts`

1. Update `getProjectImageTag()` to look for `.cook/Dockerfile` first, fall back to `.cook.Dockerfile`
2. Update `startSandbox()` to accept `DockerConfig` instead of pulling `network` from `CookConfig`

### Step 3: Update `src/cli.ts`

1. Update `cook init` to generate files in `.cook/` instead of project root
2. Generate `.cook/.gitignore` with `logs/`
3. Generate `.cook/config.json` (without `network`)
4. Generate `.cook/Dockerfile`
5. Do NOT generate `.cook/docker.json` by default — only Docker users need it
6. Update `DEFAULT_COOK_CONFIG_JSON` to exclude `network`
7. Add `DEFAULT_DOCKER_CONFIG_JSON` for when users opt into Docker
8. Update banner/help text references to old filenames
9. Update `cmdDoctor` if it references config paths
10. Wire `loadDockerConfig()` into the sandbox factory (only called when mode is `docker`)

### Step 4: Update error messages

1. Grep for `.cook.config.json` string references in cli.ts auth checks and update them
2. Update `cook init` post-init instructions to reference new paths

### Step 5: Tests (if any exist)

1. Update any test fixtures that reference old paths
2. Verify fallback loading works for old-location files

### Order of operations

Steps 1-2 can be done together (config + sandbox changes). Step 3 depends on 1-2. Step 4 is a cleanup pass. Step 5 is verification.

## Alternatives Considered

**Keep everything in one config file, just move it to `.cook/config.json`** — Simpler, but Docker config still clutters the common case. Since most users are on native mode post-2.0, the extra `network` field is noise. Splitting keeps the default config minimal.

**TOML or YAML instead of JSON** — No real benefit for the config sizes involved. JSON is already in use, works fine, and requires no new dependencies.

**Auto-migrate old files** — Risky. Moving user files without explicit consent could surprise people, especially if they have uncommitted changes or custom tooling that references the old paths. A warning + manual migration is safer.
