import React, { useState, useEffect } from 'react'
import { Box, Text, useApp } from 'ink'
import { LogStream } from './LogStream.js'
import { StatusBar } from './StatusBar.js'
import { loopEvents } from '../loop.js'

interface AppState {
  step: string
  iteration: number
  maxIterations: number
  model: string
  startTime: number
  logFile: string
  logLines: string[]
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
    logLines: [],
    done: false,
    error: null,
  })

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const onLogFile = (logFile: string) => setState(s => ({ ...s, logFile }))
    const onStep = ({ step, iteration }: { step: string; iteration: number }) =>
      setState(s => ({ ...s, step, iteration }))
    const onLine = (line: string) =>
      setState(s => ({ ...s, logLines: [...s.logLines, line] }))
    const onDone = () => setState(s => ({ ...s, done: true }))
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
      <LogStream lines={state.logLines} />

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
