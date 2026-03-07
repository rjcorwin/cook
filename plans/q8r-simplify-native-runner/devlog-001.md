# Devlog: Simplify Native Runner

**Date:** 2026-03-07
**Implementing:** plan.md

## What Was Done
- Created `src/runner.ts` with `AgentRunner` interface, `SandboxMode` type, and `RunnerPool` class
- Created `src/native-runner.ts` with `NativeRunner` that spawns agent processes directly via `child_process.spawn()`
- Created `src/bare-runner.ts` with `BareRunner extends NativeRunner`, overriding `getBypassFlags()` to add `--dangerously-*` flags
- Updated `src/sandbox.ts` to add `implements AgentRunner` to the `Sandbox` class
- Updated `src/loop.ts` to accept a `getRunner` callback instead of a `Sandbox` instance, with per-step sandbox resolution
- Updated `src/config.ts` to add `sandbox` field to `CookConfig` and per-step `sandbox` overrides
- Updated `src/cli.ts` with `--sandbox` flag, `RunnerPool` factory with lazy Docker imports, native-aware doctor checks, and updated auth messages
- Moved `dockerode` and `tar-stream` to `optionalDependencies` in `package.json`
- Added `external: ['dockerode', 'tar-stream']` to `tsup.config.ts`

## Tricky Parts
- **Lazy Docker imports required tsup config change.** The plan called for dynamic `import('./sandbox.js')` in the runner factory, but tsup would still bundle `dockerode` and `tar-stream` into the output since they're statically imported in `sandbox.ts`. Had to add them to `external` in `tsup.config.ts` so the dynamic import actually defers loading at runtime. The plan didn't anticipate this.
- **`cmdRebuild` also needed a dynamic import.** The plan only discussed lazy imports in the runner factory, but `cmdRebuild()` directly called `rebuildBaseImage` from `sandbox.js`. Without making this dynamic too, running `cook rebuild` would still eagerly load `dockerode`. Changed it to `const { rebuildBaseImage } = await import('./sandbox.js')`.

## Decisions Made
- **Kept `Sandbox` class name** rather than renaming to `DockerSandbox` as research.md suggested. The plan kept the name, and renaming would be churn with no functional benefit since the class is internal to `sandbox.ts`.
- **`optionalDependencies` instead of optional peer dependencies.** The plan said "optional peer dependencies" but `optionalDependencies` is the right npm field — peer deps would cause warnings for users who don't install Docker deps, while optional deps silently skip if unavailable.
- **Auth messages rewritten for native-awareness.** The plan didn't call this out, but the existing messages all referenced "container-usable credentials" which would confuse users in native mode. `checkClaudeAuth` now accepts `usedModes` and treats host login as sufficient when Docker isn't in use. Other auth functions got simpler, mode-neutral wording.
- **`tar-stream` also moved to optionalDependencies.** The plan only mentioned `dockerode`, but `tar-stream` is only used by `sandbox.ts` for Docker file copying. No reason to require it for native-only users.

## Deviations from Plan
- **tsup external config** (not in plan): Added `external: ['dockerode', 'tar-stream']` to `tsup.config.ts` — necessary for dynamic imports to actually work with the bundler.
- **`cmdRebuild` dynamic import** (not in plan): Changed `cmdRebuild()` to dynamically import `sandbox.js` to avoid eager `dockerode` loading.
- **Auth logic changes** (not in plan): `checkClaudeAuth` gained a `usedModes` parameter; host login is now accepted in native mode. Error messages across all auth checks were updated to remove Docker-centric language.
- **`tar-stream` as optionalDependency** (plan only mentioned `dockerode`): Both Docker-only deps moved together.
- **`cook init` unchanged** (plan said to generate `.cook.Dockerfile`, `.cook/logs/`, `.cook/.gitignore`): Only the default config JSON was updated to include `"sandbox": "agent"`. The other init artifacts were not added — they may need a follow-up.
- **`CYAN` import removed from `cli.ts`** (not in plan): Became unused after changes and was dropped from the log import line.
- **No `agent-utils.ts` shared utilities** (research suggested keeping spawnAgent, gracefulShutdown, buildEnv from n5x): Spawn logic lives directly in `NativeRunner` rather than being extracted into a shared utility module. The plan intentionally chose this simpler approach — one class owns its own spawn logic.

## Next Steps
- Verify `cook init` generates all planned artifacts (`.cook.Dockerfile`, `.cook/logs/`, `.cook/.gitignore`)
- End-to-end testing of all three modes (`agent`, `docker`, `none`)
- Code review pass
