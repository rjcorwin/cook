# Plan: Simple Agent Loop

**Status:** Draft
**Author:** AI
**Created:** 2026-03-01

## Summary

Rewrite cook from a ~1215-line bash script to a Go program that runs a generic work→review→gate agent loop. COOK.md is a Go `text/template` that users fully control. Each session writes to a log file in `.cook/logs/`. The structured RPI commands are removed.

## Motivation

The bash cook script has ~450 lines of hardcoded RPI workflow logic and a ~400-line default COOK.md template. By rewriting in Go with `text/template`, COOK.md becomes a real template — users see and edit exactly what claude receives. The RPI workflow can return later as a reusable COOK.md template, not hardcoded commands.

## Goals

- Rewrite cook as a Go binary
- Use Go `text/template` for COOK.md rendering
- Implement the work→review→gate loop as the single command
- Log all claude output to a per-session log file
- Keep: Docker sandbox, `init`, `rebuild`
- Remove: `new`, `research`, `plan`, `implement`, `yolo`

## Non-Goals

- Reusable prompt template library system (future work)
- Changes to Docker SDK beyond what's needed for the sandbox
- Automatic git commits
- Changes to the sandbox security model

## Technical Design

### Project Structure

```
cook/
├── main.go          — entry point, arg parsing, dispatch
├── sandbox.go       — Docker container lifecycle
├── loop.go          — agent loop, session logging
├── template.go      — COOK.md rendering, default template
└── config.go        — .cook.config.json parsing
```

Single Go module. One external dependency: Docker Go SDK (`github.com/docker/docker/client`).

### Core Types

```go
type LoopContext struct {
    Step          string // "work", "review", "gate"
    Prompt        string // the step-specific prompt
    LastMessage   string // output from previous claude run ("" on first call)
    Iteration     int
    MaxIterations int
    LogFile       string // path to session log file
}

type Config struct {
    WorkPrompt    string
    ReviewPrompt  string
    GatePrompt    string
    MaxIterations int
    Model         string
    ProjectRoot   string
}

type Sandbox struct {
    client      *client.Client // Docker SDK client
    containerID string
    projectRoot string
    userSpec    string // "uid:gid"
}
```

### Template Rendering (`template.go`)

```go
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
```

COOK.md is read from disk once. The template is parsed once and executed for each step with different `LoopContext` values. If COOK.md doesn't exist, cook uses the embedded default.

### Default COOK.md Template

```
# COOK.md

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
```

### The Agent Loop (`loop.go`)

```go
func agentLoop(sandbox *Sandbox, config Config, cookMD string) error {
    tmpl, err := template.New("cook").Parse(cookMD)
    if err != nil {
        return fmt.Errorf("parsing COOK.md: %w", err)
    }

    // Create session log
    logFile, err := createSessionLog(config.ProjectRoot)
    if err != nil {
        return err
    }

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
                Step: step.name, Prompt: step.prompt,
                LastMessage: lastMessage, Iteration: i,
                MaxIterations: config.MaxIterations, LogFile: logFile,
            })
            if err != nil {
                return err
            }

            output, err := sandbox.runClaude(config.Model, prompt)
            if err != nil {
                return fmt.Errorf("%s step failed (iteration %d): %w", step.name, i, err)
            }

            lastMessage = output
            appendToLog(logFile, step.name, i, output)
        }

        // Check gate verdict
        verdict := parseGateVerdict(lastMessage)
        if verdict == "PROCEED" {
            logOK("Gate: PROCEED — loop complete")
            break
        }
        logWarn("Gate: ITERATE — continuing to iteration %d", i+1)
    }
    return nil
}
```

### Session Logging (`loop.go`)

```go
func createSessionLog(projectRoot string) (string, error) {
    logDir := filepath.Join(projectRoot, ".cook", "logs")
    if err := os.MkdirAll(logDir, 0755); err != nil {
        return "", err
    }
    timestamp := time.Now().Format("2006-01-02-150405")
    return filepath.Join(logDir, timestamp+".md"), nil
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
```

### Gate Parsing (`loop.go`)

