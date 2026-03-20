import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('ink', () => ({
  render: () => ({ unmount: () => {}, waitUntilExit: async () => {} }),
}))

import os from 'os'
import fs from 'fs'
import path from 'path'
import { execute, parseRalphVerdict, type ExecutionContext } from './executor.js'
import { TestRunner, testPoolFactory } from './testing/test-runner.js'
import { DEFAULT_COOK_MD } from './template.js'
import type { ParsedFlags } from './parser.js'
import type { AgentName, StepName } from './config.js'

// ---- parseRalphVerdict unit tests ----

describe('parseRalphVerdict', () => {
  it('returns DONE for "DONE"', () => {
    expect(parseRalphVerdict('DONE')).toBe('DONE')
  })

  it('returns NEXT for "NEXT\\nsome explanation"', () => {
    expect(parseRalphVerdict('NEXT\nsome explanation')).toBe('NEXT')
  })

  it('defaults to DONE when no keyword found (fail-safe)', () => {
    expect(parseRalphVerdict('text with no keyword')).toBe('DONE')
  })

  it('returns DONE for "APPROVE" (no matching keyword — hits fail-safe default)', () => {
    expect(parseRalphVerdict('APPROVE')).toBe('DONE')
  })

  it('returns NEXT for "CONTINUE" (NEXT-family keyword)', () => {
    expect(parseRalphVerdict('CONTINUE')).toBe('NEXT')
  })
})

// ---- executor integration tests ----

const stepConfig: Record<StepName, { agent: AgentName; model: string; sandbox: SandboxMode }> = {
  work: { agent: 'claude', model: 'claude-sonnet-4-5', sandbox: 'none' },
  review: { agent: 'claude', model: 'claude-sonnet-4-5', sandbox: 'none' },
  gate: { agent: 'claude', model: 'claude-sonnet-4-5', sandbox: 'none' },
  iterate: { agent: 'claude', model: 'claude-sonnet-4-5', sandbox: 'none' },
  ralph: { agent: 'claude', model: 'claude-sonnet-4-5', sandbox: 'none' },
}

function makeCtx(runner: TestRunner, tmpDir: string, overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    projectRoot: tmpDir,
    config: {
      sandbox: 'agent' as const,
      env: [],
      animation: 'strip' as const,
      agent: 'claude' as const,
      steps: { work: {}, review: {}, gate: {}, iterate: {}, ralph: {} },
    },
    flags: {} as ParsedFlags,
    stepConfig,
    runAgents: ['claude'],
    cookMD: DEFAULT_COOK_MD,
    showRequest: false,
    lastMessage: '',
    poolFactory: testPoolFactory(runner),
    ...overrides,
  }
}

describe('executor', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('executeWork: returns lastMessage from runner', async () => {
    const runner = new TestRunner(['hello from agent'])
    const ctx = makeCtx(runner, tmpDir)
    const result = await execute({ type: 'work', prompt: 'do something' }, ctx)
    expect(result.lastMessage).toBe('hello from agent')
  })

  it('executeReview: DONE on first gate', async () => {
    const runner = new TestRunner(['work output', 'review output', 'DONE'])
    const ctx = makeCtx(runner, tmpDir)
    const result = await execute(
      { type: 'review', inner: { type: 'work', prompt: 'do something' }, maxIterations: 3 },
      ctx,
    )
    expect(result.verdict).toBe('DONE')
    expect(result.iterations).toBe(1)
  })

  it('executeReview: iterate once then DONE', async () => {
    const runner = new TestRunner(['work', 'review', 'ITERATE', 'work2', 'review2', 'DONE'])
    const ctx = makeCtx(runner, tmpDir)
    const result = await execute(
      { type: 'review', inner: { type: 'work', prompt: 'do something' }, maxIterations: 3 },
      ctx,
    )
    expect(result.verdict).toBe('DONE')
    expect(result.iterations).toBe(2)
  })

  it('executeRalph: NEXT then DONE', async () => {
    // Sequence: work1, ralph gate returns NEXT, work2, ralph gate returns DONE
    const runner = new TestRunner(['work1', 'NEXT', 'work2', 'DONE'])
    const ctx = makeCtx(runner, tmpDir)
    const result = await execute(
      {
        type: 'ralph',
        inner: { type: 'work', prompt: 'do something' },
        maxTasks: 10,
        gatePrompt: 'check if done',
      },
      ctx,
    )
    expect(result.lastMessage).toBe('DONE')
  })

  it('executeRepeat: inner work runs N times', async () => {
    const runner = new TestRunner(['pass1', 'pass2', 'pass3'])
    const ctx = makeCtx(runner, tmpDir)
    const result = await execute(
      {
        type: 'repeat',
        inner: { type: 'work', prompt: 'do something' },
        count: 3,
      },
      ctx,
    )
    expect(result.lastMessage).toBe('pass3')
  })
})
