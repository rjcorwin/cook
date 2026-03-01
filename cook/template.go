package main

import (
	"os"
	"path/filepath"
)

type LoopContext struct {
	Step          string // "work", "review", "gate"
	Prompt        string // the step-specific prompt
	LastMessage   string // output from previous claude run ("" on first call)
	Iteration     int
	MaxIterations int
	LogFile       string // path to session log file
}

const defaultCookMD = `# COOK.md

## Project Instructions

[Edit this section with your project's conventions, coding standards, etc.]

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
`

func loadCookMD(projectRoot string) string {
	data, err := os.ReadFile(filepath.Join(projectRoot, "COOK.md"))
	if err != nil {
		return defaultCookMD
	}
	return string(data)
}

