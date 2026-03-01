# Research: Simple Agent Loop

**Requester:** rjcorwin
**Date:** 2026-03-01

## Requirements

### Original Request

Replace cook's structured RPI commands with an unopinionated agent loop. The loop runs "in a sandbox, do X in work→review→gate loop Y number of times." COOK.md becomes the prompt template — cook renders it with variable substitution each iteration and passes the result as claude's entire prompt. After each claude run, cook commits all changes with claude's last message as the commit message. Git history replaces review files as the audit trail.

### Usage

```
cook init                    # creates COOK.md template, .cook.Dockerfile, .cook.config.json
vim COOK.md                  # edit to customize

cook "implement foo feature"                          # 3 iterations (default)
cook "write research.md for 001-foo" 5                # 5 iterations
cook --work "implement" --review "code review" --gate "all criticals resolved" --max-iterations 10
```

### Derived Requirements

1. COOK.md is the prompt template — cook renders it with variables and passes the rendered output as the prompt to claude
2. After each `run_claude()` call, cook runs `git add -A && git commit` with claude's last message as the commit message
3. Claude gets history context from git — COOK.md tells it to check `git log` for prior iterations
4. Remove existing RPI commands (`new`, `research`, `plan`, `implement`, `yolo`). They'll return later as a yet-to-be-determined system for defining reusable prompt templates for work/review/gate
5. Keep: `init`, `rebuild`, Docker sandbox, `run_claude()` infrastructure
6. Default iteration count: 3
7. If first arg doesn't match a known command, treat it as the work prompt for the generic loop

### Context

Cook is a bash script that orchestrates Claude CLI calls inside Docker containers. It currently has structured commands that enforce the RPI workflow with specific file outputs at each phase. This change strips it down to the loop primitive, making COOK.md the single source of truth for what claude sees.

## System Architecture

### Current Architecture (what exists today)

Cook is a single bash script (~1215 lines) with this structure:

```
cook (bash script on host)
├── Configuration (PROJECT_ROOT, ITERATIONS, MODEL, colors)
├── Prerequisites (docker, git, jq checks)
├── Docker/Sandbox lifecycle
│   ├── cleanup_stale_containers()
│   ├── ensure_base_image()
│   ├── start_sandbox()
│   └── stop_sandbox()
├── Claude interface
│   ├── run_claude(prompt)          — docker exec claude --print
│   └── gate_check(review_file, phase, iteration, max)
├── default_cook_md()               — bundled inline, ~400 lines of RPI workflow guide
├── Commands
│   ├── cmd_init()                  — interactive setup       ← KEEP
│   ├── cmd_new(ask_text)           — create plan dir         ← REMOVE
│   ├── cmd_research(slug)          — research phase loop     ← REMOVE
│   ├── cmd_plan(slug)              — plan phase loop         ← REMOVE
│   ├── cmd_implement(slug)         — implement phase loop    ← REMOVE
│   ├── cmd_yolo(ask_text)          — all phases end-to-end   ← REMOVE
│   └── cmd_rebuild()               — rebuild Docker image    ← KEEP
├── Arg parsing (--iterations, --model, --name, --code, -h)
└── Dispatch (case statement on COMMAND)
```

### Key Components

**`run_claude(prompt)`** (lines 253-267): Takes a prompt string, runs `docker exec claude --model $MODEL --dangerously-skip-permissions --print "$prompt"` inside the sandbox container. Returns claude's output on stdout. This is the only interface to claude — all commands use it. Unchanged by this work.

**`gate_check()`** (lines 269-302): Currently hardcoded to read a review file and output PROCEED/ITERATE. This will be replaced by the generic loop's gate step, which renders COOK.md with `step=gate` and parses the output for PROCEED/ITERATE.

**`default_cook_md()`** (lines 308-709): Generates the current COOK.md content — a ~400-line RPI workflow guide with phase instructions and markdown templates. This will be replaced with a much simpler template that has variable placeholders for the generic loop.

**`start_sandbox()`** (lines 143-243): Starts a Docker container with the project bind-mounted, sets up non-root user matching host UID/GID, copies auth files, optionally applies network restrictions via iptables. Unchanged.

**`cmd_init()`** (lines 714-768): Creates COOK.md, `.cook.config.json`, and `.cook.Dockerfile`. Mostly unchanged — just needs to generate the new template-style COOK.md instead of the RPI workflow guide.

### The Work→Review→Gate Loop Pattern

Each current structured command follows this pattern:

