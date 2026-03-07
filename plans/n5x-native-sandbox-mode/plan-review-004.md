# Plan Review: Native Agent Sandbox as Default (Review 4)

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** plan.md (final review, iteration 5/5)

## Summary

The plan is mature and implementation-ready. It has been through 4 work iterations, 3 AI reviews, and 1 human review — all issues have been resolved. The architecture is clean (AgentRunner interface with three implementations), the phasing is sound (each step produces a working state), and all 14 research decisions are faithfully represented. No new concerns have emerged.

## Strengths

- **Complete research-to-plan traceability.** Every research decision (1–14) maps to a concrete section in the plan. No decisions were dropped or silently reinterpreted.
- **Phased implementation is excellent.** Phase 1 changes zero behavior (interface extraction only), giving a safe foundation. Each subsequent phase adds one capability. An implementer can stop after any phase and have a working system.
- **Security model is well-reasoned.** Claude isolation via `CLAUDE_CONFIG_DIR` addresses the real threat (array concatenation of permission allows). Codex isolation via CLI flag overrides is correctly identified as sufficient (scalar values, not arrays). OpenCode rejection from agent mode prevents a false sense of security.
- **Known limitations are documented.** Project-level Claude settings merge (line 131), OpenCode config file not consumed (line 242), and process lifecycle requirements (lines 138–142) are all explicitly noted.
- **All prior review items resolved.** The stream-of-consciousness removal (review 1), Docker config separation (review 1), config resolution chain (review 1), TOML parsing dependency (reviews 2/3), process lifecycle (reviews 2/3), and human review items (review 3) are all addressed in the current plan text.

## Concerns

### High

None.

### Medium

None.

### Low

- **`LoopConfig` type updates not shown.** Section 10 references `config.defaultSandbox` and `config.steps[step.name].sandbox` but the `LoopConfig` interface (currently in `src/loop.ts:12`) isn't updated in the plan. Trivially inferrable from `CookConfig` and `StepAgentConfig` in Section 5. Carried forward from review 3 — implementation detail.

- **`DockerConfig.network.mode` type widening.** Current codebase has `'restricted' | 'unrestricted'`; plan introduces `'restricted' | 'bridge' | 'none'`. No migration note, but with a single user this is acceptable. Carried forward from review 3.

- **Credentials error path.** If `~/.claude/.credentials.json` is missing, NativeRunner fails with a raw file error. `cook doctor` catches this, but users who skip doctor get an unhelpful message. Implementation detail — a descriptive error wrapping is straightforward to add during Phase 3. Carried forward from review 3.

## Suggestions

None new. All actionable suggestions from prior reviews have been incorporated.

## Recommendation

[x] Ready for human review
[ ] Needs revision

The plan is finalized. Three Low items carry forward from review 3 — all are implementation-level details that don't affect the design or architecture. The plan is ready for human approval and subsequent implementation.
