# Research: Status Bar ASCII Animation

**Requester:** rjcorwin
**Date:** 2026-03-01

## Requirements

### Original Request
Add an ASCII animation (like a flame) to the status bar footer to give it more visual character while cook is running.

### Context
The status bar (`ActiveFooter` in `LogStream.tsx`) is the only non-Static element in the TUI. It already animates a braille spinner at 80ms intervals inside a cyan-bordered box. Since it's already re-rendering at 80ms, adding a more elaborate animation has zero additional cost — we're just changing what gets drawn each frame.

Current footer:
```
┌──────────────────────────────────────────────────────┐
│ ⠋ work 1/3 | opus | 45s | .cook/logs/2026-03-01.md  │
└──────────────────────────────────────────────────────┘
```

### Constraints
- Animation must fit within a single-line bordered box (the footer)
- Must not increase the height of the non-Static area (scroll-safety)
- Already have a 80ms setInterval driving the spinner — animation piggybacks on this
- Characters must render correctly in common terminal emulators (iTerm2, Terminal.app, GNOME Terminal, Windows Terminal)
- Should feel thematic — "cook" is a cooking/chef metaphor

### Open Questions
- Single-line only, or could we go to 2-3 lines (still fixed height)?
- Should the animation replace the braille spinner or live alongside it?
- Positioned at the start of the line, end, or wrapping the content?

## System Architecture

### Current ActiveFooter
```typescript
// LogStream.tsx:88-107
function ActiveFooter({ step, iteration, maxIterations, model, startTime, logFile }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  const line = `${SPINNER_FRAMES[frame]} ${status} | ${model} | ${elapsed} | ${logFile}`
  return (
    <Box borderStyle="single" borderColor="cyan">
      <Text color="cyan">{line}</Text>
    </Box>
  )
}
```

The `frame` counter already cycles at 80ms. Any animation just needs to index into its own frame array using this same counter (or a modulo of it for slower animations).

### Integration Points
- `SPINNER_FRAMES` array (currently braille dots) — could be replaced or supplemented
- The `line` template string — animation characters can be prepended, appended, or embedded
- The `Box` border — could potentially be animated (changing `borderColor` per frame)
- Frame rate: 80ms = 12.5fps. Can slow individual animations by using `Math.floor(frame / N)` for every-Nth-frame updates.

## Prior Art

### MEW Protocol Startup Animation
Uses multi-frame ASCII art with ANSI colors for a crystal-forming animation. Renders directly via `process.stdout.write` with cursor movement (pre-Ink). Uses block characters (`▄`, `█`, `◢`, `◣`, `◆`, `◇`) and 256-color ANSI codes.

### Common Terminal Animation Patterns
- **Fire/flame:** Uses characters like `░▒▓█` or Unicode fire-related chars (`🔥` emoji, or ASCII art with `(`, `)`, `{`, `}`, `^`)
- **Cooking:** Pot with steam, pan with flame, chef hat
- **Wave/pulse:** Characters that create a rippling effect (`~`, `≈`, `∿`)
- **Gradient cycling:** Same characters but cycling through colors

## Animation Options

See `decision-w3j-animation-style.md` for detailed options and mockups.