1. **AI:Work** — `run_claude()` with a phase-specific prompt → produces output
2. **AI:Review** — `run_claude()` with a review prompt → writes a review file
3. **AI:Gate** — `gate_check()` reads review file → PROCEED or ITERATE
4. If ITERATE: AI:Work (revision) with review file reference → back to step 2
5. If PROCEED or max iterations: done

The new design keeps this same 3-step structure but changes how prompts are constructed (template rendering from COOK.md) and how context persists between iterations (git commits instead of review files).

## Design

### COOK.md as the Prompt Template

COOK.md serves dual purposes:
1. **User-edited config** — project conventions, coding standards, custom instructions
2. **Prompt template** — contains variable placeholders that cook fills in before passing to claude

Each time cook calls claude, it:
1. Reads COOK.md from disk
2. Substitutes variables (step, prompt, last message, iteration, etc.)
3. Passes the rendered result as the entire prompt to `run_claude()`

This means claude's context is completely determined by COOK.md. Users can see exactly what claude will receive by reading COOK.md and mentally substituting the variables.

### Template Variables

These variables are available in COOK.md:

| Variable | Description | Example value |
|----------|-------------|---------------|
| `{{STEP}}` | Current step | `work`, `review`, or `gate` |
| `{{PROMPT}}` | The prompt for this step | User's work prompt, review prompt, or gate prompt |
| `{{LAST_MESSAGE}}` | Output from the previous claude run | Claude's last response (empty on first call) |
| `{{ITERATION}}` | Current iteration number | `1` |
| `{{MAX_ITERATIONS}}` | Total iterations configured | `3` |

Cook uses simple `sed` substitution to replace `{{VAR}}` with values. Multi-line values (like `{{LAST_MESSAGE}}`) are handled by writing to a temp file and using `sed` with file reads, or by using bash parameter expansion before passing to `run_claude()`.

### The Loop

```
for iteration in 1..N:
  # Step 1: Work
  render COOK.md with step=work, prompt=work_prompt, last_message, iteration
  output = run_claude(rendered)
  git add -A && git commit -m "$output"
  last_message = output

  # Step 2: Review
  render COOK.md with step=review, prompt=review_prompt, last_message, iteration
  output = run_claude(rendered)
  git add -A && git commit -m "$output"
  last_message = output

  # Step 3: Gate
  render COOK.md with step=gate, prompt=gate_prompt, last_message, iteration
  output = run_claude(rendered)
  git add -A && git commit -m "$output"
  last_message = output

  if output contains "PROCEED": break
```

### Git as the Review Trail

After every `run_claude()` call, cook runs:

```bash
git add -A
git commit -m "$last_message"
```

This captures:
- **What changed** — the diff in the commit
- **What claude said** — the commit message
- **When** — the commit timestamp
- **Which step** — identifiable from the commit message content

Claude gets told (via COOK.md) that history is in git. On iteration 2+, claude can run `git log` to see what happened in prior iterations. This replaces the review file system — `git log --oneline` gives you the audit trail, `git diff HEAD~N` gives you the changes.

### Default COOK.md Template

The new `default_cook_md()` generates something like:

```markdown
# COOK.md

## Project Instructions
[Edit this section with your project's conventions, coding standards, etc.]

## Agent Loop Context

You are in a work→review→gate loop, iteration {{ITERATION}}/{{MAX_ITERATIONS}}.

Current step: **{{STEP}}**

### Your task for this step
{{PROMPT}}

### Previous claude output
{{LAST_MESSAGE}}

### History
Your work history is in git. Run `git log --oneline` to see previous iterations.
Run `git diff HEAD~1` to see the most recent changes.
```

This is intentionally minimal. Users customize it by editing the "Project Instructions" section and can restructure the agent loop context section however they want.

### Argument Parsing

The key parsing change: if `args[0]` doesn't match a known command (`init`, `rebuild`, `help`), treat it as the work prompt for the generic loop.

```
cook "prompt"                         → work_prompt="prompt", iterations=3
cook "prompt" 5                       → work_prompt="prompt", iterations=5
cook --work "X" --review "Y" --gate "Z" --max-iterations 10
```

New flags:
- `--work PROMPT` — work step prompt (alternative to positional)
- `--review PROMPT` — review step prompt (default: "Review the work done. Check git log and git diff for changes. Identify issues as High/Medium/Low.")
- `--gate PROMPT` — gate step prompt (default: "Based on the review, respond with exactly PROCEED or ITERATE on the first line, followed by a brief reason.")
- `--max-iterations N` — alias for `--iterations`

