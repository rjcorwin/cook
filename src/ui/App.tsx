import React, { useState, useEffect } from 'react'
import { Box, Text, useApp } from 'ink'
import { LogStream, type Section } from './LogStream.js'
import { StatusBar } from './StatusBar.js'
import { loopEvents } from '../loop.js'

interface AppState {
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
  completedSections: Section[]
  currentSection: Section | null
  done: boolean
  error: string | null
}

interface AppProps {
  maxIterations: number
  model: string
}

export function App({ maxIterations, model }: AppProps) {
  const { exit } = useApp()

  const [state, setState] = useState<AppState>({
    step: 'starting',
    iteration: 1,
    maxIterations,
    model,
    startTime: Date.now(),
    logFile: '',
    completedSections: [],
    currentSection: null,
    done: false,
    error: null,
  })

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const onLogFile = (logFile: string) => setState(s => ({ ...s, logFile }))
    const onStep = ({ step, iteration }: { step: string; iteration: number }) =>
      setState(s => {
        const completed = s.currentSection
          ? [...s.completedSections, s.currentSection]
          : s.completedSections
        return {
          ...s,
          step,
          iteration,
          completedSections: completed,
          currentSection: { step, iteration, lines: [] },
        }
      })
    const onLine = (line: string) =>
      setState(s => {
        if (!s.currentSection) return s
        return {
          ...s,
          currentSection: {
            ...s.currentSection,
            lines: [...s.currentSection.lines, line],
          },
        }
      })
    const onDone = () => setState(s => {
      const completed = s.currentSection
        ? [...s.completedSections, s.currentSection]
        : s.completedSections
      return { ...s, completedSections: completed, currentSection: null, done: true }
    })
    const onError = (err: string) => setState(s => ({ ...s, error: err }))

    loopEvents.on('logFile', onLogFile)
    loopEvents.on('step', onStep)
    loopEvents.on('line', onLine)
    loopEvents.on('done', onDone)
    loopEvents.on('error', onError)

    return () => {
      loopEvents.off('logFile', onLogFile)
      loopEvents.off('step', onStep)
      loopEvents.off('line', onLine)
      loopEvents.off('done', onDone)
      loopEvents.off('error', onError)
    }
  }, [])

  useEffect(() => {
    if (state.done || state.error) exit()
  }, [state.done, state.error, exit])

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [state.startTime])

  return (
    <Box flexDirection="column" height="100%">
      <LogStream
        completedSections={state.completedSections}
        currentSection={state.currentSection}
      />

      {state.error && (
        <Box marginTop={1}>
          <Text color="red" bold>Error: {state.error}</Text>
        </Box>
      )}

      <StatusBar
        step={state.step}
        iteration={state.iteration}
        maxIterations={state.maxIterations}
        model={state.model}
        elapsed={elapsed}
        logFile={state.logFile}
        done={state.done}
      />
    </Box>
  )
}
