# Decision: Status Bar Animation Style

**Status:** Proposed
**Date:** 2026-03-01
**Deciders:** rjcorwin

## Context
The ActiveFooter status bar needs an animated element to give it more visual character. It already re-renders at 80ms (12.5fps) for the braille spinner, so any animation is free in terms of performance. The animation must fit in a fixed-height area (ideally single line, max 3 lines) and feel thematic to "cook."

## Options

### Option 1: Inline Flame (single line)
Animated flame characters cycle at the start of the status line, replacing the braille spinner.

```
Frame 0: ┌────────────────────────────────────────────┐
         │ )  work 1/3 | opus | 12s | .cook/logs/... │
         └────────────────────────────────────────────┘

Frame 1: ┌────────────────────────────────────────────┐
         │ }  work 1/3 | opus | 12s | .cook/logs/... │
         └────────────────────────────────────────────┘

Frame 2: ┌────────────────────────────────────────────┐
         │ )  work 1/3 | opus | 12s | .cook/logs/... │
         └────────────────────────────────────────────┘

Frame 3: ┌────────────────────────────────────────────┐
         │ ]  work 1/3 | opus | 12s | .cook/logs/... │
         └────────────────────────────────────────────┘
```

Flame characters cycle: `)`, `}`, `)`, `]`, `>`, `}` — colored orange/red/yellow.

**Pros:**
- Minimal, doesn't increase footer height
- Replaces spinner cleanly

**Cons:**
- Subtle, might not read as "flame" to everyone
- Single character has limited expressiveness

### Option 2: Multi-Char Flame Strip (single line)
A wider animated flame pattern using block/shade characters at the left edge.

```
Frame 0: ┌────────────────────────────────────────────────┐
         │ ░▒▓█▓▒░  work 1/3 | opus | 12s | .cook/...   │
         └────────────────────────────────────────────────┘

Frame 1: ┌────────────────────────────────────────────────┐
         │ ▒▓█▓▒░░  work 1/3 | opus | 12s | .cook/...   │
         └────────────────────────────────────────────────┘

Frame 2: ┌────────────────────────────────────────────────┐
         │ ▓█▓▒░░▒  work 1/3 | opus | 12s | .cook/...   │
         └────────────────────────────────────────────────┘
```

The `░▒▓█` pattern shifts/rotates, colored with a red→orange→yellow gradient.

**Pros:**
- More visually distinctive than a single character
- Block characters render reliably across terminals
- Gradient conveys heat/energy

**Cons:**
- Takes ~8 chars of horizontal space
- May feel busy

### Option 3: Campfire (3-line footer)
A small ASCII campfire above the status line. Footer grows from 3 lines (with border) to 5 lines.

```
Frame 0: ┌────────────────────────────────────────────┐
         │      (    )                                │
         │       )  (     cooking...                  │
         │  ─=≡═══════≡=─                            │
         │  work 1/3 | opus | 12s | .cook/logs/...   │
         └────────────────────────────────────────────┘

Frame 1: ┌────────────────────────────────────────────┐
         │       )  (                                 │
         │      (    )    cooking...                  │
         │  ─=≡═══════≡=─                            │
         │  work 1/3 | opus | 12s | .cook/logs/...   │
         └────────────────────────────────────────────┘
```

Flame wisps alternate above a grill/grate line.

**Pros:**
- Most visually striking and thematic
- Clear "cooking" metaphor
- Room for personality

**Cons:**
- Increases non-Static area to 7 lines (with border)
- More complex to implement
- Takes vertical space from scrollback content

### Option 4: Simmering Pot (2-line footer)
A pot with animated steam above the status line.

```
Frame 0: ┌────────────────────────────────────────────┐
         │  ~  ~  ~                                   │
         │  ╰──────╯  work 1/3 | opus | 12s | ...    │
         └────────────────────────────────────────────┘

Frame 1: ┌────────────────────────────────────────────┐
         │   ~  ~  ~                                  │
         │  ╰──────╯  work 1/3 | opus | 12s | ...    │
         └────────────────────────────────────────────┘

Frame 2: ┌────────────────────────────────────────────┐
         │  ~  ~   ~                                  │
         │  ╰──────╯  work 1/3 | opus | 12s | ...    │
         └────────────────────────────────────────────┘
```

Steam tildes drift left/right above a pot. Status text sits next to the pot.

**Pros:**
- Strong cooking theme
- Only 2 content lines (4 with border)
- Charming and distinctive

**Cons:**
- 2 lines of content vs current 1
- Steam drift animation needs careful character positioning

### Option 5: Color-Cycling Border
Keep the current single-line layout but animate the box border color through a fire palette.

```
Frame 0: border=red,     text=red
Frame 1: border=yellow,  text=yellow
Frame 2: border=#ff8c00, text=#ff8c00  (orange, via 256-color)
Frame 3: border=red,     text=red
```

The border and text pulse through fire colors (red → orange → yellow → orange → red).

**Pros:**
- Zero layout change, pure color animation
- Works with current single-line content
- Subtle but warm

**Cons:**
- Least distinctive of all options
- Requires 256-color support for orange (fallback to red/yellow)

## Decision
[Pending — awaiting human review]

## Consequences
### Positive
- Visual personality for the tool
- Clear "something is happening" feedback

### Negative
- Multi-line options reduce visible scrollback area
- More animation frames = more code to maintain

### Neutral
- Animation piggybacks on existing 80ms timer, no perf impact
