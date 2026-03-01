# Research: Simple Agent Loop

**Requester:** rjcorwin
**Date:** 2026-03-01

## Requirements

### Original Request

Replace cook's structured RPI commands with an unopinionated agent loop. The loop runs "in a sandbox, do X in work→review→gate loop Y number of times." COOK.md is the prompt template — cook renders it using Go's `text/template` engine, injecting dynamic context (step, prompt, last message, iteration). Each cook session writes to a log file that captures claude's output from every step. Cook is rewritten from bash to Go.

### Usage

```
cook init                    # creates COOK.md template, .cook.Dockerfile, .cook.config.json
vim COOK.md                  # edit the template

cook "implement foo feature"                          # 3 iterations (default)
cook "write research.md for 001-foo" 5                # 5 iterations
cook --work "implement" --review "code review" --gate "all criticals resolved" --max-iterations 10
```

### Derived Requirements

1. COOK.md is a Go template — cook renders it with `text/template` and passes the output as the prompt to claude
2. Each cook session creates a log file (e.g., `.cook/logs/<timestamp>.md`) that captures claude's output from every step
3. Claude gets cross-step context via the `LastMessage` template variable and can read the session log file for full history
4. No automatic git commits — the user commits when they're ready
5. Remove existing RPI commands (`new`, `research`, `plan`, `implement`, `yolo`) — they'll return later as a template library system
6. Keep: `init`, `rebuild`, Docker sandbox
7. Default iteration count: 3
8. Cook is rewritten in Go as a single compiled binary

## System Architecture

### Current Architecture (bash, being replaced)

Cook is a ~1215-line bash script. The parts relevant to the rewrite:

**Kept conceptually (reimplemented in Go):**
- Docker sandbox lifecycle: `start_sandbox()`, `stop_sandbox()`, `ensure_base_image()`, `cleanup_stale_containers()` — starts a long-running Docker container, bind-mounts the project, creates a non-root user matching host UID/GID, copies auth files, optionally applies network restrictions
- Claude interface: `run_claude(prompt)` — `docker exec claude --model $MODEL --dangerously-skip-permissions --print "$prompt"`
- `cmd_init()` — creates COOK.md, `.cook.config.json`, `.cook.Dockerfile`
- `cmd_rebuild()` — rebuilds the sandbox Docker image
- Logging and progress output

**Removed:**
- `gate_check()`, `cmd_new()`, `resolve_plan()`, `cmd_research()`, `cmd_plan()`, `cmd_implement()`, `cmd_yolo()` — structured RPI commands
- `default_cook_md()` — 400-line RPI workflow guide, replaced with a Go template
- Plan directory logic (`PLAN_DIR`, `PLAN_SLUG`, etc.)

### Proposed Architecture (Go)

```
cook/
├── main.go          — entry point, arg parsing, dispatch
├── sandbox.go       — Docker container lifecycle
├── loop.go          — agent loop, session logging
├── template.go      — COOK.md rendering, default template
└── config.go        — .cook.config.json parsing
```

Single Go module. One external dependency: the Docker Go SDK (`github.com/docker/docker/client`).

### Docker Interaction

Cook uses the Docker Go SDK for all container operations — create, start, stop, exec, image build, file copy. This gives a typed API instead of string-building CLI commands and parsing their output.

```go
import "github.com/docker/docker/client"

func newDockerClient() (*client.Client, error) {
    return client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
}
```

Key SDK operations:
- `client.ContainerCreate()` / `client.ContainerStart()` / `client.ContainerRemove()` — lifecycle
- `client.ContainerExecCreate()` / `client.ContainerExecAttach()` — run commands inside container (claude, iptables)
- `client.ImageBuild()` / `client.ImageInspectWithRaw()` — base image management
- `client.CopyToContainer()` — auth file copying

### Claude Interface

Uses Docker SDK exec to run `claude --print` inside the container:

```go
func (s *Sandbox) runClaude(model, prompt string) (string, error) {
    return s.containerExec("claude", "--model", model, "--dangerously-skip-permissions", "--print", prompt)
}
```

### Go `text/template` for COOK.md

COOK.md uses Go template syntax. Cook parses it with `text/template`, executes with a `LoopContext` struct, and passes the rendered output to claude.

```go
type LoopContext struct {
    Step          string // "work", "review", "gate"
    Prompt        string // the step-specific prompt
    LastMessage   string // output from previous claude run ("" on first call)
    Iteration     int
    MaxIterations int
    LogFile       string // path to session log file
}
```

Go's `text/template` handles all special characters in values — no escaping issues with claude output. It also supports conditionals (`{{if}}`) and ranges (`{{range}}`), so users can write expressive templates.

### Session Log File

Each cook invocation creates a log file at `.cook/logs/<timestamp>.md` (e.g., `.cook/logs/2026-03-01-153045.md`). After every `runClaude()` call, the output is appended to the log:

```markdown
## [work 1] 2026-03-01 15:30:45

<claude's output>

---

## [review 1] 2026-03-01 15:32:10

<claude's output>

---

## [gate 1] 2026-03-01 15:33:22

<claude's output>

---
```

The log serves as:
- **Audit trail** — what claude did and said at each step
- **Context for claude** — the `LogFile` template variable gives claude the path to read for full history
- **Debugging** — if something goes wrong, the log shows exactly what happened

The `LastMessage` template variable provides the output from the immediately previous step. For full cross-step history, the COOK.md template can tell claude to read the log file.

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

### Argument Parsing

Go's `flag` package handles CLI args:

```
cook init                    → cmdInit()
cook rebuild                 → cmdRebuild()
cook help | -h | --help      → usage()

cook "prompt"                → agentLoop("prompt", defaultReview, defaultGate, 3)
cook "prompt" 5              → agentLoop("prompt", defaultReview, defaultGate, 5)
cook --work "X" --review "Y" --gate "Z" --max-iterations 10
```

If the first positional arg is not a known command, it's the work prompt. If a second positional arg is numeric, it's the iteration count.

Flags: `--work`, `--review`, `--gate`, `--max-iterations`, `--model`.

### Sandbox Lifecycle

Reimplemented in Go using the Docker SDK, same behavior as bash:

1. `ensureBaseImage()` — `ImageInspectWithRaw()` to check, `ImageBuild()` if missing
2. `startSandbox()` — `ContainerCreate()` + `ContainerStart()` with project bind-mount, non-root user setup via exec, `CopyToContainer()` for auth files, optional network restrictions via iptables exec
3. `stopSandbox()` — `ContainerRemove()` on exit (Go `defer`)
4. Project-specific image from `.cook.Dockerfile` with content-hash tag

## Constraints

1. **Single binary** — cook compiles to one Go binary, no runtime dependencies beyond Docker on the host
2. **Docker sandbox** — all claude execution happens inside the container
3. **`--print` mode** — claude runs as stateless `--print` invocations, context between calls comes from session log and the rendered COOK.md template
4. **Go `text/template`** — COOK.md uses Go template syntax (decision-003)
5. **No automatic git** — cook doesn't touch git. User commits when ready

## Dependencies

**External:**
- `github.com/docker/docker/client` — Docker SDK for container lifecycle and exec

**Standard library:**
- `text/template` — COOK.md rendering
- `encoding/json` — `.cook.config.json` parsing
- `flag` — CLI argument parsing

Docker Engine must be running on the host. The `docker` CLI is not required — cook talks to the Docker daemon directly via the SDK. `git` and `jq` are not required by cook.
