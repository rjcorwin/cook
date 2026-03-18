

- [ ] Parser: emit error when `vN`/`race N` follows `compare` (currently silently ignored) — Low from r7w review
- [ ] Tighten `parseGateVerdict` keyword matching — `startsWith('APPROVE')` etc. can match prose; Low item from r7w review, independently surfaced by gate agent during testing
- [ ] Design session log bundling for repeat/ralph — `xN` repeat creates one log file per pass and ralph creates one per task, making it unclear which logs belong to a single execution. Design a solution that makes a bundle of logs obviously groupable (e.g. a session directory, a manifest file, or threading a shared log path through repeat/ralph contexts).
- [ ] Logs for each cook session. When session starts, show the `tail -f` command they could run for user to follow.
- [ ] verbose mode
- [ ] `COOK.<command>.md` templates for custom sub-commands (ie. research, plan, implement. `cook research ./plans/001-foo-plan/`, where that dir gets sent in as the standard input and template builds around the idea that the plan id or path would be placed in. Could be `COOK-command.work.md`/`COOK-command.review.md`/`COOK-command.gate.md`
- [ ] Configurable gate keyword? (ie. `COOK.gate-keyword.md`)
- [ ] unique sandbox ids so we can run multiple at once
- [ ] option to run parallel instances, for review after.
