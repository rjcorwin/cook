package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"
)

type Config struct {
	WorkPrompt    string
	ReviewPrompt  string
	GatePrompt    string
	MaxIterations int
	Model         string
	ProjectRoot   string
}

func agentLoop(sandbox *Sandbox, config Config, cookMD string) error {
	tmpl, err := template.New("cook").Parse(cookMD)
	if err != nil {
		return fmt.Errorf("parsing COOK.md: %w", err)
	}

	logFile, err := createSessionLog(config.ProjectRoot)
	if err != nil {
		return err
	}
	logOK("Session log: %s", logFile)
	logStep("Follow along: tail -f %s", logFile)

	lastMessage := ""

	for i := 1; i <= config.MaxIterations; i++ {
		steps := []struct {
			name   string
			prompt string
		}{
			{"work", config.WorkPrompt},
			{"review", config.ReviewPrompt},
			{"gate", config.GatePrompt},
		}

		for _, step := range steps {
			logPhase("Iteration %d/%d — %s", i, config.MaxIterations, step.name)

			prompt, err := executeTemplate(tmpl, LoopContext{
				Step:          step.name,
				Prompt:        step.prompt,
				LastMessage:   lastMessage,
				Iteration:     i,
				MaxIterations: config.MaxIterations,
				LogFile:       logFile,
			})
			if err != nil {
				return err
			}

			output, err := sandbox.runClaude(config.Model, prompt)
			if err != nil {
				return fmt.Errorf("%s step failed (iteration %d): %w", step.name, i, err)
			}

			lastMessage = output
			if err := appendToLog(logFile, step.name, i, output); err != nil {
				logWarn("Failed to write session log: %v", err)
			}
		}

		// Check gate verdict
		verdict := parseGateVerdict(lastMessage)
		if verdict == "DONE" {
			logOK("Gate: DONE — loop complete")
			return nil
		}
		if i < config.MaxIterations {
			logWarn("Gate: ITERATE — continuing to iteration %d", i+1)
		} else {
			logWarn("Gate: max iterations (%d) reached — stopping", config.MaxIterations)
		}
	}
	return nil
}

func executeTemplate(tmpl *template.Template, ctx LoopContext) (string, error) {
	var buf strings.Builder
	if err := tmpl.Execute(&buf, ctx); err != nil {
		return "", fmt.Errorf("rendering COOK.md: %w", err)
	}
	return buf.String(), nil
}

// createSessionLog returns a host filesystem path that is also valid inside
// the container because the project root is bind-mounted at the same path.
func createSessionLog(projectRoot string) (string, error) {
	logDir := filepath.Join(projectRoot, ".cook", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return "", fmt.Errorf("creating log directory: %w", err)
	}
	timestamp := time.Now().Format("2006-01-02-150405")
	logPath := filepath.Join(logDir, timestamp+".md")
	f, err := os.Create(logPath)
	if err != nil {
		return "", fmt.Errorf("creating log file: %w", err)
	}
	f.Close()
	return logPath, nil
}

func appendToLog(logFile, step string, iteration int, output string) error {
	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "## [%s %d] %s\n\n%s\n\n---\n\n",
		step, iteration, time.Now().Format("2006-01-02 15:04:05"), output)
	return err
}

var doneKeywords = []string{"DONE", "PASS", "COMPLETE", "APPROVE", "ACCEPT"}
var iterateKeywords = []string{"ITERATE", "REVISE", "RETRY"}

func parseGateVerdict(output string) string {
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		upper := strings.ToUpper(line)
		for _, kw := range doneKeywords {
			if strings.HasPrefix(upper, kw) {
				return "DONE"
			}
		}
		for _, kw := range iterateKeywords {
			if strings.HasPrefix(upper, kw) {
				return "ITERATE"
			}
		}
	}
	return "ITERATE" // default to iterate if ambiguous
}
