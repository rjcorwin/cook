# Plan: TUI Scroll-to-Bottom Fix

**Status:** Draft
**Author:** AI
**Created:** 2026-03-01

## Summary
Refactor the TUI rendering so all content is emitted progressively to Ink's `<Static>` component (terminal scrollback), leaving only a tiny non-Static footer (spinner + status bar). This eliminates the scroll-to-bottom yank caused by re-rendering large non-Static content on every state change.

## Motivation
Users cannot scroll up to read earlier output because every spinner tick (80ms) and every new line redraws the entire active section in Ink's non-Static area, forcing the terminal to scroll to the bottom. Both mew-protocol and gemini-cli solve this by keeping the non-Static area to 1-2 lines.

## Goals
- Preserve terminal scrollback — user can scroll up without being yanked back
- Animated spinner for active step feedback
- Visual distinction between work/review/gate sections (colored)
- Visual distinction between request and response within sections
- `--hide-request` flag continues to work

## Non-Goals
- Alternate screen buffer mode
- Mouse scrolling support
- Full Ink `<Box>` borders around streaming content (incompatible with progressive Static emission)

## Technical Design

### New Data Model

Replace `completedSections`/`currentSection` with a flat list of Static items and minimal active step metadata:

```typescript
// Each item emitted to Static once, never updated
type StaticItem =
  | { id: number; type: 'section-header'; step: string; iteration: number }
  | { id: number; type: 'request'; step: string; text: string }
  | { id: number; type: 'line'; step: string; text: string }
  | { id: number; type: 'section-close'; step: string }

interface AppState {
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
  items: StaticItem[]       // progressive Static items
  active: boolean           // is a step currently running?
  showRequest: boolean
  done: boolean
  error: string | null
}
```

Each `StaticItem` carries a `step` field so the renderer can color it appropriately. The `id` field is a monotonically increasing counter used as the React key for `<Static>`.

### Visual Output

Using Unicode box-drawing characters as colored text prefixes instead of Ink `<Box>` borders:

```
┌─ work (iteration 1) ─────────────────   ← section-header (red)
│ ┌─ request ──────────────────────────   ← request start (yellow)
│ │ Step: work | Iteration: 1/3          ← request body lines (yellow │ prefix)
│ │ ### Task
│ │ Write the fizzbuzz function...
│ └────────────────────────────────────   ← request end (yellow)
│ response line 1                         ← line (magenta │ prefix)
│ response line 2
│ response line 3
└──────────────────────────────────────   ← section-close (red)
```

When `--hide-request` is used, the request items are simply not emitted.

The non-Static area at the bottom:
```
⠋ work 1/3 | opus | 45s | .cook/logs/...   ← spinner + status (1 line)
```

### Rendering Architecture

```
<Box column>
  <Static items={state.items}>             ← ALL content, scrollback-safe
    {(item) => <StaticLine item={item} />} ← renders each item type
  </Static>
  {state.active && <ActiveFooter />}       ← spinner line (~1 line, non-Static)
  {state.error && <ErrorDisplay />}
</Box>
```

No separate `<StatusBar>` component — merge the status info into the spinner line to minimize non-Static height. When done, the footer disappears entirely (everything is in Static).

### Component Changes

**`StaticLine` (new, in LogStream.tsx):** Renders a single `StaticItem` as a `<Text>` element with appropriate box-drawing prefix and color based on item type and step.

**`ActiveFooter` (new, in LogStream.tsx):** The animated spinner combined with status info. Single line: `⠋ work 1/3 | opus | 45s | logfile`. Uses `useState`/`setInterval` for spinner animation. This is the only component that triggers re-renders, and it's ~1 line tall, so scroll impact is negligible.

**`LogStream` (rewrite):** Takes `items` and renders them through `<Static>`. Takes `active`/status props and renders `<ActiveFooter>` when active.

**`StatusBar` (remove):** Merged into `ActiveFooter`.

**`App` (rewrite state management):** Event handlers append `StaticItem` entries to `items` array instead of building up section objects.

