import React from 'react'
import { render } from 'ink'
import { agentLoop, loopEvents, type LoopConfig } from './loop.js'
import { RunnerPool, type SandboxMode } from './runner.js'
import { NativeRunner } from './native-runner.js'
import { BareRunner } from './bare-runner.js'
import { loadCookMD } from './template.js'
import { loadDockerConfig, type AgentName, type CookConfig, type StepName, type StepSelection } from './config.js'
import { logPhase, logStep, logOK, logWarn } from './log.js'
import { App } from './ui/App.js'
import { runRace } from './race.js'

export interface RalphConfig {
  workPrompt: string
  reviewPrompt: string
  gatePrompt: string
  iteratePrompt?: string
  maxIterations: number
  stepConfig: Record<StepName, StepSelection>
  config: CookConfig
  runAgents: AgentName[]
  showRequest: boolean
  nextPrompt: string
  raceCount?: number
  raceCriteria?: string
}

export async function runRalph(
  maxNexts: number,
  projectRoot: string,
  ralphConfig: RalphConfig,
): Promise<void> {
  logPhase(`cook ralph — up to ${maxNexts} tasks`)
  logStep(`Next prompt: ${ralphConfig.nextPrompt.slice(0, 60)}${ralphConfig.nextPrompt.length > 60 ? '...' : ''}`)
  if (ralphConfig.raceCount) {
    logStep(`Inner race: ${ralphConfig.raceCount} runs`)
  }

  for (let n = 0; n < maxNexts; n++) {
    const isFirst = n === 0
    const taskPrompt = isFirst ? ralphConfig.workPrompt : ralphConfig.nextPrompt

    logPhase(`Task ${n + 1}/${maxNexts}`)

    if (ralphConfig.raceCount) {
      // Inner race for each ralph step
      const raceResult = await runRace(ralphConfig.raceCount, projectRoot, {
        workPrompt: taskPrompt,
        reviewPrompt: ralphConfig.reviewPrompt,
        gatePrompt: ralphConfig.gatePrompt,
        maxIterations: ralphConfig.maxIterations,
        stepConfig: ralphConfig.stepConfig,
        config: ralphConfig.config,
        runAgents: ralphConfig.runAgents,
        showRequest: ralphConfig.showRequest,
        judgePrompt: ralphConfig.raceCriteria,
        iteratePrompt: ralphConfig.iteratePrompt,
      })
      if (raceResult?.verdict === 'DONE') {
        logOK(`Task ${n + 1}: DONE — ralph loop complete`)
        return
      }
      if (raceResult?.verdict === 'ERROR') {
        logWarn(`Task ${n + 1}: error — stopping ralph loop`)
        return
      }
      // NEXT, MAX_ITERATIONS, or null → continue to next task
    } else {
      // Direct loop execution
      const pool = new RunnerPool(async (mode: SandboxMode) => {
        switch (mode) {
          case 'agent':
            return new NativeRunner(projectRoot, ralphConfig.config.env)
          case 'docker': {
            const Docker = (await import('dockerode')).default
            const { startSandbox } = await import('./sandbox.js')
            const dockerConfig = loadDockerConfig(projectRoot)
            return startSandbox(new Docker(), projectRoot, ralphConfig.config.env, dockerConfig, ralphConfig.runAgents)
          }
          case 'none':
            return new BareRunner(projectRoot, ralphConfig.config.env)
        }
      })

      try {
        const cookMD = loadCookMD(projectRoot)
        const { unmount, waitUntilExit } = render(
          React.createElement(App, {
            maxIterations: ralphConfig.maxIterations,
            maxNexts,
            currentTask: n + 1,
            model: ralphConfig.stepConfig.work.model,
            agent: ralphConfig.stepConfig.work.agent,
            showRequest: ralphConfig.showRequest,
            animation: ralphConfig.config.animation,
          }),
          { exitOnCtrlC: false }
        )

        const result = await agentLoop(pool.get.bind(pool), {
          workPrompt: taskPrompt,
          reviewPrompt: ralphConfig.reviewPrompt,
          gatePrompt: ralphConfig.gatePrompt,
          iteratePrompt: ralphConfig.iteratePrompt,
          steps: ralphConfig.stepConfig,
          maxIterations: ralphConfig.maxIterations,
          projectRoot,
        }, cookMD, loopEvents)

        unmount()
        try { await waitUntilExit() } catch { /* ink may throw on unmount */ }

        if (result.verdict === 'DONE') {
          logOK(`Task ${n + 1}: DONE — ralph loop complete`)
          return
        }
        if (result.verdict === 'ERROR') {
          logWarn(`Task ${n + 1}: error — stopping ralph loop`)
          return
        }
        if (result.verdict === 'MAX_ITERATIONS') {
          logWarn(`Task ${n + 1}: max iterations reached — advancing to next task`)
        }
        // NEXT, MAX_ITERATIONS → continue to next task
        logOK(`Task ${n + 1}: complete, advancing to next`)
      } finally {
        await pool.stopAll()
      }
    }
  }

  logWarn(`Ralph: max tasks (${maxNexts}) reached — stopping`)
}
