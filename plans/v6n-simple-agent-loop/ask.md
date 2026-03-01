# Ask: simple-agent-loop

## Request
Replace cook's structured RPI commands with an unopinionated agent loop primitive: "in a sandbox, do X in work→review→gate loop Y number of times."

COOK.md becomes the prompt template. Each iteration, cook renders COOK.md with variables (step, prompt, last message, iteration number) and passes the result as claude's entire prompt. After each claude run, cook commits all changes with claude's last message as the commit message. Git history replaces review files as the audit trail.

cook is an template based ralph-loop with built in sanbox

## Usage

```
cook init
vim COOK.md

cook "implement the foo feature"           # defaults to 3 iterations
cook "write research.md for 001-foo" 5     # 5 iterations
cook --work "implement 001-foo" --review "code review" --gate "all criticals resolved" --max-iterations 10
```

## What gets removed

Existing RPI commands (research, plan, implement, yolo, new) are removed. They'll return later as a yet-to-be-determined system for defining reusable prompt templates for work/review/gate.

## Date
2026-03-01
