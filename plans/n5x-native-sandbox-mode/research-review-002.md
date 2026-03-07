# Research Review: Native Agent Sandbox as Default

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** research.md

## Summary

Comprehensive, implementation-ready research covering the full scope of flipping cook's sandbox model from Docker-first to agent-native-first. The research excels in its per-agent config injection analysis — particularly the discovery that Claude Code's `--settings` concatenates permission arrays (not replaces), leading to the well-reasoned `CLAUDE_CONFIG_DIR` isolation strategy. Thirteen decisions are made inline, all with clear rationale. The two-tier config approach (zero-config hardcoded defaults vs `cook init` generated configs) is well-designed and provides a smooth onboarding gradient.

## Strengths

- **Config isolation analysis is excellent.** The Claude Code `CLAUDE_CONFIG_DIR` approach, the Codex CLI-flags-override-scalars finding, and the OpenCode deep-merge analysis each show genuine investigation into how user settings could undermine cook's intended restrictions. This is the kind of research that prevents security bugs.
- **Allowlist-only approach (Decision 12) is the right call.** Avoids the inherent incompleteness of deny lists. The per-agent mechanics are correctly mapped: Claude's implicit `ask` blocking in headless mode, OpenCode's explicit `"*": "deny"` base rule.
- **Decision 10 (OpenCode blocked from agent mode) is honest and correct.** Rather than pretending OpenCode's advisory permissions are a real sandbox, the research draws a clear line. Good security posture.
- **Concrete config examples for all three agents in both tiers** — these can be copied nearly verbatim into implementation.
- **The `AgentRunner` interface (Decision 5) is clean** — minimal surface area, preserves the existing Docker path, easy to extend.
- **Decision 9 (separate `.cook/docker.json`)** keeps the main config clean and avoids confusing users with settings that silently do nothing in agent mode.
- **Decision 13 (per-step sandbox modes)** is a pragmatic extension of the existing per-step override pattern, enabling useful workflows like sandboxed implementation + unsandboxed review.

## Gaps

### High

- None. The research is thorough and all critical security questions (config isolation, permission merging, OpenCode's lack of OS sandbox) are addressed with concrete mitigations.

### Medium

- **Auth credential discovery for `CLAUDE_CONFIG_DIR` isolation is underspecified.** The research says "copy auth credentials from `~/.claude/`" but doesn't detail which files constitute auth credentials. Claude Code stores API keys, OAuth tokens, and session data in various files under `~/.claude/`. The plan phase should enumerate exactly which files to copy (likely `credentials.json` or similar) to avoid copying too much (settings files, defeating isolation) or too little (breaking auth).
- **Codex `CODEX_HOME` isolation decision is left open.** The research notes CLI flags are sufficient for security-critical settings and `CODEX_HOME` is available as belt-and-suspenders, but doesn't commit to one approach. The plan should decide: CLI flags only, or `CODEX_HOME` isolation matching the Claude pattern? Consistency across agents would simplify the codebase.
- **Cleanup of temp directories.** The `CLAUDE_CONFIG_DIR` approach creates temp directories per run. The research doesn't mention cleanup — the `AgentRunner.cleanup()` method presumably handles this, but it should be explicit in the plan.

### Low

- **Zero-config `Edit` and `Write` have no path restrictions.** The hardcoded Claude defaults allow `Edit` and `Write` globally. In agent mode the agent's own OS sandbox (Seatbelt/Landlock) restricts filesystem access, so this is likely fine in practice — but it's worth noting that the permission layer alone doesn't restrict write scope. The `cook init` configs also lack path restrictions, which is presumably intentional for flexibility.
- **`BareRunner` uses `--dangerously-skip-permissions`.** For `sandbox: "none"`, the research proposes using dangerous bypass flags. An alternative would be to use cook's agent configs (the allowlist-only permissions) even in none mode, providing permission-level safety without OS sandboxing. This would make "none" mean "no OS sandbox" rather than "no safety at all." Worth discussing in the plan.
- **No mention of signal handling / process lifecycle.** When cook spawns native agent processes, SIGINT/SIGTERM propagation matters for clean shutdown. The current Docker mode handles this via container stop. Native mode needs equivalent handling. Minor — likely straightforward in implementation.

## Questions

- For the `CLAUDE_CONFIG_DIR` temp directory: does Claude Code's `--settings` flag still work when `CLAUDE_CONFIG_DIR` is redirected, or does it look for the settings file relative to the config dir? Need to verify these two mechanisms compose correctly.
- Decision 13 allows per-step sandbox modes, which means the runner might need to change between steps. Does `agentLoop` create a new runner per step, or does it need a runner factory? This affects the interface design.
- The zero-config path detects "no `.cook/` directory." What about partial states — e.g., `.cook/config.json` exists but `.cook/agents/` doesn't? Should cook fall back to hardcoded defaults per-agent when the agent config file is missing, even if other cook config exists?

## Recommendation

[x] Ready for human review
[ ] Needs revision (see gaps/questions above)

The research is solid and actionable. The medium gaps (auth credential enumeration, Codex isolation strategy, temp dir cleanup) are implementation details that the plan phase can resolve. No blocking issues prevent moving forward.