```go
func parseGateVerdict(output string) string {
    scanner := bufio.NewScanner(strings.NewReader(output))
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        upper := strings.ToUpper(line)
        if strings.HasPrefix(upper, "PROCEED") {
            return "PROCEED"
        }
        if strings.HasPrefix(upper, "ITERATE") {
            return "ITERATE"
        }
    }
    return "ITERATE" // default to iterate if ambiguous
}
```

### Sandbox Lifecycle (`sandbox.go`)

Uses the Docker Go SDK (`github.com/docker/docker/client`), same behavior as bash:

1. **`ensureBaseImage()`** — `client.ImageInspectWithRaw()` to check, `client.ImageBuild()` if missing (node:22-slim + claude-code + git + iptables)
2. **`startSandbox()`** — `client.ContainerCreate()` + `client.ContainerStart()` with project bind-mount, non-root user setup via `ContainerExecCreate()`, `client.CopyToContainer()` for auth files, optional network restrictions via iptables exec
3. **`stopSandbox()`** — `client.ContainerRemove()`, called via `defer`
4. **`containerExec()`** — `client.ContainerExecCreate()` + `client.ContainerExecAttach()` for running commands (claude, iptables, user setup)

### Config Parsing (`config.go`)

```go
type CookConfig struct {
    Network struct {
        Mode         string   `json:"mode"`
        AllowedHosts []string `json:"allowedHosts"`
    } `json:"network"`
    Env []string `json:"env"`
}
```

No `jq` dependency — Go handles JSON natively.

### Argument Parsing (`main.go`)

```go
func main() {
    work := flag.String("work", "", "Work step prompt")
    review := flag.String("review", defaultReviewPrompt, "Review step prompt")
    gate := flag.String("gate", defaultGatePrompt, "Gate step prompt")
    maxIter := flag.Int("max-iterations", 3, "Maximum iterations")
    model := flag.String("model", "opus", "Claude model")
    flag.Parse()

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
        sandbox := startSandbox(projectRoot, config)
        defer stopSandbox(sandbox)
        agentLoop(sandbox, Config{...}, cookMD)
    }
}
```

### Default Prompts

```go
const defaultReviewPrompt = `Review the work done in the previous step.
Check the session log for what changed.
Identify issues categorized as High, Medium, or Low severity.`

const defaultGatePrompt = `Based on the review, respond with exactly PROCEED or ITERATE
on its own line, followed by a brief reason.

PROCEED if: the work is complete and no High severity issues remain.
ITERATE if: there are High severity issues or the work is incomplete.`
```

## Implementation Approach

### Step 1: Initialize Go module

Create `cook/` directory with `go.mod`. Add Docker SDK dependency (`github.com/docker/docker/client`).

### Step 2: Implement template rendering

`template.go` — `renderTemplate()`, default COOK.md constant.

### Step 3: Implement sandbox lifecycle

`sandbox.go` — Docker container lifecycle using Docker Go SDK. `ContainerCreate`, `ContainerStart`, `ContainerRemove`, `ContainerExecCreate`, `ContainerExecAttach`, `ImageBuild`, `CopyToContainer`.

### Step 4: Implement the agent loop

`loop.go` — `agentLoop()`, `createSessionLog()`, `appendToLog()`, `parseGateVerdict()`.

### Step 5: Implement config parsing

`config.go` — `loadConfig()` for `.cook.config.json`.

### Step 6: Implement main, init, rebuild, arg parsing

`main.go` — wire everything together.

### Step 7: Test

Manual test: `cook init`, edit COOK.md, `cook "create a hello world script" 2`. Verify sandbox starts, COOK.md renders, claude runs, log file captures output, gate parsing works.

### Step 8: Remove bash cook script

Once the Go version works, remove the bash `cook` script.

## Alternatives Considered

### Git commits as audit trail

Rejected — version-controlling each iteration adds complexity without clear value. A session log file captures the same information. The user commits when they're ready.

### `os/exec` with Docker CLI instead of Docker SDK

Rejected — shelling out to the `docker` CLI means string-building commands and parsing text output. The Docker SDK provides a typed API with proper error handling.

### External template engine

Rejected — Go's `text/template` is in the standard library and powerful enough.
