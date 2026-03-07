# Plan Review: Native Agent Sandbox as Default

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** plan.md

## Summary

The plan is well-structured with a clean interface extraction (`AgentRunner`), three clear runner implementations, and a phased implementation approach that maintains a working system at each step. It faithfully implements the research decisions. However, the document contains unresolved self-corrections (stream-of-consciousness editing left in), several gaps in how custom agent configs are loaded at runtime, and a contradiction with research Decision 9 on Docker network config placement.

## Strengths

- **Phased implementation approach** — each of the 6 phases produces a working state, starting with a pure refactor (no behavior change) and layering new behavior incrementally. This is excellent for a change of this scope.
- **`AgentRunner` interface** matches the existing `Sandbox.runAgent()` signature closely, making Phase 1 a clean mechanical rename with no behavior change.
- **`CLAUDE_CONFIG_DIR` isolation** is the right call and is well-specified — exactly two files in the temp dir, clear lifecycle, clean separation from user config.
- **Codex CLI flag override** avoids unnecessary temp dir complexity since scalar flags fully override user config.
- **OpenCode rejection** for `sandbox: "agent"` is properly validated early with a clear error message.
- **`RunnerPool`** with lazy creation avoids spinning up Docker or temp dirs for modes that aren't used in a given run.
- **Per-step sandbox override** reuses the existing step config pattern naturally.

## Concerns

### High

- **Plan contains unresolved stream-of-consciousness.** Lines 100–108 show a table with `--permission-mode bypassPermissions`, followed by "Wait — correction on Claude" and "Actually, looking at the research more carefully..." paragraphs. The final approach (lines 109–123) is correct, but the superseded table and correction narrative are still in the document. A plan should state the final design, not the journey to it. This creates ambiguity about which approach is canonical. **Fix: Remove the initial table's Claude row and the correction paragraphs; keep only the final invocation block (lines 109–123).**

### Medium

- **Contradicts research Decision 9 on `network` config.** Research decided on Option A: move Docker network settings to a separate `.cook/docker.json`. The plan (line 195) says "The `network` field stays in the config type for now" and defers the separation as "future cleanup." If the plan intentionally overrides Decision 9, it should state why. If it's following it, the implementation phases should include the config split. **Suggestion: Either follow Decision 9 or add an explicit decision override with rationale (e.g., "Decision 9 deferred to reduce scope; network field stays in main config, documented as Docker-only").**

- **Custom agent config loading is unspecified.** The plan describes hardcoded defaults (Section 6) and `cook init` generating editable files (Section 7), but never specifies the lookup chain in `NativeRunner`. When does it check `.cook/agents/claude.json`? Does the file override the hardcoded default entirely, or merge? What about the `agents.<name>.settings` path override from Decision 3? Phase 3 says "Hardcode default configs" but doesn't mention the file-lookup logic. **Fix: Add a "Config resolution" subsection to NativeRunner (Section 2) specifying: check `.cook/agents/<agent>.<ext>` → fall back to hardcoded defaults. Note whether file contents replace or extend the defaults.**

- **`.cook/agents/codex.toml` usage unclear.** The plan says `cook init` generates this file and that Codex uses CLI flags for defaults. But it doesn't explain how the generated `codex.toml` is consumed. Does NativeRunner pass `--config` pointing to it? Does it read the file and extract flags? Or is it purely documentation for users who want to customize their Codex setup outside cook? **Fix: Specify in NativeRunner how/whether `.cook/agents/codex.toml` is used at runtime.**

- **BareRunner config isolation behavior unstated.** The plan says BareRunner passes `--dangerously-skip-permissions` but doesn't state whether it also uses `CLAUDE_CONFIG_DIR` isolation or the user's native config. For `sandbox: "none"` the expectation is "no sandbox, trusts the environment" — meaning the user's personal Claude/Codex settings apply. This should be explicit. **Fix: Add a sentence to BareRunner (Section 4) stating "Uses the user's native agent config; no config isolation."**

### Low

- **Default permissions may be broader than intended.** `Bash(npm *)` matches `npm publish`, `npm cache clean --force`, `npm uninstall`. `Bash(git checkout *)` matches `git checkout -f`. The plan correctly notes the OS sandbox restricts filesystem operations, but `npm publish` is a network operation that the OS sandbox may not block (depending on agent). This is a tuning concern, not a design flaw — flagging for awareness.

- **`cook rebuild` in Phase 5 is underspecified.** Step 19 mentions "Add `cook rebuild` note — only relevant for Docker mode" but doesn't describe what changes. Currently `cmdRebuild()` unconditionally rebuilds the Docker image. Should it error/warn in agent mode? Or is it always Docker-specific?

- **No `.gitignore` update for `.cook/`.** Currently `.cook.config.json` and `.cook.Dockerfile` are presumably committed. The new `.cook/` directory will contain `logs/` (which should be gitignored) alongside config files (which should be committed). The plan should note whether `.cook/logs/` is already gitignored or needs a `.cook/.gitignore` entry.

## Suggestions

- Clean up the Claude invocation section to present only the final approach. The correction narrative is valuable in research but distracting in a plan.
- Add a "Config resolution order" section to NativeRunner that mirrors the clarity of the existing `loadConfig()` description.
- Consider whether `Bash(npm run *)` (matching only npm scripts) is safer than `Bash(npm *)` (matching all npm subcommands) for the default config.

## Recommendation

[ ] Ready for human review
[x] Needs revision (see concerns above)

The High concern (stream-of-consciousness left in the document) and the first two Medium concerns (Decision 9 contradiction, config loading gap) should be resolved before this plan is ready for human review. A quick revision pass would address all of them.
