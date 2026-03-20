

- [ ] Parser: emit error when `vN`/`race N` follows `compare` (currently silently ignored) — Low from r7w review
- [ ] Tighten `parseGateVerdict` keyword matching — `startsWith('APPROVE')` etc. can match prose; Low item from r7w review, independently surfaced by gate agent during testing
- [ ] Design session log bundling for repeat/ralph — `xN` repeat creates one log file per pass and ralph creates one per task, making it unclear which logs belong to a single execution. Design a solution that makes a bundle of logs obviously groupable (e.g. a session directory, a manifest file, or threading a shared log path through repeat/ralph contexts).
- [ ] Logs for each cook session. When session starts, show the `tail -f` command they could run for user to follow.
- [ ] verbose mode
- [ ] `COOK.<command>.md` templates for custom sub-commands (ie. research, plan, implement. `cook research ./plans/001-foo-plan/`, where that dir gets sent in as the standard input and template builds around the idea that the plan id or path would be placed in. Could be `COOK-command.work.md`/`COOK-command.review.md`/`COOK-command.gate.md`
- [ ] Configurable gate keyword? (ie. `COOK.gate-keyword.md`)
- [ ] unique sandbox ids so we can run multiple at once
- [ ] option to run parallel instances, for review after.

## From h5p-test-harness run (2026-03-17)

- [ ] Composition integration tests — `executeComposition` with real temp git repo and poolFactory injection; branches and per-worktree pools already parameterized, needs temp repo setup and coordinated TestRunner response sequences
- [ ] Resolver integration tests (`resolvePick`, `resolveMerge`, `resolveCompare`) — auto-pick path testable now; non-auto paths need stdin mock for `confirm()`/`pickOne()`
- [ ] UI tests — `App.tsx`, `RaceApp.tsx`, `LogStream.tsx` via `@inkjs/testing`; deferred as low-value for v1
- [ ] Refactor `loopEvents` singleton to injected EventEmitter in executor paths — would remove the need for sequential executor tests and allow full parallel test execution
- [ ] `parseRalphVerdict('APPROVE')` returns DONE via fail-safe (not keyword match) — APPROVE is not in RALPH_DONE_KEYWORDS; consider whether this is intentional or an oversight
