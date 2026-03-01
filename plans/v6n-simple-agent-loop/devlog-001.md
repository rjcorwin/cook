# Devlog: Simple Agent Loop — Go Rewrite

**Date:** 2026-03-01
**Implementing:** plan.md

## What Was Done
- Initialized Go module in `cook/` with Docker SDK dependency (`github.com/docker/docker@v27.5.1`)
- Implemented `config.go`: `CookConfig` struct, `loadConfig()` for `.cook.config.json`
- Implemented `template.go`: `LoopContext` type, `renderTemplate()`, `loadCookMD()`, embedded default COOK.md template
- Implemented `sandbox.go`: full Docker container lifecycle using Docker Go SDK — `ensureBaseImage`, `buildImage`, `startSandbox`, `stopSandbox`, `containerExec`, `containerExecWithEnv`, `runClaude`, `copyFileToContainer`, `cleanupStaleContainers`, `rebuildBaseImage`, `generateIptablesScript`
- Implemented `loop.go`: `agentLoop()` with work→review→gate loop, `createSessionLog()`, `appendToLog()`, `parseGateVerdict()`
- Implemented `main.go`: entry point with `flag` parsing, `cmdInit`, `cmdRebuild`, colored logging functions, usage text
- Removed the 1215-line bash `cook` script

## Tricky Parts
- **Docker SDK version mismatch**: The plan specified `github.com/docker/docker/client` as the import path, but the Docker Go SDK has been reorganized under `github.com/moby/moby`. The split-module versions (`github.com/docker/docker/client@v0.2.2`) declare themselves as `github.com/moby/moby/client` internally, which causes `go get` to fail. Fixed by pinning to the older monolithic `github.com/docker/docker@v27.5.1+incompatible` which keeps the traditional import paths.
- **ImageBuild API**: The plan used `image.BuildOptions` but v27 of the Docker SDK places this type as `types.ImageBuildOptions` in `github.com/docker/docker/api/types`. Required adding the `types` import alongside the `image` import (which is still needed for `image.RemoveOptions`).
- **`containerExec` vs `containerExecWithEnv`**: The bash script sets `HOME=/home/cook` via `-e HOME=/home/cook` on `docker exec`. The Docker SDK's `ExecOptions` has an `Env` field, so I added a `containerExecWithEnv` variant used specifically by `runClaude`. Regular `containerExec` (for user setup, chown, etc.) doesn't need extra env vars.

## Decisions Made
- **Kept `strconv` out of sandbox.go**: Rather than converting UID/GID to integers and back, kept them as strings from `user.Current()` since they're only used in string formatting contexts (container exec commands, userSpec).
- **No interactive `init` prompts**: The bash version had `read -rp` prompts for replacing existing COOK.md. The Go version silently skips if files exist — simpler, and users can just delete and re-run.
- **`exec.Command` for git config**: Used `os/exec` directly instead of running git config inside the container, since git identity is read from the host before the container starts.

## Deviations from Plan
- **No `strconv` import needed**: Plan showed `strconv.Atoi` for parsing iteration count from args; this is in `main.go` but `strconv` isn't needed in other files.
- **Added `containerExecWithEnv`**: Plan showed a single `containerExec`; implementation added a variant that accepts environment variables, needed for setting `HOME=/home/cook` when running Claude.
- **Stale container cleanup moved**: Plan didn't specify when to clean up stale containers. Implementation calls `cleanupStaleContainers` at the start of `startSandbox`, matching the bash script's behavior.

## Next Steps
- Manual testing: `cook init`, edit COOK.md, `cook "create a hello world script" 2`
- Update `install.sh` to build from Go source instead of downloading a bash script
