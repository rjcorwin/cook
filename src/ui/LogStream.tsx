import React, { useState, useEffect } from 'react'
import { Static, Box, Text, useStdout } from 'ink'

// --- Static item types ---

export type StaticItem =
  | { id: number; type: 'section-header'; step: string; iteration: number }
  | { id: number; type: 'request'; step: string; text: string }
  | { id: number; type: 'line'; step: string; text: string }
  | { id: number; type: 'section-close'; step: string }
  | { id: number; type: 'done'; step: string }

const STEP_COLORS: Record<string, string> = {
  work: 'red',
  review: 'green',
  gate: 'blue',
}

// --- Helpers ---

function stepColor(step: string): string {
  return STEP_COLORS[step] ?? 'white'
}

function renderSeparator(step: string, iteration: number, width: number): string {
  const label = ` ${step} (iteration ${iteration}) `
  const side = Math.max(0, Math.floor((width - label.length) / 2))
  const extra = (width - label.length) % 2
  return `${'━'.repeat(side)}${label}${'━'.repeat(side + extra)}`
}

// --- StaticLine component ---

function StaticLine({ item, width }: { item: StaticItem; width: number }) {
  const color = stepColor(item.step)

  switch (item.type) {
    case 'section-header':
      return (
        <Box flexDirection="column">
          <Text>{' '}</Text>
          <Text color={color} bold>{renderSeparator(item.step, item.iteration, width)}</Text>
        </Box>
      )

    case 'request': {
      const lines = item.text.split('\n')
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">{`▌ ${lines[0]}`}</Text>
          {lines.slice(1).map((line, i) => (
            <Text key={i} color="gray">{`  ${line}`}</Text>
          ))}
        </Box>
      )
    }

    case 'line':
      return <Text>{item.text}</Text>

    case 'section-close':
      return null

    case 'done':
      return <Text color="green" bold>{`✓ Done`}</Text>
  }
}

// --- ActiveFooter animations ---

import type { AnimationStyle } from '../config.js'

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

// flame
const FLAME_CHARS = [')', '}', ')', ']', '>', '}']
const FLAME_COLORS = ['red', 'yellow', '#ff8c00', 'red', 'yellow', '#ff8c00']

// strip
const STRIP_CHARS = ['░', '▒', '▓', '█', '▓', '▒', '░', ' ']
const STRIP_COLORS = ['yellow', '#ff8c00', 'red', 'red', 'red', '#ff8c00', 'yellow', 'white']

function flameStrip(frame: number): Array<{ char: string; color: string }> {
  const len = STRIP_CHARS.length
  return Array.from({ length: 7 }, (_, i) => {
    const idx = (frame + i) % len
    return { char: STRIP_CHARS[idx], color: STRIP_COLORS[idx] }
  })
}

// campfire
const FIRE_FRAMES = [
  ['   (    )  ', '    )  (   ', ' ─=≡════≡=─'],
  ['    )  (   ', '   (    )  ', ' ─=≡════≡=─'],
  ['  (   )    ', '    (   )  ', ' ─=≡════≡=─'],
  ['    ) (    ', '  )    (   ', ' ─=≡════≡=─'],
]
const FIRE_LINE_COLORS = ['yellow', '#ff8c00', 'gray']

// pot
const STEAM_FRAMES = [
  ' ~  ~  ~ ',
  '  ~  ~  ~',
  ' ~  ~   ~',
  '  ~ ~  ~ ',
  '~  ~  ~  ',
  ' ~   ~ ~ ',
]

// pulse
const PULSE_COLORS = ['red', '#ff8c00', 'yellow', '#ff8c00', 'red', '#cc0000']

interface ActiveFooterProps {
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
  animation: AnimationStyle
}

function ActiveFooter({ step, iteration, maxIterations, model, startTime, logFile, animation }: ActiveFooterProps) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => f + 1)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const status = `${step} ${iteration}/${maxIterations}`
  const info = `${status} | ${model} | ${formatElapsed(elapsed)} | ${logFile}`
  const f = Math.floor(frame / 3)

  switch (animation) {
    case 'flame': {
      const idx = f % FLAME_CHARS.length
      return (
        <Box borderStyle="single" borderColor="#ff8c00">
          <Text color={FLAME_COLORS[idx]}>{FLAME_CHARS[idx]}</Text>
          <Text color="#ff8c00">{` ${info}`}</Text>
        </Box>
      )
    }

    case 'strip': {
      const strip = flameStrip(f)
      return (
        <Box borderStyle="single" borderColor="#ff8c00">
          {strip.map((s, i) => (
            <Text key={i} color={s.color}>{s.char}</Text>
          ))}
          <Text color="#ff8c00">{`  ${info}`}</Text>
        </Box>
      )
    }

    case 'campfire': {
      const fire = FIRE_FRAMES[f % FIRE_FRAMES.length]
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#ff8c00">
          {fire.map((line, i) => (
            <Text key={i} color={FIRE_LINE_COLORS[i]}>{line}</Text>
          ))}
          <Text color="#ff8c00">{info}</Text>
        </Box>
      )
    }

    case 'pot': {
      const steam = STEAM_FRAMES[f % STEAM_FRAMES.length]
      return (
        <Box flexDirection="column" borderStyle="single" borderColor="#ff8c00">
          <Text color="gray">{steam}</Text>
          <Text color="#ff8c00">{`╰──────╯  ${info}`}</Text>
        </Box>
      )
    }

    case 'pulse': {
      const c = PULSE_COLORS[f % PULSE_COLORS.length]
      return (
        <Box borderStyle="single" borderColor={c}>
          <Text color={c}>{`🔥 ${info}`}</Text>
        </Box>
      )
    }
  }
}

// --- LogStream ---

interface LogStreamProps {
  items: StaticItem[]
  active: boolean
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
  animation: AnimationStyle
}

export function LogStream({ items, active, step, iteration, maxIterations, model, startTime, logFile, animation }: LogStreamProps) {
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) => (
          <Box key={item.id}>
            <StaticLine item={item} width={width} />
          </Box>
        )}
      </Static>
      {active && (
        <ActiveFooter
          step={step}
          iteration={iteration}
          maxIterations={maxIterations}
          model={model}
          startTime={startTime}
          logFile={logFile}
          animation={animation}
        />
      )}
    </Box>
  )
}
