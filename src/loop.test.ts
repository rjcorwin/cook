import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { parseGateVerdict, agentLoop } from './loop.js'
import { TestRunner } from './testing/test-runner.js'
import type { LoopConfig } from './loop.js'
import type { StepName } from './config.js'

// ---- parseGateVerdict tests ----

describe('parseGateVerdict', () => {
  it('returns DONE for "DONE"', () => {
    expect(parseGateVerdict('DONE')).toBe('DONE')
  })

  it('returns DONE for "PASS"', () => {
    expect(parseGateVerdict('PASS')).toBe('DONE')
  })

  it('returns DONE for "COMPLETE"', () => {
    expect(parseGateVerdict('COMPLETE')).toBe('DONE')
  })

  it('returns DONE for "APPROVE"', () => {
    expect(parseGateVerdict('APPROVE')).toBe('DONE')
  })

  it('returns DONE for "ACCEPT"', () => {
    expect(parseGateVerdict('ACCEPT')).toBe('DONE')
  })

  it('returns ITERATE for "ITERATE"', () => {
    expect(parseGateVerdict('ITERATE')).toBe('ITERATE')
  })

  it('returns ITERATE for "REVISE"', () => {
    expect(parseGateVerdict('REVISE')).toBe('ITERATE')
  })

  it('returns ITERATE for "RETRY"', () => {
    expect(parseGateVerdict('RETRY')).toBe('ITERATE')
  })

  it('returns ITERATE when no keyword found (default)', () => {
    expect(parseGateVerdict('no keyword here')).toBe('ITERATE')
  })

  it('matches first keyword in multi-line output', () => {
    expect(parseGateVerdict('some text\nDONE\nmore text')).toBe('DONE')
  })

  it('handles leading/trailing whitespace (case insensitive)', () => {
    expect(parseGateVerdict('  done  ')).toBe('DONE')
  })

  it('is case insensitive', () => {
    expect(parseGateVerdict('done')).toBe('DONE')
  })
})

// ---- agentLoop tests ----

const stepConfig = {
  work: { agent: 'claude' as const, model: 'claude-sonnet-4-5', sandbox: 'none' as const },
  review: { agent: 'claude' as const, model: 'claude-sonnet-4-5', sandbox: 'none' as const },
  gate: { agent: 'claude' as const, model: 'claude-sonnet-4-5', sandbox: 'none' as const },
  iterate: { agent: 'claude' as const, model: 'claude-sonnet-4-5', sandbox: 'none' as const },
  ralph: { agent: 'claude' as const, model: 'claude-sonnet-4-5', sandbox: 'none' as const },
}

function makeLoopConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    workPrompt: 'do the work',
    reviewPrompt: 'review the work',
    gatePrompt: 'gate the work',
    steps: stepConfig as Record<StepName, { agent: 'claude'; model: string; sandbox: 'none' }>,
    maxIterations: 3,
    projectRoot: '',
    ...overrides,
  }
}

describe('agentLoop', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('single iteration returning DONE', async () => {
    const runner = new TestRunner(['work output', 'review output', 'DONE'])
    const config = makeLoopConfig({ projectRoot: tmpDir, maxIterations: 3 })
    const events = new EventEmitter()

    const result = await agentLoop(async () => runner, config, '', events)

    expect(result.verdict).toBe('DONE')
    expect(result.iterations).toBe(1)
  })

  it('multiple iterations before DONE', async () => {
    const runner = new TestRunner(['work', 'review', 'ITERATE', 'work2', 'review2', 'DONE'])
    const config = makeLoopConfig({ projectRoot: tmpDir, maxIterations: 3 })
    const events = new EventEmitter()

    const result = await agentLoop(async () => runner, config, '', events)

    expect(result.verdict).toBe('DONE')
    expect(result.iterations).toBe(2)
  })

  it('max iterations reached when runner always returns ITERATE', async () => {
    const runner = new TestRunner([], 'ITERATE')
    const config = makeLoopConfig({ projectRoot: tmpDir, maxIterations: 2 })
    const events = new EventEmitter()

    const result = await agentLoop(async () => runner, config, '', events)

    expect(result.verdict).toBe('MAX_ITERATIONS')
    expect(result.iterations).toBe(2)
  })

  it('skipFirstWork: true skips work step on first iteration', async () => {
    // If work erroneously runs, it consumes 'review output' as the work response
    // and 'DONE' as the review response, leaving the gate to get the fallback — wrong.
    const runner = new TestRunner(['review output', 'DONE'])
    const config = makeLoopConfig({
      projectRoot: tmpDir,
      maxIterations: 1,
      skipFirstWork: true,
    })
    const events = new EventEmitter()

    const result = await agentLoop(async () => runner, config, '', events)

    expect(result.iterations).toBe(1)
    expect(result.lastMessage).toBe('DONE')
  })

  it('returns a LoopResult with expected shape', async () => {
    const runner = new TestRunner(['work output', 'review output', 'DONE'])
    const config = makeLoopConfig({ projectRoot: tmpDir, maxIterations: 3 })
    const events = new EventEmitter()

    const result = await agentLoop(async () => runner, config, '', events)

    expect(result.verdict).toBe('DONE')
    expect(typeof result.iterations).toBe('number')
    expect(typeof result.lastMessage).toBe('string')
    expect(result.lastMessage).toBe('DONE')
    expect(typeof result.logFile).toBe('string')
    expect(result.logFile.length).toBeGreaterThan(0)
    expect(result.logFile.startsWith(tmpDir)).toBe(true)
  })
})
