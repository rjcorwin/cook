# Decision: Template Substitution Strategy

**Status:** Proposed
**Date:** 2026-03-01
**Deciders:** rjcorwin

## Context

COOK.md is both a user-edited config file and a prompt template. Cook needs to inject dynamic context (step, prompt, last message, iteration) into the prompt that claude receives. The question is how to do that substitution — and whether that question changes the language cook is written in.

## Options

### Option 1: Concatenation — COOK.md verbatim + dynamic section appended

Don't template COOK.md at all. Cook reads COOK.md as-is and appends a dynamic context section. The prompt is: `COOK.md content + "\n---\n" + dynamic section`.

**Pros:**
- Zero substitution bugs — no special characters to escape
- COOK.md is simpler for users — just write plain markdown, no template syntax
- No dependency on any templating tool
- Simplest implementation

**Cons:**
- Users can't control where dynamic context appears within COOK.md
- COOK.md isn't really a "template" — it's just a static file with context bolted on at the end
- Less expressive — can't conditionally include sections, loop over data, etc.
- Mixes two concerns: user instructions are in COOK.md, dynamic context is appended by cook — the user can't see or control the full prompt

### Option 2: Go `text/template` — rewrite cook in Go

Rewrite cook in Go. COOK.md uses Go's template syntax (`{{.Step}}`, `{{.Prompt}}`, `{{if eq .Step "gate"}}...{{end}}`). Cook compiles the template, executes it with a data struct, and passes the result to claude.

```markdown
# COOK.md

## Project Instructions
[your conventions here]

## Current Task
Step: **{{.Step}}** | Iteration: {{.Iteration}}/{{.MaxIterations}}

{{.Prompt}}

{{if .LastMessage}}
## Previous Output
{{.LastMessage}}
{{end}}

## History
Your work history is in git. Run `git log --oneline` to see prior iterations.
```

**Pros:**
- COOK.md is a real template — users control exactly what claude sees, including where dynamic content appears
- Go's template engine handles all special characters (no sed/escaping issues)
- Conditionals (`{{if}}`) and range (`{{range}}`) enable expressive templates without complexity
- Go is a single binary — no runtime dependencies, easy to distribute
- Go has excellent Docker SDK, exec, and process management libraries
- Better error handling than bash (typed errors, proper exit codes)
- Easier to test (unit tests for template rendering, loop logic, etc.)
- Sets up cook for future complexity (template library system, config parsing, etc.)

**Cons:**
- Rewrite effort — cook is ~1215 lines of bash today, would need to be reimplemented
- Go template syntax (`{{}}`) is unfamiliar to some users
- Adds a build step (compile Go binary) vs. bash which runs anywhere
- Two-language barrier: users who want to hack on cook now need to know Go instead of bash

### Option 3: `sed` substitution with `{{VAR}}` placeholders (bash)

COOK.md contains `{{STEP}}`, `{{PROMPT}}`, etc. Cook uses `sed` to replace them.

**Pros:**
- Familiar template syntax
- No external dependencies
- Stays in bash

**Cons:**
- `sed` breaks on special characters in replacement values (claude output contains `/`, `&`, `\`, newlines)
- Multi-line replacement is fragile
- Any `{{VAR}}` pattern in user content could be accidentally substituted
- No conditionals or loops

### Option 4: `envsubst` with `$VAR` syntax (bash)

COOK.md uses `$STEP`, `$PROMPT`, etc. Cook exports variables and runs `envsubst`.

**Pros:**
- Standard unix tool, handles special characters better than sed
- Fast

**Cons:**
- `$VAR` syntax conflicts with shell examples users might put in COOK.md
- `envsubst` may not be installed in the container
- Still has accidental substitution risk
- No conditionals or loops

## Decision

**Option 2: Go `text/template` — rewrite cook in Go.** COOK.md becomes a real template that users fully control. Cook becomes a compiled Go binary that reads COOK.md, renders it with a data struct, and passes the result to claude. This also means the plan.md and research.md need revision — the implementation is now a Go program, not a bash script modification.

## Consequences

### Positive
- COOK.md is the actual prompt — users see and control exactly what claude receives
- Go's template engine is battle-tested, handles all special characters, supports conditionals and iteration
- Single binary distribution — no bash version quirks, no dependency on sed/envsubst/jq
- Better foundation for future features (template library system, config parsing, structured error handling)
- Testable — unit tests for template rendering, loop logic, prompt construction

### Negative
- Rewrite effort from ~1215 lines of bash to Go
- Contributors need Go knowledge instead of bash
- Adds a build/compile step (though `go install` or prebuilt binaries mitigate this)
- Go template syntax has a learning curve for COOK.md authors
