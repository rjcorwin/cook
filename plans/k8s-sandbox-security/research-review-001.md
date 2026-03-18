# Research Review: Sandbox Security When Cook Runs as a Subagent Skill

**Reviewer:** AI
**Date:** 2026-03-18
**Reviewing:** research.md

## Summary

The research makes a clear and well-structured argument for removing `--sandbox none` from cook. The core logic is sound: `--sandbox agent` is proven to work, `--sandbox none` is a privilege escalation vector, and config/prompt-based enforcement is unreliable. However, there are several gaps in the security analysis, testing coverage, and migration planning that should be addressed before moving to the plan phase.

## Strengths

- Clear separation of the two independent security layers (OS sandbox vs. permission prompting) — this is the conceptual foundation and it is explained well
- Concrete testing results that demonstrate `--sandbox agent` viability for real coding tasks
- Honest acknowledgment that config-based locks and prompt-based enforcement are security theater (Attacks 1 and 2)
- Attack 4 correctly scopes responsibility — cook should not try to solve problems that belong to the parent agent's permission system
- Code impact section is specific and actionable, listing every file that needs modification
- The "what replaces `--sandbox none`" section preemptively addresses the obvious follow-up question

## Gaps

### High

- **Linux sandbox behavior is untested.** All testing results appear to be macOS-only (Seatbelt). The research mentions "Landlock/bubblewrap on Linux" but provides zero test results for Linux. Claude Code's Linux sandbox implementation may behave differently — Landlock requires kernel 5.13+ and has different granularity than Seatbelt. Bubblewrap has its own edge cases. Since cook is likely used in CI/CD environments (which are overwhelmingly Linux), this is a critical gap. The claim that `--sandbox agent` works is only proven for one of two supported platforms.

- **No testing of pipe mode failure modes.** The research confirms pipe mode works for happy-path scenarios but does not explore what happens when the child agent encounters situations that would normally trigger a permission prompt that `acceptEdits` does not cover. For example: network access, reading files outside the project directory, executing commands that modify system state. Does the child agent silently fail? Does it error? Does it hang waiting for input on a pipe that will never deliver it? These failure modes matter for understanding whether `--sandbox agent` is truly sufficient.

- **The claim that `--sandbox agent` works for "users who previously needed `--sandbox none` because they're in an already-isolated environment" is unsubstantiated.** The research asserts this without testing it. Running `--sandbox agent` inside a Docker container or VM could cause conflicts if the OS sandbox tries to apply restrictions that conflict with the container's own security model (e.g., Seatbelt inside Docker on macOS, or nested Landlock policies). This specific scenario needs validation.

### Medium

- **Attack vector analysis is incomplete.** The research does not consider:
  - **Supply chain attacks via cook recipes/instructions:** If a malicious recipe is provided to cook, can it manipulate the child agent into performing harmful actions within the `acceptEdits` permission scope? The OS sandbox limits filesystem access, but within the project directory the child has full write access. A malicious recipe could overwrite `.env` files, inject code into existing source files, modify `package.json` scripts to run arbitrary code on next `npm install`, etc.
  - **Symlink attacks:** Can the child agent create or follow symlinks that point outside the sandboxed directory? Seatbelt and Landlock may handle symlinks differently.
  - **Race conditions:** Between sandbox policy application and first child action, is there a TOCTOU window?

- **Docker mode analysis is shallow.** The research says Docker mode uses `--dangerously-skip-permissions` but "it's safe because the container is the security boundary." This deserves more scrutiny. What about Docker socket access? Volume mounts? Network access from within the container? If the Docker container is configured with `--privileged` or has the Docker socket mounted, `--dangerously-skip-permissions` inside it is not safe at all. The research should at least acknowledge that Docker mode's safety depends on how the container is configured.

- **No discussion of backwards compatibility or migration path.** Users currently relying on `--sandbox none` will have their workflows break. The research should address: How many users are affected? Is there a deprecation period? Should there be a clear error message when `--sandbox none` is attempted? Should there be a migration guide?

- **`acceptEdits` permission mode is not fully explained.** The research mentions this mode but does not detail exactly what permissions it grants. Does it auto-accept all file edits everywhere within the sandbox, or only in the working directory? Does it cover file deletion? Does it cover creating new directories? A precise understanding of what `acceptEdits` allows is essential to evaluating whether it is sufficient.

### Low

- **No performance comparison between sandbox modes.** Does `--sandbox agent` add latency compared to `--sandbox none`? For batch/CI usage, this could matter.
- **The research does not reference Claude Code's own documentation on sandbox modes.** Citing the upstream documentation would strengthen the claims about how Seatbelt/Landlock enforcement works and whether it is truly inescapable.
- **Testing sample size is small.** Four test scenarios is a limited basis for concluding that `--sandbox agent` is "fully viable." More diverse test cases (multi-file projects, npm/yarn operations, git operations, reading/writing dotfiles) would strengthen confidence.
- **The bare-runner.ts file is mentioned as "delete entirely" but the research does not examine whether any other code imports from or depends on it.** This is more of a planning concern but worth flagging.

## Questions

- What is the behavior when a child agent in `--sandbox agent` mode attempts an action that requires a permission prompt beyond `acceptEdits`? Does it fail silently, error out, or block?
- Has `--sandbox agent` been tested on Linux at all? If not, can we test it before committing to removing the only alternative that is known to work on Linux?
- Are there any cook users currently relying on `--sandbox none` in production? If so, what is their use case and can `--sandbox agent` actually serve it?
- Does `acceptEdits` cover Bash command execution, or is Bash separately permitted? The testing shows Bash works, but the permission model description is ambiguous about why.
- What happens if Claude Code changes the behavior of `--sandbox agent` or `acceptEdits` in a future release? Is cook coupled to specific Claude Code version semantics?

## Recommendation

[ ] Ready for human review
[x] Needs revision (see gaps/questions above)

The core thesis is sound and the direction is correct, but the three High gaps need to be addressed before this research can reliably inform a plan. Specifically: (1) Linux testing must be performed, (2) pipe mode failure modes must be documented, and (3) the claim about already-isolated environments must be validated. The Medium gaps around supply chain attacks, Docker mode assumptions, and migration planning should also be addressed, though they could potentially be deferred to the planning phase.
