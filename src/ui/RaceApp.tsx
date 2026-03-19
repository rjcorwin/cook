import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useStdout } from 'ink'
import type { EventEmitter } from 'events'
import type { AnimationStyle } from '../config.js'

export interface RunState {
  id: number
  status: 'waiting' | 'running' | 'done' | 'error' | 'rate-limited'
  step: string
  iteration: number
  maxIterations: number
  startTime: number
  logFile: string
  error?: string
  nextRetryAt?: Date
}

interface RaceAppProps {
  runCount: number
  maxIterations: number
  emitters: EventEmitter[]
  animation: AnimationStyle
  title?: string
  runLabel?: string
  runLabels?: string[]
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`
}

function progressBar(iteration: number, maxIterations: number, step: string, width: number): string {
  const stepsPerIteration = 3 // work, review, gate
  const stepIndex = step === 'work' ? 0 : step === 'review' ? 1 : 2
  const completed = (iteration - 1) * stepsPerIteration + stepIndex
  const total = maxIterations * stepsPerIteration
  const filled = Math.round((completed / total) * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

const STATUS_COLORS: Record<string, string> = {
  waiting: 'gray',
  running: 'yellow',
  done: 'green',
  error: 'red',
  'rate-limited': '#ff8c00',
}

function formatCountdown(target: Date): string {
  const remaining = Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000))
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RaceApp({ runCount, maxIterations, emitters, animation, title, runLabel = 'Run', runLabels }: RaceAppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const barWidth = Math.min(20, Math.floor((stdout?.columns ?? 80) / 4))

  const [runs, setRuns] = useState<RunState[]>(() =>
    Array.from({ length: runCount }, (_, i) => ({
      id: i + 1,
      status: 'waiting',
      step: '',
      iteration: 0,
      maxIterations,
      startTime: Date.now(),
      logFile: '',
    }))
  )

  const [tick, setTick] = useState(0)

  // Timer for elapsed time updates
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Wire up per-run event emitters
  useEffect(() => {
    const updateRun = (index: number, patch: Partial<RunState>) => {
      setRuns(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r))
    }

    const cleanups: (() => void)[] = []

    for (let i = 0; i < emitters.length; i++) {
      const em = emitters[i]

      const onLogFile = (logFile: string) => updateRun(i, { logFile })
      const onStep = ({ step, iteration }: { step: string; iteration: number }) =>
        updateRun(i, { step, iteration, status: 'running' })
      const onDone = () => updateRun(i, { status: 'done' })
      const onError = (err: string) => updateRun(i, { status: 'error', error: err })
      const onWaiting = ({ nextRetryAt }: { nextRetryAt: Date }) =>
        updateRun(i, { status: 'rate-limited', nextRetryAt })
      const onRetry = () =>
        updateRun(i, { status: 'running', nextRetryAt: undefined })

      em.on('logFile', onLogFile)
      em.on('step', onStep)
      em.on('done', onDone)
      em.on('error', onError)
      em.on('waiting', onWaiting)
      em.on('retry', onRetry)

      cleanups.push(() => {
        em.off('logFile', onLogFile)
        em.off('step', onStep)
        em.off('done', onDone)
        em.off('error', onError)
        em.off('waiting', onWaiting)
        em.off('retry', onRetry)
      })
    }

    return () => cleanups.forEach(fn => fn())
  }, [emitters])

  // Exit when all runs are finished
  const allDone = runs.every(r => r.status === 'done' || r.status === 'error')
  useEffect(() => {
    if (allDone) exit()
  }, [allDone, exit])

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="#ff8c00">{title ?? `cook race \u2014 ${runCount} runs`}</Text>
      </Box>

      {runs.map(run => {
        const elapsed = Math.floor((Date.now() - run.startTime) / 1000)
        const bar = run.status === 'done'
          ? '\u2588'.repeat(barWidth)
          : run.status === 'error'
          ? '\u2591'.repeat(barWidth)
          : run.iteration > 0
          ? progressBar(run.iteration, run.maxIterations, run.step, barWidth)
          : '\u2591'.repeat(barWidth)

        const stepLabel = run.status === 'rate-limited' && run.nextRetryAt
          ? `retry in ${formatCountdown(run.nextRetryAt)}`
          : run.status === 'done' || run.status === 'error' || !run.step
          ? ''
          : `${run.step} ${run.iteration}/${run.maxIterations}`

        return (
          <Box key={run.id} gap={1}>
            <Text bold>{runLabels ? runLabels[run.id - 1] : `${runLabel} ${run.id}`}</Text>
            <Text color={run.status === 'done' ? 'green' : run.status === 'error' ? 'red' : '#ff8c00'}>{bar}</Text>
            <Text>{stepLabel.padEnd(14)}</Text>
            <Text color="gray">{formatElapsed(elapsed).padStart(6)}</Text>
            <Text color={STATUS_COLORS[run.status]}>{run.status}</Text>
          </Box>
        )
      })}

      {allDone && (
        <Box marginTop={1}>
          <Text color="green" bold>{'\u2713 All runs complete'}</Text>
        </Box>
      )}
    </Box>
  )
}
