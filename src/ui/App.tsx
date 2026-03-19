import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useApp } from 'ink'
import { LogStream, type StaticItem } from './LogStream.js'
import type { AgentName, AnimationStyle } from '../config.js'
import { loopEvents } from '../loop.js'

interface AppState {
  step: string
  iteration: number
  maxIterations: number
  agent: AgentName
  model: string
  startTime: number
  logFile: string
  active: boolean
  done: boolean
  error: string | null
  waiting: boolean
  nextRetryAt: Date | null
}

interface AppProps {
  maxIterations: number
  agent: AgentName
  model: string
  showRequest: boolean
  animation: AnimationStyle
}

function formatCountdown(target: Date): string {
  const remaining = Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000))
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function App({ maxIterations, agent, model, showRequest, animation }: AppProps) {
  const { exit } = useApp()
  const nextId = useRef(0)
  const itemsRef = useRef<StaticItem[]>([])

  const [state, setState] = useState<AppState>({
    step: 'starting',
    iteration: 1,
    maxIterations,
    agent,
    model,
    startTime: Date.now(),
    logFile: '',
    active: false,
    done: false,
    error: null,
    waiting: false,
    nextRetryAt: null,
  })

  useEffect(() => {
    const getId = () => nextId.current++

    const onLogFile = (logFile: string) => setState(s => ({ ...s, logFile }))

    const onStep = ({ step, iteration, agent, model }: { step: string; iteration: number; agent: AgentName; model: string }) =>
      setState(s => {
        if (s.active) {
          itemsRef.current.push({ id: getId(), type: 'section-close', step: s.step })
        }
        itemsRef.current.push({ id: getId(), type: 'section-header', step, iteration })
        return { ...s, step, iteration, agent, model, active: true }
      })

    const onPrompt = (prompt: string) =>
      setState(s => {
        if (!showRequest) return s
        itemsRef.current.push({ id: getId(), type: 'request', step: s.step, text: prompt })
        return { ...s }
      })

    const onLine = (line: string) =>
      setState(s => {
        itemsRef.current.push({ id: getId(), type: 'line', step: s.step, text: line })
        return { ...s }
      })

    const onDone = () =>
      setState(s => {
        if (s.active) {
          itemsRef.current.push({ id: getId(), type: 'section-close', step: s.step })
        }
        itemsRef.current.push({ id: getId(), type: 'done', step: s.step })
        return { ...s, active: false, done: true }
      })

    const onError = (err: string) =>
      setState(s => {
        if (s.active) {
          itemsRef.current.push({ id: getId(), type: 'section-close', step: s.step })
        }
        return { ...s, active: false, error: err }
      })

    const onWaiting = ({ nextRetryAt }: { error: Error; nextRetryAt: Date; attempt: number }) =>
      setState(s => {
        itemsRef.current.push({ id: getId(), type: 'line', step: s.step, text: `Rate limited — waiting for retry...` })
        return { ...s, waiting: true, nextRetryAt }
      })

    const onRetry = ({ attempt }: { attempt: number }) =>
      setState(s => {
        itemsRef.current.push({ id: getId(), type: 'line', step: s.step, text: `Retrying (attempt ${attempt})...` })
        return { ...s, waiting: false, nextRetryAt: null }
      })

    loopEvents.on('logFile', onLogFile)
    loopEvents.on('step', onStep)
    loopEvents.on('prompt', onPrompt)
    loopEvents.on('line', onLine)
    loopEvents.on('done', onDone)
    loopEvents.on('error', onError)
    loopEvents.on('waiting', onWaiting)
    loopEvents.on('retry', onRetry)

    return () => {
      loopEvents.off('logFile', onLogFile)
      loopEvents.off('step', onStep)
      loopEvents.off('prompt', onPrompt)
      loopEvents.off('line', onLine)
      loopEvents.off('done', onDone)
      loopEvents.off('error', onError)
      loopEvents.off('waiting', onWaiting)
      loopEvents.off('retry', onRetry)
    }
  }, [showRequest])

  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!state.waiting) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [state.waiting])

  useEffect(() => {
    if (state.done || state.error) exit()
  }, [state.done, state.error, exit])

  return (
    <Box flexDirection="column">
      <LogStream
        items={[...itemsRef.current]}
        active={state.active}
        step={state.step}
        iteration={state.iteration}
        maxIterations={state.maxIterations}
        agent={state.agent}
        model={state.model}
        startTime={state.startTime}
        logFile={state.logFile}
        animation={animation}
      />

      {state.waiting && state.nextRetryAt && (
        <Box marginTop={1}>
          <Text color="yellow" bold>
            Rate limited — retrying in {formatCountdown(state.nextRetryAt)}
          </Text>
        </Box>
      )}

      {state.error && (
        <Box marginTop={1}>
          <Text color="red" bold>Error: {state.error}</Text>
        </Box>
      )}
    </Box>
  )
}
