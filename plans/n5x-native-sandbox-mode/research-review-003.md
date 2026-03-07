# Research Review: Native Agent Sandbox as Default

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** research.md (post-revision, incorporating Decisions 10-13 and decision-r3k-runner-per-step.md)

## Summary

The research is mature and implementation-ready after two prior review cycles. All previously identified high and medium gaps have been resolved. The 13 decisions are well-reasoned and internally consistent. The `CLAUDE_CONFIG_DIR` isolation strategy, Codex CLI-flag-override finding, and OpenCode agent-mode block (Decision 10) form a coherent security posture across all three agents. The supplementary decision document (decision-r3k) and TEST.md demonstrate thoroughness. This review focuses on residual questions and implementation-readiness rather than structural gaps.

## Strengths

- **Security analysis is the standout.** The discovery that Claude's `--settings` concatenates permission arrays — and the pivot to `CLAUDE_CONFIG_DIR` isolation — is exactly the kind of finding that prevents real security bugs in production.
- **Two-tier config design is well-calibrated.** Zero-config (locked-down hardcoded) vs `cook init` (permissive-but-safe) gives a clean onboarding gradient without sacrificing safety.
- **Per-agent isolation strategies are appropriately different.** Claude gets full config dir isolation, Codex gets CLI flag overrides (sufficient because scalars), OpenCode is blocked from agent mode entirely. Each strategy matches the agent's actual config mechanics rather than forcing a one-size-fits-all approach.
- **Decision 13 + decision-r3k compose well.** Per-step sandbox modes with a lazy runner pool is pragmatic — handles the common single-mode case with zero overhead while correctly reusing expensive Docker runners across steps.
- **TEST.md covers the critical verification points** — especially T1-T3 for `CLAUDE_CONFIG_DIR` composability, which is the riskiest assumption in the design.
- **Auth credential analysis is now specific.** Only `.credentials.json` needs to be copied, with explicit exclusion list for everything else. This was a medium gap in review-002 and is now fully resolved.

## Gaps

### High

- None.

### Medium

- **`OPENCODE_CONFIG_CONTENT` as highest priority may not fully override deep-merged keys.** The research says `OPENCODE_CONFIG_CONTENT` is priority 5 (highest) and uses `remeda.mergeDeep()`. For the zero-config path, cook plans to use `OPENCODE_CONFIG_CONTENT` with the hardcoded permissions. But since OpenCode is blocked from `sandbox: "agent"` (Decision 10), this only matters for `sandbox: "docker"` (where user config doesn't exist in-container) and `sandbox: "none"` (explicit opt-out). So this is **medium, not high** — but the plan should document that OpenCode's `sandbox: "none"` permissions could be weakened by a user's global config.

### Low

- **`BareRunner` with `--dangerously-skip-permissions` is the most permissive path.** `sandbox: "none"` bypasses both OS sandbox and agent permissions. The research positions this as "for pre-isolated VMs" but there's no validation that the environment is actually isolated. A documentation-only concern — the plan should make the `sandbox: "none"` warning message very clear about what the user is opting into.
- **No discussion of concurrent step execution.** The runner pool assumes sequential steps. If cook ever adds parallel step execution, the pool's `get()` method would need to handle concurrent access and potentially multiple Docker containers. Not a current concern but worth a one-line note in the plan.
- **Codex `writable_roots` is empty in the `cook init` config.** The research shows `writable_roots = []` in the Codex config, which means Codex defaults to the current working directory. This is probably correct for cook's use case but should be explicitly called out as intentional.

## Questions

- The research specifies `Bash(npm test *)` in the zero-config defaults but `Bash(npm *)` in the `cook init` defaults. Is the intent that zero-config only allows test/typecheck commands while `cook init` allows all npm subcommands? If so, this is a good distinction — just confirming it's deliberate.
- For `CLAUDE_CONFIG_DIR` temp directories: the research says they're created "on first Claude `runAgent()` call" in NativeRunner. Does this mean non-Claude agents in NativeRunner don't create temp dirs? Codex uses CLI flags (no temp dir needed), OpenCode is blocked from agent mode — so the temp dir is Claude-specific, not a NativeRunner concern. The plan should clarify whether NativeRunner has per-agent setup logic or if there are separate runner classes per agent.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see gaps/questions above)

The research is comprehensive and all critical decisions are made. The remaining medium gap (OpenCode config merging in `sandbox: "none"`) is a documentation concern, not a design flaw. The questions above are implementation details suitable for the plan phase. Ready to proceed.
