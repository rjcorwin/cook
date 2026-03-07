# COOK-REVIEW-001: Remaining LOW Issues from n5x-native-sandbox-mode

Post-implementation review residuals. All 13 medium/high issues were resolved across 4 review passes. These 15 LOW issues remain — none blocking release.

## Recommended fixes (low effort, real value)

### 1. Dead code: `streamToBuffer` — sandbox.ts:42-48
Defined but never called. Remove it.

### 2. `FALLBACK_CONFIG` duplicates `config.ts` defaults — cli.ts:389-395 vs config.ts:50-56
Both define the same defaults separately. If one changes, the other must too. Derive `FALLBACK_CONFIG` from a shared source.

### 3. Gate verdict scans from first line — loop.ts:28-33
`parseGateVerdict` returns on the first keyword match. Agent reasoning like "Done reviewing..." before the actual "ITERATE" verdict causes a false `DONE`. Scan from the last line instead.

## Worth fixing

### 4. `appendToLog` uses `console.error` instead of `logWarn` — loop.ts:92
Every other warning uses `logWarn()` for consistent formatting. One-line fix.

### 5. `rebuildBaseImage` builds silently — sandbox.ts:426
`cook rebuild` calls `buildImage()` with `verbose: false`. The project-specific image uses `verbose: true`. Users see no progress during rebuild.

### 6. Config load silent on fallback — config.ts:62-68
No log output when neither config file is found. Users debugging "why isn't my config being read" will struggle. A debug-level log would help.

### 7. Malformed non-array `env` config silently ignored — config.ts:75-77
If user writes `"env": "FOO"` (string instead of array), `Array.isArray` returns false and defaults are silently used. No warning logged.

### 8. Exit code race between `main().catch()` and signal handlers — cli.ts
On SIGINT, both the signal handler and `main().catch()` can reach `process.exit()`. JS microtask ordering determines which fires first. In the rare case `.catch()` wins, Ctrl+C exits with code 1 instead of 130. Very narrow race window.

## Acceptable tradeoffs (fix if convenient)

### 9. OpenCode `$(cat)` still hits ARG_MAX — bare-runner.ts:53, sandbox.ts:230
Comment says "Write prompt to temp file to avoid ARG_MAX" but `$(cat "$2")` expands into a command-line argument before `exec opencode`. ARG_MAX (~2MB) still applies. Only affects OpenCode since Claude/Codex pipe via stdin.

### 10. TOML `#` in bare values — toml.ts:72-75
Inline comment stripping (`rest.indexOf('#')`) truncates bare values containing `#`. Not exploitable since codex config keys don't use `#`, but fragile if config evolves.

### 11. `whichSync` uses `which` command — agent-utils.ts:32-34
`which` may not exist on minimal Docker images. Could use `command -v` or resolve PATH manually.

### 12. OpenCode temp file predictable name — bare-runner.ts:50
`Date.now()` + `Math.random()` is predictable. On shared systems another user could race to read the prompt. Acceptable since `--sandbox none` is explicitly no-isolation mode.

### 13. RunnerPool caches factory rejections — runner-pool.ts:11-14
A failed factory (e.g., Docker not running) caches the rejected Promise. Subsequent `get()` returns the same rejection without retrying. Fine for fail-fast CLI behavior, problematic if retry logic is ever added.

### 14. DockerSandbox has no `process.on('exit')` handler — sandbox.ts:315-332
Unlike NativeRunner and BareRunner, DockerSandbox doesn't register a fallback exit handler. If the process is killed without cleanup (SIGKILL), the container is orphaned. Mitigated by `cleanupStaleContainers` on next run.

### 15. Docker dependency always installed — package.json
`dockerode` remains a hard dependency even though Docker is now optional. ~1MB install cost for agent/none users. Could be moved to `optionalDependencies` or dynamically imported.
