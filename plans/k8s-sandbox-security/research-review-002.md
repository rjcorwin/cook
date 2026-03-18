# Research Review: Sandbox Security When Cook Runs as a Subagent Skill (Round 2)

**Reviewer:** AI
**Date:** 2026-03-18
**Reviewing:** research.md (updated after research-review-001.md)

## Summary

The research presents a clear, well-reasoned case for removing `--sandbox none` from cook. The core argument is strong: `--sandbox agent` is proven to work for real coding tasks, `--sandbox none` is a privilege escalation vector, and config/prompt-based enforcement is unreliable. The first review raised three High gaps. This second review evaluates whether those gaps are blocking given the nature of the change -- we are removing a dangerous capability, not adding a new one.

## Strengths

- The security argument is airtight: `--sandbox none` enables privilege escalation, and the only reliable fix is removing the code path entirely
- Testing results are concrete and demonstrate that `--sandbox agent` handles real coding tasks (file creation, Bash commands, OS sandbox enforcement, full coding workflow)
- Attack vector analysis is honest and well-scoped, including the important acknowledgment that Attack 4 (direct `claude --dangerously-skip-permissions`) is out of scope
- The "what replaces `--sandbox none`" section directly answers the migration question with two clear alternatives
- Code impact section is specific and actionable

## Gaps from Review 001: Reassessment

### High Gaps (from review 001)

1. **Linux sandbox behavior is untested.** Still not explicitly tested in the research. However, this gap is not blocking for the following reason: removing `--sandbox none` makes Linux *strictly safer* regardless of how the Linux sandbox behaves. If `--sandbox agent` has issues on Linux, users will discover them and can use `--sandbox docker` as a fallback. The current state (`--sandbox none` available) is worse on Linux because it enables a known privilege escalation. You do not need to prove the replacement is perfect to justify removing a dangerous option.

2. **No testing of pipe mode failure modes.** Still not explicitly documented. Again, not blocking: if the child agent hits a permission prompt it cannot satisfy in pipe mode, the worst case is the task fails. That is categorically better than the current state where `--sandbox none` silently skips all prompts. A failure mode of "task doesn't complete" is safer than a failure mode of "task completes with no permission checks." Edge cases here are worth documenting in the plan phase but do not block the decision to remove `--sandbox none`.

3. **Already-isolated environments claim is unsubstantiated.** The research asserts that `--sandbox agent` works fine inside containers/VMs. This is not tested, but the reasoning is sound: the OS sandbox is additive. If it causes conflicts in already-isolated environments, `--sandbox docker` remains available. And again, the alternative (keeping `--sandbox none`) is strictly worse from a security perspective.

**Verdict on High gaps:** None of the three are blocking. The key insight the first review missed is that this is a *removal* of a dangerous feature, not an *addition* of a new one. The bar for "should we remove a known privilege escalation vector" is much lower than "should we add a new capability." The replacement does not need to be proven perfect in every environment -- it just needs to be safer than what it replaces, which it trivially is.

### Medium Gaps (from review 001)

- **Supply chain attacks via recipes:** Valid concern, but orthogonal to the sandbox mode decision. A malicious recipe can cause harm in `--sandbox agent` mode too, but less harm than in `--sandbox none` mode. This is a separate research topic.
- **Docker mode assumptions:** Fair point that Docker mode safety depends on container configuration. Worth a sentence in the plan but not blocking for this research.
- **Backwards compatibility / migration:** The research now implicitly addresses this: two modes remain (`agent` and `docker`), and `--sandbox none` users should switch to one of them. An explicit error message when `--sandbox none` is attempted would be good to include in the plan.
- **`acceptEdits` permission mode details:** The testing results empirically demonstrate what it covers (file creation, Bash commands). Formal documentation would be nice but the testing evidence is sufficient for this decision.

### Low Gaps (from review 001)

- Performance comparison, upstream documentation references, testing sample size, bare-runner.ts dependencies -- all reasonable suggestions for the plan phase. None affect the research conclusion.

## New Observations

- The research is well-structured as a decision document, not just an exploration. The "Decision" field at the top and the "Analysis" section make the conclusion unambiguous.
- The code impact section correctly identifies that all integration tests use `--sandbox none` and will need updating. This is the main implementation risk and it is called out.
- The testing section (four scenarios with specific results) provides enough evidence that `--sandbox agent` is functional. It does not need to be exhaustive -- it needs to demonstrate viability, which it does.

## Questions

- Should cook emit a clear error message (not just a usage error) if a user passes `--sandbox none`, explaining the removal and suggesting alternatives? This is a plan-phase question but worth raising.
- The test migration (all tests currently use `--sandbox none`) is the highest-risk part of the implementation. The plan should address this explicitly, especially tests that write to `/tmp`.

## Recommendation

[x] Ready for human review
[ ] Needs revision (see gaps/questions above)

The research makes a sound security argument supported by concrete testing. The decision to remove `--sandbox none` is justified: it is a known privilege escalation vector, the replacement (`--sandbox agent`) is proven functional, and config/prompt-based alternatives are demonstrated to be unreliable. The gaps identified in review 001 are real but not blocking -- they describe areas where the replacement could be more thoroughly validated, not reasons to keep a dangerous feature. Remaining questions (Linux edge cases, pipe mode failure modes, migration UX) are appropriate to address in the plan phase.
