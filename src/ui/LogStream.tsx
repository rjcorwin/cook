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

// --- Box-drawing helpers ---

function sectionColor(step: string): string {
  return STEP_COLORS[step] ?? 'white'
}

function renderSectionHeader(step: string, iteration: number, width: number): string {
  const label = ` ${step} (iteration ${iteration}) `
  const pad = Math.max(0, width - label.length - 3)
  return `┌─${label}${'─'.repeat(pad)}`
}

function renderSectionClose(width: number): string {
  return `└${'─'.repeat(Math.max(0, width - 2))}`
}

function renderResponseLine(text: string): string {
  return `│ ${text}`
}

// --- StaticLine component ---

function StaticLine({ item, width }: { item: StaticItem; width: number }) {
  const color = sectionColor(item.step)

  switch (item.type) {
    case 'section-header':
      return <Text color={color} bold>{renderSectionHeader(item.step, item.iteration, width)}</Text>

    case 'request': {
      const lines = item.text.split('\n')
      const innerWidth = Math.max(0, width - 5)
      const headerLine = `│ ┌─ request ${'─'.repeat(Math.max(0, innerWidth - 10))}`
      const closeLine = `│ └${'─'.repeat(Math.max(0, innerWidth))}`
      return (
        <Box flexDirection="column">
          <Text color="yellow">{headerLine}</Text>
          {lines.map((line, i) => (
            <Text key={i} color="yellow">{`│ │ ${line}`}</Text>
          ))}
          <Text color="yellow">{closeLine}</Text>
        </Box>
      )
    }

    case 'line':
      return <Text color="magenta">{renderResponseLine(item.text)}</Text>

    case 'section-close':
      return <Text color={color}>{renderSectionClose(width)}</Text>

    case 'done':
      return <Text color="green" bold>{`✓ Done`}</Text>
  }
}

// --- ActiveFooter (spinner + status) ---

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

interface ActiveFooterProps {
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
}

function ActiveFooter({ step, iteration, maxIterations, model, startTime, logFile }: ActiveFooterProps) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const status = `${step} ${iteration}/${maxIterations}`
  const line = `${SPINNER_FRAMES[frame]} ${status} | ${model} | ${formatElapsed(elapsed)} | ${logFile}`

  return <Text color="cyan">{line}</Text>
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
}

export function LogStream({ items, active, step, iteration, maxIterations, model, startTime, logFile }: LogStreamProps) {
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
        />
      )}
    </Box>
  )
}
