# Code Review: Bash-to-Go Rewrite with Generic Agent Loop

**Reviewer:** AI
**Date:** 2026-03-01
**Reviewing:** commits ee8ecf4..0ed45ab (3 commits on v6n-simple-agent-loop)

## Summary

Solid rewrite that replaces a 1215-line bash script with ~660 lines of clean, idiomatic Go across 5 files. The architecture is well-decomposed (main, sandbox, loop, template, config), the Docker SDK integration is correct, and the agent loop logic is straightforward. A few issues around error handling, code duplication, and security hygiene need attention.

## What Works Well

- Clean file decomposition — each file has a single responsibility
- Docker SDK usage is correct and well-structured (tar archive for build context, stdcopy for multiplexed streams, exec inspect for exit codes)
- Template rendering with `text/template` is the right call — no external deps needed
- Gate parsing is simple and defensive (defaults to ITERATE on ambiguity)
- `cleanupStaleContainers` at sandbox start prevents container leaks
- Session logging format is readable and `tail -f` friendly
- Good use of `defer` for container cleanup

## Issues

### High

- [x] **`containerExec` and `containerExecWithEnv` are nearly identical** (`sandbox.go:205-291`). The only difference is the `Env` field on `ExecOptions`. `containerExec` should just call `containerExecWithEnv` with a nil env, or `containerExec` should accept an optional env parameter. This is ~40 lines of exact duplication that will diverge over time.

- [x] **Unchecked errors in `buildImage` tar writing** (`sandbox.go:53-58`). `tw.WriteHeader()` and `tw.Write()` both return errors that are silently ignored. A corrupt tar archive would produce a confusing Docker build error. These should be checked.

- [x] **Unchecked errors in `copyFileToContainer` tar writing** (`sandbox.go:302-308`). Same pattern — `tw.WriteHeader()` and `tw.Write()` return values are dropped.

- [x] **`appendToLog` error is ignored in `agentLoop`** (`loop.go:68`). `appendToLog` returns an error but the caller discards it. If the log file becomes unwritable mid-session, the user gets no feedback and the log is silently incomplete.

### Medium

- [x] **`renderTemplate` in `template.go` is dead code** (`template.go:51-61`). The agent loop uses `executeTemplate` in `loop.go:86` instead. `renderTemplate` parses the template on every call (unlike `executeTemplate` which takes a pre-parsed `*template.Template`). One of them should be removed.

- [x] **Project-specific image is never rebuilt when `.cook.Dockerfile` changes** (`sandbox.go:94-103`). The image is built only if `ImageInspectWithRaw` fails (image doesn't exist). If the user edits `.cook.Dockerfile`, the stale image is reused. The bash version used a content-hash tag to detect changes. Consider hashing the Dockerfile content and including it in the image tag, or at minimum documenting that `cook rebuild` is needed after editing.

- [x] **`cleanupStaleContainers` kills all `cook-*` containers** (`sandbox.go:342-355`). If a user has two terminals running `cook` in different projects, starting a second one will force-remove the first. Consider scoping by project root (e.g., container label) or only cleaning up containers from the same PID lineage.

- [x] **`json.Unmarshal` error ignored in `loadConfig`** (`config.go:24`). Malformed JSON in `.cook.config.json` is silently ignored, returning a zero-value config. The user gets no feedback that their config is broken. A warning log would help.

- [x] **`generateIptablesScript` mutates the input slice** (`sandbox.go:315`). `append([]string{"api.anthropic.com"}, allowedHosts...)` is fine for the current call site, but `append` on a non-nil slice can mutate the underlying array in subtle ways if the caller reuses it. Using `slices.Concat` or building a new slice explicitly would be safer.

### Low

- [x] **No signal handling for graceful cleanup** (`main.go:152`). `defer sandbox.stopSandbox()` won't run if the process receives SIGINT/SIGTERM. The container will be left running until the next `cook` invocation cleans it up. Consider trapping signals to ensure cleanup.

- [x] **`cmdInit` ignores `os.WriteFile` errors** (`main.go:174, 183, 192`). Disk-full or permission errors are silently swallowed.

- [x] **Session log path uses host filesystem path** (`loop.go:99`). The `LogFile` template variable renders as a host path (e.g., `/home/user/project/.cook/logs/...`), which is also valid inside the container since the project is bind-mounted at the same path. This works but is a subtle coupling worth a comment.

- [x] **`usage()` calls `os.Exit(0)`** (`main.go:90`). This means `defer` statements in `main()` won't run. Not a problem currently since `usage()` is called before sandbox setup, but it's a latent trap.

## Questions

- Is there a plan to add `go build` instructions or a Makefile? Currently there's no documented way to build the binary.
- Should `cook rebuild` also rebuild project-specific images, or just the base image?
- The plan mentioned content-hash tagging for project images — was this intentionally deferred or overlooked?

## Recommendation

[ ] Needs revision (see issues above)
[x] Ready for human review

All High, Medium, and Low issues have been addressed.
