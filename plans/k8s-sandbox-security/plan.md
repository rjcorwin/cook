# Plan: Remove --sandbox none

**Status:** Revised (addressing review feedback)
**Author:** rj + claude
**Created:** 2026-03-18

## Summary

Remove `--sandbox none` from cook entirely. The only two sandbox modes are `agent` (default, native OS sandbox) and `docker` (container isolation). `--dangerously-skip-permissions` is only ever passed to child agents inside Docker containers, where the container itself is the security boundary.

## Motivation

`--sandbox none` passes `--dangerously-skip-permissions` to child agent processes, which skips all permission prompts. When cook runs as a Claude Code skill, any agent authorized to run cook can escalate by adding `--sandbox none`. Removing the mode eliminates the attack surface entirely.

## Goals

- Remove `--sandbox none` as a valid sandbox mode
- `--dangerously-skip-permissions` only used inside Docker containers
- `--sandbox agent` is the default and works for all typical use cases
- Clear deprecation warning when old configs use `"sandbox": "none"`

## Non-Goals

- Not adding a new fine-grained permission system to cook
- Not changing Docker mode behavior
- Not modifying historical files (test runs, old plans)

## Technical Design

### 1. Delete BareRunner

Delete `src/bare-runner.ts`. This class extends `NativeRunner` solely to add `--dangerously-skip-permissions` flags.

### 2. Update SandboxMode type

In `src/runner.ts`, change:
```typescript
export type SandboxMode = 'agent' | 'docker'
```

### 3. Update config validation

In `src/config.ts`:
- Update `isSandboxMode()` to reject `'none'`
- Add deprecation warning in `loadConfig()` when `parsed.sandbox === 'none'`:
  `logWarn('sandbox: "none" is no longer supported, using "agent"')`

### 4. Update parser

In `src/parser.ts` line 96: remove `'none'` from the sandbox flag validation.

### 5. Update race.ts (critical — caught by review)

In `src/race.ts`:
- Remove `import { BareRunner } from './bare-runner.js'`
- Remove `case 'none': return new BareRunner(...)` from `createRunnerPool()`

### 6. Update CLI

In `src/cli.ts`:
- Remove `none` from help text (`--sandbox MODE` description)
- Remove `none` from `DEFAULT_COOK_CONFIG_JSON` template
- Remove the `case 'none'` runner factory branch
- Update `cmdDoctor()` — remove `usedModes.has('none')` check

### 7. Update docs

- `README.md`: Remove `none` from sandbox table and examples
- `index.html`: Remove `none` from sandbox table
- `SPEC.md` (root): Remove `none` from `--sandbox` flag help text (line 330)
- `tests/SPEC.md`: Remove `--sandbox none` from all test commands (default `agent` is sufficient)
- `tests/README.md`: Update references
- `.claude/skills/cook/SKILL.md`: Copy from `skill/SKILL.md` (source is already fixed)
- Historical files (`tests/runs/`, `plans/`) left unchanged

### 8. Update tests

All SPEC.md tests currently use `--sandbox none`. Since `--sandbox agent` is the default, simply removing `--sandbox none` from commands is sufficient.

## Implementation Approach

1. Delete `src/bare-runner.ts`
2. Update `SandboxMode` type in `runner.ts`
3. Update `isSandboxMode()` and add deprecation warning in `config.ts`
4. Update sandbox validation in `parser.ts`
5. Update `race.ts` — remove BareRunner import and case branch
6. Update `cli.ts` — help text, default config, runner factory, doctor
7. Build and verify (TypeScript will catch any missed references)
8. Update README.md, index.html, SPEC.md, tests/README.md
9. Smoke test with default sandbox mode

## Alternatives Considered

### Config-based lock (`sandboxLock` in config.json)
Rejected — agent can modify config files, making it bypassable.

### TTY detection (refuse `--sandbox none` when no TTY)
Rejected — clever but brittle. Removing the mode entirely is simpler and more secure.

### Keep `--sandbox none` but warn
Rejected — warnings don't prevent escalation. The only reliable enforcement is removing the capability.
