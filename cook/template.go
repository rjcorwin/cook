package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
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

func renderTemplate(cookMD string, ctx LoopContext) (string, error) {
	tmpl, err := template.New("cook").Parse(cookMD)
	if err != nil {
		return "", fmt.Errorf("parsing COOK.md: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, ctx); err != nil {
		return "", fmt.Errorf("rendering COOK.md: %w", err)
	}
	return buf.String(), nil
}
