# Research Review: Native Agent Sandbox as Default

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** research.md

## Summary

Thorough and well-structured research that covers all three target agents (Claude Code, Codex, OpenCode), their config injection mechanisms, and proposes a clean three-mode sandbox architecture. The agent config research is particularly strong — each agent's settings mechanism, CLI flags, and config file formats are documented with concrete examples. Twelve decisions are made inline, all well-reasoned. After human review feedback, three key decisions were added: OpenCode blocked from agent sandbox mode (Decision 10), no config merging with user settings (Decision 11), and allowlist-only permissions (Decision 12). The research is actionable enough to move to planning.

## Strengths

- Detailed per-agent config research with exact CLI flags, file paths, and config formats — this is implementation-ready
- Clear articulation of the four motivations (no Docker dependency, better agent-native permissions, autonomous-safe configs, safe by default)
- Both zero-config (hardcoded locked-down) and `cook init` (permissive but safe) config tiers are fully specified with concrete JSON/TOML examples
- Decision 8 (breaking change to default to agent mode) is pragmatic given the single-user state of the project
- Decision 9 explores three options for Docker config placement and picks the cleanest one (separate file)
- The `AgentRunner` interface abstraction (Decision 5) is a clean design that preserves the existing Docker path while adding new modes

## Gaps

### High

- None identified. The research covers the critical areas needed for planning.

### Medium

- ~~**OpenCode lacks a real OS-level sandbox.**~~ **Resolved:** Decision 10 added — cook will warn and exit if OpenCode is used with `sandbox: "agent"`. OpenCode is only allowed with `docker` or `none`.
- ~~**Permission rule completeness.**~~ **Resolved:** Decision 12 added — switched to allowlist-only approach. No deny lists to maintain. Unlisted tools block in headless mode (Claude via `ask` default, OpenCode via `"*": "deny"` base rule).
- ~~**Config isolation from user settings.**~~ **Resolved:** Research confirmed that Claude's `--settings` concatenates permission arrays across scopes (does NOT replace). Decision 11 updated: cook will use `CLAUDE_CONFIG_DIR` to redirect Claude's config directory to a cook-managed temp directory with only auth credentials + cook's settings. OpenCode isolation via `OPENCODE_CONFIG` still needs verification during implementation.

### Low

- **Per-step sandbox modes** (Open Question 5) is raised but never decided. This is fine to defer to planning, but worth noting it's still open.
- **Config file naming for `.cook/config.json`** — Decision 4 moves from `.cook.config.json` to `.cook/config.json`. The migration path for existing `.cook.config.json` files isn't discussed (though Decision 8 acknowledges single-user status makes this moot for now).
- **`cook doctor` for agent mode** could also verify that the agent's OS-level sandbox is functional (e.g., Landlock kernel support on Linux) rather than just checking the CLI is installed. This may be out of scope for cook, but worth considering.

## Questions

- For the zero-config Claude defaults, `Edit` and `Write` are allowed without path restrictions. Is this intentional? The `cook init` version also has no path restrictions on Edit/Write. Should zero-config at least restrict writes to the project directory?
- What happens if an agent config file at `.cook/agents/claude.json` exists but `sandbox` is set to `"docker"`? Are the agent config files simply ignored in docker mode, or is this an error?
- The `BareRunner` for `sandbox: "none"` uses `--dangerously-skip-permissions`. Should it instead use the agent's own config (like agent mode) but without the OS sandbox? That would give permission-level safety even in "none" mode.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see gaps/questions above)

The original medium gaps (OpenCode sandbox, deny list completeness) have been resolved via Decisions 10 and 12. The remaining open item — verifying config isolation from user settings (Decision 11) — can be resolved during implementation with testing. The research provides a solid foundation with concrete, implementation-ready details for all three agents.