### Event Handler Changes in App.tsx

| Event | Current behavior | New behavior |
|-------|-----------------|--------------|
| `step` | Finalize currentSection → completedSections, create new currentSection | Emit `section-close` for previous step (if any), emit `section-header` for new step, set `active: true` |
| `prompt` | Set `currentSection.request` | Emit `request` item (if `showRequest`) |
| `line` | Append to `currentSection.lines` | Emit `line` item |
| `done` | Finalize currentSection → completedSections | Emit `section-close`, set `active: false, done: true` |
| `error` | Set error | Emit `section-close` (if active), set `active: false, error` |

### Box-Drawing Helper

A utility function to generate the colored text lines:

```typescript
function renderStaticItem(item: StaticItem, width: number): { text: string; color: string } {
  const color = STEP_COLORS[item.step] ?? 'white'
  switch (item.type) {
    case 'section-header': {
      const label = ` ${item.step} (iteration ${item.iteration}) `
      const line = `┌─${label}${'─'.repeat(Math.max(0, width - label.length - 3))}`
      return { text: line, color }
    }
    case 'request': {
      // Multi-line: split text, prefix each line with │
      // First line: │ ┌─ request ────
      // Body lines: │ │ text
      // Last line:  │ └─────────────
      ...
    }
    case 'line':
      return { text: `│ ${item.text}`, color: 'magenta' }
    case 'section-close': {
      return { text: `└${'─'.repeat(Math.max(0, width - 1))}`, color }
    }
  }
}
```

The request block is emitted as a single `StaticItem` with `type: 'request'` containing the full text. The `StaticLine` component splits it into multiple `<Text>` lines within one Static entry, drawing the yellow sub-box with `│ ┌─`, `│ │`, `│ └─` prefixes.

## Implementation Approach

### Step 1: Define StaticItem types and box-drawing helper
- Add `StaticItem` type union to `LogStream.tsx`
- Write `StaticLine` component that renders each item type with box-drawing characters and colors
- Write unit-testable `formatSectionHeader`, `formatRequestBlock`, `formatResponseLine`, `formatSectionClose` helpers

### Step 2: Write ActiveFooter component
- Combine spinner animation with status bar info into a single line
- `useState` + `setInterval` for spinner frames
- Props: step, iteration, maxIterations, model, startTime, logFile

### Step 3: Rewrite App.tsx state and event handlers
- Replace `completedSections`/`currentSection` with `items: StaticItem[]` and `active: boolean`
- Add `nextId` counter (via `useRef`) for unique Static keys
- Rewrite each event handler per the table above
- Track `showRequest` to conditionally emit request items

### Step 4: Rewrite LogStream component
- Accept `items` and render through `<Static>`
- Accept active/status props and render `<ActiveFooter>` below Static

### Step 5: Remove StatusBar
- Delete `StatusBar.tsx`
- Remove StatusBar import/usage from App.tsx

### Step 6: Verify and clean up
- Build (`npm run build`)
- Manual test: confirm scrollback works, spinner animates, sections display correctly
- Test `--hide-request` flag
- Remove unused `Section` interface and old `SectionBox`/`Spinner` components

## Alternatives Considered

### Keep Ink `<Box>` borders, emit completed sections to Static
Keep the current `SectionBox` for completed sections in Static, but stream individual lines to Static during the active step instead of accumulating them in non-Static. The section would have no border during streaming, then a bordered version would appear when complete.

**Rejected:** Would show duplicate content (unborders lines then bordered section) or require clearing, which Static doesn't support.

### Use alternate screen buffer
Full TUI mode like vim/less, managing all scrolling ourselves.

**Rejected:** Loses native terminal scrollback, copy/paste issues (gemini-cli reverted this to off-by-default for these reasons).

### Fork Ink for overflow:scroll
Gemini CLI's approach — fork Ink to add scrollable containers.

**Rejected:** Too much complexity for cook's needs. We want a simple streaming output tool, not a full TUI framework.
