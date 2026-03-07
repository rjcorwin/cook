# Devlog: Config Restructure — Move Files into .cook/

**Date:** 2026-03-07
**Implementing:** plan.md

## What Was Done

- Split `CookConfig` interface to remove `network` field; added separate `DockerConfig` interface in `src/config.ts`
- Added `resolveConfigPath()` with fallback from `.cook/config.json` to legacy `.cook.config.json`, with deprecation warnings
- Added `loadDockerConfig()` that reads `.cook/docker.json`, falling back to the `network` key in legacy `.cook.config.json`
- Updated `resolveDockerfilePath()` in `src/sandbox.ts` to check `.cook/Dockerfile` first, fall back to `.cook.Dockerfile`
- Changed `startSandbox()` signature to accept `DockerConfig` separately instead of pulling `network` from `CookConfig`
- Updated `cook init` in `src/cli.ts` to generate files in `.cook/` directory (config.json, Dockerfile, .gitignore) and create `.cook/logs/`
- Removed `network` from `DEFAULT_COOK_CONFIG_JSON` and `FALLBACK_CONFIG`
- Updated post-init instructions to reference `.cook/config.json` and `.cook/Dockerfile`
- Updated `README.md` to document the new `.cook/` directory structure, remove `network` from the example config, and add a migration note for existing users

## Tricky Parts

- The `loadDockerConfig()` fallback to the legacy `.cook.config.json` means the same file can be read twice (once by `loadConfig`, once by `loadDockerConfig`) when a user is still on the old layout. This is intentional — each function independently resolves its config, keeping them decoupled. The double-read is harmless for a small JSON file.

## Decisions Made

- Did not implement `DEFAULT_DOCKER_CONFIG_JSON` constant or `cook init --docker` scaffolding. The plan noted this as optional, and since most users are on native mode post-2.0, generating Docker config by default would add noise. Users who need Docker can create `.cook/docker.json` manually following the README examples.
- Auth check error messages in `cmdDoctor` were updated to reference `.cook/config.json` instead of `.cook.config.json` for the env passthrough hints.

## Deviations from Plan

- Step 3 item 7 (`DEFAULT_DOCKER_CONFIG_JSON`) was skipped — no scaffolding command for Docker config. The `DEFAULT_DOCKER_CONFIG` constant exists internally in `config.ts` as the fallback default, but is not exposed for file generation.
- Step 3 item 9 (`cmdDoctor` path references) — verified that `cmdDoctor` goes through `loadConfig()` which handles resolution, so no structural changes were needed; only string references in auth check messages were updated.

## Next Steps

- Code review pass, then PR
