# Research: Inspect Runs / Stream Formatting

**Requester:** rj
**Date:** 2026-03-16

## Requirements

### Original Request
A way to inspect runs to see their output — to determine if an agent is going down a wrong path, is stuck, etc. When possible, format the agent's streams. For Claude specifically, use the `format-claude-stream` package. When no formatter is available, fall back to raw JSONL or whatever the agent emits.

### Context
Cook runs agents and shows their output in an Ink TUI. The raw lines emitted by Claude (run with `-p`) are JSONL streaming events — not human-readable. Race and fork-join modes are especially opaque: they run multiple agents in parallel and show only compact status, not what any individual run is actually doing.

### Open Questions
- Is the intent to format streams live in the existing TUI, or to add a separate `cook inspect` command (or both)?
- For race/fork-join, should each run's stream be viewable simultaneously (e.g., side-by-side panels) or one-at-a-time (e.g., `cook inspect run-2`)?
- Should formatted output replace the raw lines in the TUI, or should raw lines still be available (e.g., logged to file while formatted output is shown)?
- Is `format-claude-stream` suitable as a runtime dep or only a dev/build tool?

## System Architecture

### Agent Output Pipeline

When an agent runs, `NativeRunner.runAgent()` spawns the agent process and pipes its `stdout` through a `LineBuffer`, calling `onLine(line)` for each completed line. This callback:
1. In the main loop: emits `loopEvents.emit('line', line)` → consumed by `App.tsx` → pushed as a `StaticItem` of type `'line'` → rendered verbatim by `LogStream.tsx`
2. In race: emits on a per-run `EventEmitter` → consumed by `RaceApp` (which only shows compact per-run status, not line content)
3. In fork-join: similar to race — per-branch emitters, compact status only

### What Claude Emits
Claude CLI (`claude -p`) outputs JSONL to stdout — one JSON object per line. Examples:
```
{"type":"system","subtype":"init",...}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]},...}
{"type":"result","subtype":"success","result":"...",...}
```
This format is not readable in the TUI as-is. The final text response is buried inside `result` or `assistant` message content.

### Codex / OpenCode Output
Codex (`codex exec`) outputs plain text or markdown to stdout. OpenCode may emit its own structured format. Neither requires JSONL parsing.

### Session Logs
`createSessionLog` creates `.cook/logs/YYYY-MM-DD-HHMMSS.md`. After each step, `appendToLog` writes the raw agent output (full accumulated string, not individual lines) to this file. These logs capture the entire output but only after a step completes — not live during execution.

### TUI Architecture (Ink)
- `LogStream.tsx`: Uses `<Static>` for already-rendered lines (never re-renders) and a live `<ActiveFooter>` for current status.
- `App.tsx`: Listens to `loopEvents`, pushes `StaticItem` entries.
- `RaceApp.tsx`: Shows per-run status (done/error/running) but does not display line content from individual runs.

### Constraints
- Ink's `<Static>` renders items once and never re-renders them. Streaming formatted content (accumulating partial text) would require a different approach for live partial lines.
- Race/fork-join use per-run emitters isolated from the main `loopEvents`.
- The `format-claude-stream` package is ESM and suitable as a runtime dependency.

## Prior Art

### format-claude-stream
GitHub: https://github.com/Khan/format-claude-stream

A small package that parses Claude's JSONL streaming output and emits human-readable formatted text. Designed to be piped: `claude -p "..." | format-claude-stream`. Can be used programmatically — consume JSONL lines, get readable output.

Key capability: given a line like `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}`, extract and emit `Hello`.

### Existing `cook` Log Inspection
After a run, users can `cat .cook/logs/<timestamp>.md` to read a session log. This is a post-hoc approach; it doesn't help during a run.

### Tail-Based Inspection
A separate terminal (`tail -f .cook/logs/<timestamp>.md`) can follow a session log live. The limitation is that logs are written per-step (post-completion), not line-by-line during streaming. So this shows completed steps, not in-progress streaming.

### Terminal Multiplexers / Side Windows
Users currently open a second terminal to `tail -f` the log file. This is manual and doesn't help with JSONL formatting.

## Design Options

### Option A: In-TUI Stream Formatting (main loop only)
Format agent lines before they are pushed as `StaticItem` entries in the TUI.
- For Claude: parse JSONL lines with `format-claude-stream` logic, emit readable text chunks.
- For other agents: pass lines through as-is.
- Advantage: improves the default experience with no new commands.
- Disadvantage: race/fork-join TUI shows compact status only — individual run streams aren't visible at all.

### In-TUI Run Selection for Race/Fork-Join

The `RaceApp` component currently subscribes to `step`/`done`/`error`/`logFile` events per run but ignores `line` events. It has no keyboard input. Ink supports keyboard input via `useInput`. Lines per run would need to be stored in component state. Three sub-options for how to surface a selected run's stream:

#### Option B: Focused run stream panel (inline, last-N lines)
Number keys (1, 2, 3...) select a run. A stream panel appears below the compact status rows, showing the last N lines of the focused run's output (formatted where possible). Pressing 0 or Escape hides the panel.
- Advantage: stays within the compact race view; no mode switch.
- Disadvantage: Ink has no built-in scrolling — the panel must be a fixed-height slice of recent lines, rendered via regular (non-Static) React state. This means re-renders on every new line, which may flicker. Can't scroll back.

#### Option C: Fullscreen run view (modal switch)
Number keys switch the entire TUI into a fullscreen view of a single run's stream — identical to the main loop's `LogStream` (using `<Static>` for committed lines, `<ActiveFooter>` for status). Pressing Escape returns to the compact race view. Each run's line history is buffered in state the whole time, even when not focused.
- Advantage: reuses the existing LogStream component; no flicker because Static handles committed lines correctly. Seamless experience — looks just like running a single cook loop.
- Disadvantage: switching views is a binary modal toggle. Only one run visible at a time.

#### Option D: Always-split view
The TUI is always two-panel: compact status rows at top, focused run's stream at bottom. Number keys or Tab cycles the focused run. The stream panel uses the last-N-lines approach (non-Static, same flicker tradeoff as Option B) or a scrollable Static session.
- Advantage: status always visible alongside stream.
- Disadvantage: more complex layout; flicker or implementation complexity.

## Decision

**Option A + Option C** — decided.

- Main loop: format agent streams in the existing TUI (A).
- Race/fork-join: pressing a number key enters a fullscreen stream view for that run (C), reusing `LogStream`. Escape returns to the compact race view. Each run's line history is buffered in state throughout.

This avoids the flicker problem of non-Static rendering, reuses existing components, and gives the user a clear mental model: the compact race view is the "dashboard," and number keys let you "dive into" a run.

The one tradeoff: you can only watch one run at a time. If side-by-side is ever needed, that's a future option.

**Status: Waiting on upstream work before plan.md.**
