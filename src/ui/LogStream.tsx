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

  return (
    <Box borderStyle="single" borderColor="cyan">
      <Text color="cyan">{line}</Text>
    </Box>
  )
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
