

- [ ] Parser: emit error when `vN`/`race N` follows `compare` (currently silently ignored) — Low from r7w review
- [ ] Tighten `parseGateVerdict` keyword matching — `startsWith('APPROVE')` etc. can match prose; Low item from r7w review, independently surfaced by gate agent during testing
- [ ] Logs for each cook session. When session starts, show the `tail -f` command they could run for user to follow.
- [ ] verbose mode
- [ ] `COOK.<command>.md` templates for custom sub-commands (ie. research, plan, implement. `cook research ./plans/001-foo-plan/`, where that dir gets sent in as the standard input and template builds around the idea that the plan id or path would be placed in. Could be `COOK-command.work.md`/`COOK-command.review.md`/`COOK-command.gate.md`
- [ ] Configurable gate keyword? (ie. `COOK.gate-keyword.md`)
- [ ] unique sandbox ids so we can run multiple at once
- [ ] option to run parallel instances, for review after.
