# Plan Review: Native Agent Sandbox as Default (Review 3)

**Reviewer:** AI
**Date:** 2026-03-06
**Reviewing:** plan.md (post-human-review revision)

## Summary

The plan has been revised to address all 3 items flagged in the human review. All changes are additive notes — no architectural modifications. The plan is comprehensive, well-structured, and ready for implementation.

## Strengths

- **All human review items resolved.** Each concern was addressed inline where it matters most to an implementer, not buried in an appendix.
- **Known limitation on project-level Claude settings** (Section 2, line 131) is clearly scoped — explains *what* happens (array concatenation), *why* it's acceptable (project-level settings are developer-trusted), and *what cook still controls* (the allowlist).
- **OpenCode config note** (Section 6, line 242) is honest about the file's purpose — generated for documentation/future use, not consumed by any runner today.
- **Process lifecycle** (Section 2, lines 138-140) is specific: stored `ChildProcess` references, `process.on('exit')` handler, explicit rationale about orphaned process regression vs Docker mode.
- **`smol-toml` dependency** (Section 2, line 142) is a clean choice — zero-dependency, spec-compliant, avoids fragile regex.
- **Phased implementation** remains the strongest aspect of this plan — each phase produces a working state, with Docker-only behavior preserved through Phase 1 before any new runners exist.

## Concerns

### High

None.

### Medium

None. The two Medium items from review 002 (TOML parsing, process lifecycle) are now fully specified in the plan text.

### Low

- **`LoopConfig` type changes still not shown.** Section 10 references `config.defaultSandbox` and `config.steps[step.name].sandbox` but the `LoopConfig` interface isn't defined. Inferrable from context and `CookConfig`/`StepAgentConfig` types in Section 5, so this is a minor gap an implementer can fill.

- **`DockerConfig.network.mode` silent type change.** Current codebase uses `'restricted' | 'unrestricted'`; the plan uses `'restricted' | 'bridge' | 'none'`. Not called out as a migration note. With a single user this is fine.

- **Credentials error path.** If `~/.claude/.credentials.json` doesn't exist, NativeRunner's copy fails at runtime with an unhelpful error. `cook doctor` checks auth, but users who skip it get a raw file-not-found. A descriptive error would be better. Implementation detail — doesn't need to be in the plan.

## Suggestions

None new. All prior suggestions have been incorporated.

## Recommendation

[x] Ready for human review
[ ] Needs revision

The plan is complete. Three Low items remain — all are implementation-level details that don't affect the design. The plan faithfully implements all 14 research decisions, addresses all concerns from reviews 001 and 002, and incorporates the human reviewer's 3 flagged items. Ready for gate.
