We're working in a work->review->gate loop.

## Agent Loop

Step: **{{.Step}}** | Iteration: {{.Iteration}}/{{.MaxIterations}}

### Task
{{.Prompt}}

{{if .LastMessage}}
### Previous Output
{{.LastMessage}}
{{end}}

### History
Session log: {{.LogFile}}
Read the session log for full context from previous steps.
