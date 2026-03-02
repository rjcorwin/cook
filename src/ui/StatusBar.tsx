import React from 'react'
import { Box, Text, useStdout } from 'ink'

interface StatusBarProps {
  step: string
  iteration: number
  maxIterations: number
  model: string
  elapsed: number
  logFile: string
  done: boolean
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

export function StatusBar({ step, iteration, maxIterations, model, elapsed, logFile, done }: StatusBarProps) {
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  const status = done
    ? 'done'
    : `${step} ${iteration}/${maxIterations}`

  const bar = `${status} | ${model} | ${formatElapsed(elapsed)} | ${logFile}`

  return (
    <Box borderStyle="single" width={width}>
      <Text>{bar}</Text>
    </Box>
  )
}
