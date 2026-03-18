# Test Results

Run: 2026-03-18 22:51
Cook: local build at `dist/cli.js` (post --sandbox none removal)
Agent: claude:opus (default)
Sandbox: agent (default — --sandbox none has been removed)

## Summary

| Test | Result |
|------|--------|
| 1. Work | PASS |
| 2a. repeat (x3) | PASS |
| 2b. repeat 3 (long-form) | PASS |
| 2c. review (default) | PASS |
| 2d. review (custom prompts) | PASS |
| 2e. review --max-iterations 5 | PASS |
| 2f. review 5 (positional) | PASS |
| 2g. x3 review | PASS |
| 2h. review x3 | PASS |
| 3a. Ralph basic | PASS |
| 3b. Ralph + review | PASS |
| 4a. vN + pick | PASS |
| 4b. v3 implicit pick | PASS |
| 4c. race 2 (long-form) | PASS |
| 4d. review + versions | PASS |
| 4e. vs + pick | PASS |
| 4f. vs + merge | PASS |
| 4g. vs + compare | PASS |
| 4h. vs + per-branch x3 | PASS |
| 4i. second-level composition | FAIL (known Bug 4) |
| 5a. --work-agent/--review-agent | PASS |
| 5b. --hide-request | PASS |
| 5c. --work/--review/--gate | PASS |
| 6a. Doctor (basic) | PASS |
| 6b. Doctor (overrides) | PASS |

**24/25 PASS, 1 FAIL (known bug)**

## Key finding

All tests pass with `--sandbox agent` (the new default). The removal of `--sandbox none` does not break any functionality. The OS-level sandbox correctly confines child processes while still allowing file edits and Bash commands within the project directory.

## Bugs

No new bugs found. The only failure is Bug 4 (second-level composition outer merge fails silently), which is a pre-existing known issue unrelated to the sandbox change.
