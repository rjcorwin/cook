# Research: TUI Scroll-to-Bottom Fix

**Requester:** rjcorwin
**Date:** 2026-03-01

## Requirements

### Original Request
The TUI scrolls the user back to the bottom every time the non-Static area re-renders. This happens on every spinner frame (80ms) and on every new output line. The user cannot scroll up to read earlier output without being yanked back down. We need animated elements (spinner) and live output while preserving terminal scrollback.

### Context
Cook's TUI uses Ink (React for terminals). The current architecture puts the entire active section — step header, request box, all response lines, and an animated spinner — in Ink's non-Static rendering area. Ink redraws all non-Static content on every state change, which forces the terminal to scroll to the bottom.

This was discovered iteratively:
1. A 1-second elapsed timer in the status bar caused constant scroll-yanking. Fixed by removing the interval and computing elapsed at render time.
2. An animated spinner (80ms interval) in the response box reintroduced the same problem.
3. The root cause is architectural: too much content lives in the non-Static area.

### Open Questions
- Should we keep Ink or consider a different rendering approach?
- How much visual fidelity (box borders around sections) can we preserve with a Static-first architecture?
- Is the alternate screen buffer approach worth considering?

## System Architecture

### Current Architecture
```
Ink render tree:
  <Box column>
    <Static items={completedSections}>     ← scrollback-safe, never re-rendered
      <SectionBox />                        ← colored bordered box per completed section
    </Static>
    <SectionBox section={currentSection} /> ← NON-STATIC: entire active section
      ├─ step header
      ├─ request box (yellow border)
      ├─ response box (purple border)       ← ALL response lines live here
      │    ├─ <Spinner />                   ← animates at 80ms, triggers full redraw
      │    └─ line 1, line 2, line 3...
    <StatusBar />                           ← NON-STATIC: status info
  </Box>
```

**The problem:** `currentSection` grows unboundedly as response lines arrive. Every spinner tick redraws the entire section (header + request + all lines + spinner), causing scroll-to-bottom.

### Related Components
- `src/ui/App.tsx` — state management, event listeners, main layout
- `src/ui/LogStream.tsx` — Static/non-Static split, SectionBox component with Spinner
- `src/ui/StatusBar.tsx` — footer with step/model/elapsed/logfile
- `src/loop.ts` — emits events: `step`, `prompt`, `line`, `done`, `error`

### Data Flow
```
loop.ts emits events
  → App.tsx event listeners update state
    → state.completedSections  → LogStream Static (scrollback)
    → state.currentSection     → LogStream non-Static (PROBLEM)
    → StatusBar props
```

### Constraints
- Must preserve terminal scrollback (user can scroll up to read earlier output)
- Must not yank scroll position when content updates
- Should have animated feedback (spinner) that work is in progress
- Should visually distinguish work/review/gate sections (currently red/green/blue borders)
- Should visually distinguish request and response within each section

## Prior Art

### MEW Protocol (`../mew-protocol/src/cli/`)
Uses Ink with the same `Static` + non-Static split pattern:
- **All message history** goes through `<Static>` — committed to terminal scrollback
- **Animated elements** (ReasoningStatus with spinner at 150ms) render OUTSIDE Static, below it
- **Fixed heights** on animated containers prevent layout jitter
- **Startup animation** uses raw ANSI escape codes (cursor positioning via `\x1b[...`) before Ink takes over
- Key insight: the non-Static area is kept **small** (just a spinner + input area), so scroll impact is minimal

### Gemini CLI (`google-gemini/gemini-cli`)
Two rendering modes, both using Ink (a custom fork with `overflow: scroll`):

**Standard mode (default, `useAlternateBuffer: false`):**
- `<Static>` for completed conversation history — native terminal scrollback works
- Spinner (`ink-spinner` wrapped in color-cycling gradient) renders below Static
- Smart message splitting: `findLastSafeSplitPoint()` breaks accumulated content at safe markdown boundaries
- Pending items are separate from committed history
- The non-Static area stays small: spinner + input composer

**Alternate buffer mode:**
- Full TUI with virtual `<ScrollableList>`, mouse scrolling, animated scrollbar
- No native terminal scrollback (same as vim/less)
- Was reverted to off-by-default due to copy/paste and scroll issues

**Key takeaway from both:** The non-Static area must be tiny. Both projects emit content to Static progressively and keep only the spinner/input as non-Static.

### Ink's `<Static>` Component Behavior
- Items passed to `<Static>` are rendered once and committed to terminal scrollback
- They are never re-rendered or updated
- New items append to the bottom of the Static output
- Non-Static content renders below all Static output and is fully redrawn on every state change

## Proposed Approach

### Progressive Static Emission
Instead of accumulating all current section content in non-Static space, emit each piece to Static as it arrives:

```
Static items (scrollback-safe, emitted progressively):
  ┌─ work (iteration 1) ─────────   ← emitted on 'step' event
  │ ┌─ request ──────────────────   ← emitted on 'prompt' event
  │ │ request text...
  │ └────────────────────────────
  │ response line 1                  ← emitted per 'line' event
  │ response line 2
  │ response line 3

Non-Static (tiny, at bottom):
  ⠋ responding...                    ← spinner, safe to animate
  status bar
```

**Trade-offs:**
- Cannot use Ink `<Box borderStyle="single">` for section boxes (requires knowing all children at render time)
- Must use Unicode box-drawing characters (`┌`, `│`, `└`, `─`) as text prefixes in Static items
- Section "boxes" are built incrementally rather than as complete bordered components
- The visual result is similar but not pixel-identical to current Ink Box borders
- On section completion, a closing border (`└──`) is emitted to Static

### Data Model Change
```
Current:
  completedSections: Section[]     // → Static (boxed)
  currentSection: Section | null   // → non-Static (ENTIRE section, PROBLEM)

Proposed:
  staticItems: StaticItem[]        // → Static (everything emitted progressively)
  activeStep: { step, iteration } | null  // metadata only, no content

StaticItem =
  | { type: 'section-header', step, iteration }
  | { type: 'request', text }
  | { type: 'response-line', text }
  | { type: 'section-close' }
```

### Non-Static Area
Only contains:
1. Animated spinner with step label (e.g., `⠋ responding...`) — safe to animate since it's ~1 line
2. StatusBar — updates only on meaningful state changes (no timer)

### Alternative: Completed-Box Approach
Instead of incremental box-drawing, emit plain lines during streaming and render the complete boxed section to Static only when the section finishes. Simpler implementation but lines appear unstyled during streaming and then a duplicate boxed version appears.

**Rejected** because it would show content twice or require clearing, which Ink's Static doesn't support.
