# Test Plan: Native Agent Sandbox

## Config Isolation Tests

### T1: `CLAUDE_CONFIG_DIR` + `--settings` composability
Verify that `--settings` works correctly when `CLAUDE_CONFIG_DIR` is redirected to a temp directory.

**Steps:**
1. Create a temp directory with only `.credentials.json` copied from `~/.claude/`
2. Write a `settings.json` into the temp dir with a known permission config
3. Run `CLAUDE_CONFIG_DIR=/tmp/cook-test claude --settings '{"permissions":{"allow":["Read"]}}' --print "what tools do you have?"` (or similar introspection prompt)
4. Verify the agent sees cook's permissions, not the user's `~/.claude/settings.json`

**Fallback if they don't compose:** Write permissions directly into the temp dir's `settings.json` and skip `--settings` flag entirely.

### T2: `CLAUDE_CONFIG_DIR` isolation from user settings
Verify that user's `~/.claude/settings.json` permissions do NOT leak into a cook run.

**Steps:**
1. Add a distinctive permission to `~/.claude/settings.json` (e.g., `"allow": ["Bash(echo LEAKED)"]`)
2. Run cook with `CLAUDE_CONFIG_DIR` pointing to temp dir (without that permission)
3. Verify the agent cannot use `Bash(echo LEAKED)` — it should be blocked in headless mode

### T3: `CLAUDE_CONFIG_DIR` auth works
Verify that copying `.credentials.json` alone is sufficient for authentication.

**Steps:**
1. Create temp dir with only `.credentials.json` from `~/.claude/`
2. Run `CLAUDE_CONFIG_DIR=/tmp/cook-test claude --print "hello"`
3. Verify the agent authenticates and responds (not an auth error)

### T4: Codex CLI flags override user config
Verify that `--sandbox` and `--ask-for-approval` flags override `~/.codex/config.toml`.

**Steps:**
1. Set `~/.codex/config.toml` to `sandbox_mode = "danger-full-access"`
2. Run `codex exec --sandbox workspace-write --ask-for-approval never --model <model> - <<< "try to access the network"`
3. Verify network access is blocked (workspace-write default)

## Sandbox Mode Tests

### T5: Zero-config defaults (no `.cook/` directory)
Verify that running `cook "do something"` with no `.cook/` directory uses locked-down hardcoded defaults.

**Steps:**
1. Remove or rename `.cook/` directory
2. Run `cook "list files in /etc/passwd"` (or similar potentially dangerous prompt)
3. Verify the agent is restricted — cannot run arbitrary bash commands

### T6: `cook init` generates agent configs
Verify that `cook init` creates `.cook/agents/` with all three config files.

**Steps:**
1. Run `cook init` in a fresh directory
2. Verify `.cook/agents/claude.json`, `.cook/agents/codex.toml`, `.cook/agents/opencode.json` exist
3. Verify contents match the expected permissive-but-safe configs from research

### T7: OpenCode + `sandbox: "agent"` is rejected
Verify that cook errors out when OpenCode is used with agent sandbox mode.

**Steps:**
1. Set `.cook/config.json` to `{"sandbox": "agent", "agent": "opencode"}`
2. Run `cook "hello"`
3. Verify cook exits with a clear error about OpenCode lacking a native sandbox

### T8: Per-step sandbox mode switching
Verify that different steps can use different sandbox modes.

**Steps:**
1. Configure steps with mixed sandbox modes (e.g., step 1: `"agent"`, step 2: `"none"`)
2. Run cook
3. Verify each step uses the correct runner/sandbox mode

## Cleanup Tests

### T9: Temp directory cleanup on success
Verify that the `CLAUDE_CONFIG_DIR` temp directory is deleted after a successful run.

**Steps:**
1. Run cook with Claude in agent mode
2. Note the temp directory path (from logs or debug output)
3. After run completes, verify the temp directory no longer exists

### T10: Temp directory cleanup on failure
Verify that the temp directory is cleaned up even if the agent run fails.

**Steps:**
1. Run cook with an intentionally failing prompt or config
2. Verify the temp directory is cleaned up despite the failure