When the work prompt is provided as a positional arg (not `--work`), and a second positional arg exists, it's parsed as iteration count if numeric.

### What Gets Removed

- `cmd_new()` — creates plan directories, not needed for generic loop
- `cmd_research()` — structured research phase
- `cmd_plan()` — structured plan phase
- `cmd_implement()` — structured implement phase, including branch creation
- `cmd_yolo()` — all-phases runner
- `resolve_plan()` — plan directory resolution
- `gate_check()` — replaced by the generic loop's gate step (rendered from COOK.md)
- `default_cook_md()` — replaced with a new, simpler template
- The `--name` and `--code` flags — only used by `cmd_new()`
- The `PLAN_DIR`, `PLAN_SLUG`, `PLAN_CODE`, `FEATURE_NAME`, `NEW_SLUG` variables

### What Gets Modified

- **Arg parsing** — add `--work`, `--review`, `--gate` flags; fallback on unknown command
- **Dispatch** — default case runs the generic loop instead of erroring
- **`cmd_init()`** — generates the new template-style COOK.md
- **`default_cook_md()`** — new, much shorter template with `{{VAR}}` placeholders

### What Stays the Same

- Docker sandbox lifecycle (`start_sandbox`, `stop_sandbox`, `ensure_base_image`, `cleanup_stale_containers`)
- `run_claude()` — unchanged
- Network restriction (`generate_iptables_script`, config-based restriction)
- Auth file handling (copying `.claude.json` and credentials into container)
- `cmd_rebuild()` — unchanged
- `.cook.config.json` and `.cook.Dockerfile` support
- Logging functions (`log_phase`, `log_step`, `log_ok`, `log_warn`, `log_err`)

## Constraints

1. **Single bash script** — cook is one file, changes must fit within this constraint
2. **Docker sandbox** — all claude execution happens inside the container, never on host
3. **`--print` mode** — claude runs as stateless `--print` invocations. Each call is independent. Context between calls comes from git history and COOK.md template variables
4. **Template substitution in bash** — `sed` or parameter expansion for `{{VAR}}` replacement. Must handle multi-line values (claude output can be long)
5. **Git commits inside the container** — the container has git and the project is bind-mounted. Git identity is passed via env vars. Commits happen inside the container via `docker exec`
6. **Backward compatibility is NOT required** — we're removing the RPI commands, not preserving them

## Open Questions

### How should multi-line commit messages be handled?

Claude's output can be very long. Git commit messages have no hard length limit, but extremely long messages are unwieldy in `git log`. Options:
- Truncate to first N lines or N characters
- Use first line as subject, rest as body (natural git convention)
- Store full output in a separate file and reference it in the commit message

**Recommendation:** Use first line as commit subject, full output as commit body. This follows git conventions and `git log --oneline` gives a clean summary while `git log -1` gives the full context.

### Should `git add -A` include everything?

`git add -A` stages all changes including new files, modified files, and deletions. This is appropriate for the generic loop since claude may create, modify, or delete any files. However, it could accidentally stage files that shouldn't be committed (e.g., large binaries, temp files). The project's `.gitignore` should handle this, and since this runs inside a sandbox, there's less risk of stray files.

**Recommendation:** Use `git add -A`. The sandbox environment and `.gitignore` provide sufficient protection.

### How does template substitution handle special characters?

Claude's output (used in `{{LAST_MESSAGE}}`) may contain characters that break `sed` substitution (e.g., `/`, `&`, `\`). Options:
- Use `sed` with a different delimiter (e.g., `|` or `#`)
- Use bash parameter expansion (`${template//\{\{VAR\}\}/$value}`) — handles any characters but is slow for large strings
- Write variables to temp files and use `awk` or `python` for substitution
- Use `envsubst` (from gettext) with `$VAR` syntax instead of `{{VAR}}`

**Recommendation:** Use bash heredoc expansion. Instead of `{{VAR}}` placeholders, COOK.md uses `$STEP`, `$PROMPT`, etc. Cook reads COOK.md, exports the variables, and uses `envsubst` to render. This is a standard unix tool, handles all special characters, and is fast. If `envsubst` isn't available in the container, fall back to a simple python one-liner or awk script.

Alternatively: don't template COOK.md at all. Instead, construct the prompt as: the static content of COOK.md + a dynamic section appended by cook. This avoids the substitution problem entirely — COOK.md is always passed verbatim, and the dynamic context (step, prompt, last message, iteration) is appended as a separate section. This is simpler and less error-prone.
