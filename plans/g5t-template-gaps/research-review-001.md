# Research Review: COOK.md Template Gaps

**Reviewer:** AI
**Date:** 2026-03-20
**Reviewing:** research.md

## Summary

The research is thorough and well-grounded in actual test results (31/32 tests from REPORT.md). The gap inventory is complete and correctly prioritized. The key insight about composition prompts needing a different mechanism than the main loop is sound.

## Strengths

- Gaps are derived from actual testing, not speculation
- Severity ratings are reasonable (composition bypass and hidden defaults are Medium; context vars are Low)
- The prior art section correctly identifies that composition prompts have a structurally different shape than loop prompts
- Open questions are the right ones to resolve before planning

## Gaps

### High

- None

### Medium

- The research doesn't explore the **user experience** of editing a COOK.md with many sections. How long would the default COOK.md be if it included judge/merge/compare templates plus default review/gate prompts? A 100-line default template could intimidate users.
- No analysis of how `renderTemplate` would need to change to support section-based rendering (if that's the chosen approach). The current `new Function()` approach renders the entire file as one template — sectioning would need a pre-processing step.

### Low

- Missing: what do users of other cook-like tools (Aider, Continue, Cursor rules) expect from template customization? This could inform which gaps are worth filling.

## Questions

- For Gap 6 (hidden defaults): should the generated COOK.md show the defaults as **active content** (rendered by the template) or as **comments** (documentation only, with the actual defaults still in TypeScript)?
- Is there a risk that adding too many template variables (Gap 2, 4, 5) clutters the `LoopContext` interface for the majority of users who won't use them?

## Recommendation

[x] Ready for human review
[ ] Needs revision (see gaps/questions above)
