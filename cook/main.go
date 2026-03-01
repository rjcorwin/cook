package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Colors
const (
	red    = "\033[0;31m"
	green  = "\033[0;32m"
	yellow = "\033[1;33m"
	blue   = "\033[0;34m"
	cyan   = "\033[0;36m"
	bold   = "\033[1m"
	nc     = "\033[0m"
)

func logPhase(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "\n%s%s══════════════════════════════════════%s\n", bold, blue, nc)
	fmt.Fprintf(os.Stderr, "%s%s  %s%s\n", bold, blue, msg, nc)
	fmt.Fprintf(os.Stderr, "%s%s══════════════════════════════════════%s\n\n", bold, blue, nc)
}

func logStep(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s▸ %s%s\n", cyan, fmt.Sprintf(format, args...), nc)
}

func logOK(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s✓ %s%s\n", green, fmt.Sprintf(format, args...), nc)
}

func logWarn(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s⚠ %s%s\n", yellow, fmt.Sprintf(format, args...), nc)
}

func logErr(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s✗ %s%s\n", red, fmt.Sprintf(format, args...), nc)
}

const defaultReviewPrompt = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const defaultGatePrompt = `Based on the review, respond with exactly PROCEED or ITERATE
on its own line, followed by a brief reason.

PROCEED if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`

const defaultCookConfigJSON = `{
  "network": {
    "mode": "default",
    "allowedHosts": []
  },
  "env": []
}
`

const defaultCookDockerfile = `FROM cook-sandbox
# Add project-specific dependencies below.
# Examples:
#   RUN apt-get update && apt-get install -y python3 python3-pip
#   RUN npm install -g typescript
`

func usage() {
	fmt.Fprintf(os.Stderr, `%scook%s — sandboxed agent loop

%sUsage:%s
  cook "prompt"                   Run the work→review→gate loop
  cook "prompt" 5                 Run with 5 max iterations
  cook init                       Set up COOK.md, config, and Dockerfile
  cook rebuild                    Rebuild the sandbox Docker image

%sOptions:%s
  --work PROMPT                   Override work step prompt
  --review PROMPT                 Override review step prompt
  --gate PROMPT                   Override gate step prompt
  --max-iterations N              Max review iterations (default: 3)
  --model MODEL                   Claude model (default: opus)
  -h, --help                      Show this help
`, bold, nc, bold, nc, bold, nc)
	os.Exit(0)
}

func main() {
	// Find project root
	projectRoot, err := findProjectRoot()
	if err != nil {
		logErr("Not in a git repository: %v", err)
		os.Exit(1)
	}

	// Flags
	work := flag.String("work", "", "Work step prompt")
	review := flag.String("review", defaultReviewPrompt, "Review step prompt")
	gate := flag.String("gate", defaultGatePrompt, "Gate step prompt")
	maxIter := flag.Int("max-iterations", 3, "Maximum iterations")
	model := flag.String("model", "opus", "Claude model")
	help := flag.Bool("h", false, "Show help")
	flag.BoolVar(help, "help", false, "Show help")
	flag.Parse()

	if *help {
		usage()
	}

	args := flag.Args()
	if len(args) == 0 {
		usage()
	}

	switch args[0] {
	case "init":
		cmdInit(projectRoot)
	case "rebuild":
		cmdRebuild()
	case "help":
		usage()
	default:
		// First arg is the work prompt
		if *work == "" {
			*work = args[0]
		}
		// Second arg is iteration count if numeric
		if len(args) > 1 {
			if n, err := strconv.Atoi(args[1]); err == nil {
				*maxIter = n
			}
		}

		cfg := loadConfig(projectRoot)
		cookMD := loadCookMD(projectRoot)

		fmt.Fprintf(os.Stderr, "%scook%s — agent loop\n", bold, nc)
		fmt.Fprintf(os.Stderr, "  Model:      %s\n", *model)
		fmt.Fprintf(os.Stderr, "  Iterations: %d\n", *maxIter)
		fmt.Fprintf(os.Stderr, "  Project:    %s\n\n", projectRoot)

		sandbox, err := startSandbox(projectRoot, cfg)
		if err != nil {
			logErr("Sandbox failed: %v", err)
			os.Exit(1)
		}
		defer sandbox.stopSandbox()

		if err := agentLoop(sandbox, Config{
			WorkPrompt:    *work,
			ReviewPrompt:  *review,
			GatePrompt:    *gate,
			MaxIterations: *maxIter,
			Model:         *model,
			ProjectRoot:   projectRoot,
		}, cookMD); err != nil {
			logErr("Agent loop failed: %v", err)
			os.Exit(1)
		}
	}
}

func cmdInit(projectRoot string) {
	logPhase("Initialize project for cook")

	// COOK.md
	cookPath := filepath.Join(projectRoot, "COOK.md")
	if _, err := os.Stat(cookPath); err != nil {
		os.WriteFile(cookPath, []byte(defaultCookMD), 0644)
		logOK("COOK.md created")
	} else {
		logOK("COOK.md already exists")
	}

	// .cook.config.json
	configPath := filepath.Join(projectRoot, ".cook.config.json")
	if _, err := os.Stat(configPath); err != nil {
		os.WriteFile(configPath, []byte(defaultCookConfigJSON), 0644)
		logOK(".cook.config.json created")
	} else {
		logOK(".cook.config.json already exists")
	}

	// .cook.Dockerfile
	dockerPath := filepath.Join(projectRoot, ".cook.Dockerfile")
	if _, err := os.Stat(dockerPath); err != nil {
		os.WriteFile(dockerPath, []byte(defaultCookDockerfile), 0644)
		logOK(".cook.Dockerfile created")
	} else {
		logOK(".cook.Dockerfile already exists")
	}

	// .cook/logs/ directory
	logsDir := filepath.Join(projectRoot, ".cook", "logs")
	os.MkdirAll(logsDir, 0755)

	fmt.Fprintf(os.Stderr, "\n%s✓ Project initialized for cook%s\n", green, nc)
	fmt.Fprintf(os.Stderr, "  Edit %sCOOK.md%s to customize the agent loop prompts\n", cyan, nc)
	fmt.Fprintf(os.Stderr, "  Edit %s.cook.config.json%s to configure network restrictions and env vars\n", cyan, nc)
	fmt.Fprintf(os.Stderr, "  Edit %s.cook.Dockerfile%s to add project-specific dependencies\n", cyan, nc)
}

func cmdRebuild() {
	logPhase("Rebuild sandbox image")
	if err := rebuildBaseImage(); err != nil {
		logErr("Rebuild failed: %v", err)
		os.Exit(1)
	}
}

func findProjectRoot() (string, error) {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
