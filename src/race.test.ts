import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { parseJudgeVerdict, buildJudgePrompt, sessionId } from './race.js'
import type { RunResult } from './race.js'

// ---- parseJudgeVerdict tests ----

describe('parseJudgeVerdict', () => {
  it('returns 1 for "PICK 1" with maxRun 3', () => {
    expect(parseJudgeVerdict('PICK 1', 3)).toBe(1)
  })

  it('returns 2 for "PICK 2" with maxRun 3', () => {
    expect(parseJudgeVerdict('PICK 2', 3)).toBe(2)
  })

  it('returns 3 for "PICK 3" with maxRun 3', () => {
    expect(parseJudgeVerdict('PICK 3', 3)).toBe(3)
  })

  it('returns null for "PICK 4" with maxRun 3 (out of range)', () => {
    expect(parseJudgeVerdict('PICK 4', 3)).toBeNull()
  })

  it('returns null for "PICK 0" with maxRun 3 (below range)', () => {
    expect(parseJudgeVerdict('PICK 0', 3)).toBeNull()
  })

  it('returns null when no PICK keyword found', () => {
    expect(parseJudgeVerdict('no pick keyword here', 3)).toBeNull()
  })

  it('is case insensitive', () => {
    expect(parseJudgeVerdict('pick 2', 3)).toBe(2)
  })

  it('handles leading whitespace', () => {
    expect(parseJudgeVerdict('  PICK 1', 2)).toBe(1)
  })

  it('matches PICK in multi-line output', () => {
    expect(parseJudgeVerdict('some output\nPICK 2\nreason', 3)).toBe(2)
  })
})

// ---- buildJudgePrompt tests ----

describe('buildJudgePrompt', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-race-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('includes run log headers for done results', () => {
    const log1 = path.join(tmpDir, 'log1.txt')
    const log2 = path.join(tmpDir, 'log2.txt')
    fs.writeFileSync(log1, 'run 1 output')
    fs.writeFileSync(log2, 'run 2 output')

    const results: RunResult[] = [
      { index: 1, status: 'done', logFile: log1, worktreePath: '/tmp/wt1', branchName: 'branch-1' },
      { index: 2, status: 'done', logFile: log2, worktreePath: '/tmp/wt2', branchName: 'branch-2' },
    ]

    const prompt = buildJudgePrompt(results)

    expect(prompt).toContain('--- Run 1 Log ---')
    expect(prompt).toContain('--- Run 2 Log ---')
  })

  it('filters out error results', () => {
    const log1 = path.join(tmpDir, 'log1.txt')
    fs.writeFileSync(log1, 'run 1 output')

    const results: RunResult[] = [
      { index: 1, status: 'done', logFile: log1, worktreePath: '/tmp/wt1', branchName: 'branch-1' },
      { index: 2, status: 'error', logFile: '', worktreePath: '/tmp/wt2', branchName: 'branch-2', error: 'crashed' },
    ]

    const prompt = buildJudgePrompt(results)

    expect(prompt).toContain('--- Run 1 Log ---')
    expect(prompt).not.toContain('--- Run 2 Log ---')
  })

  it('includes custom criteria when provided', () => {
    const results: RunResult[] = [
      { index: 1, status: 'done', logFile: '', worktreePath: '/tmp/wt1', branchName: 'branch-1' },
    ]

    const prompt = buildJudgePrompt(results, 'prefer brevity')

    expect(prompt).toContain('Additional criteria: prefer brevity')
  })

  it('shows "(no log)" for missing log file', () => {
    const results: RunResult[] = [
      { index: 1, status: 'done', logFile: '/nonexistent/path.txt', worktreePath: '/tmp/wt1', branchName: 'branch-1' },
    ]

    const prompt = buildJudgePrompt(results)

    expect(prompt).toContain('(no log)')
  })
})

// ---- sessionId tests ----

describe('sessionId', () => {
  it('matches expected format', () => {
    const id = sessionId()
    expect(id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/)
  })

  it('returns different values on successive calls', () => {
    const id1 = sessionId()
    const id2 = sessionId()
    // While theoretically possible to collide, the probability is negligible
    expect(id1).not.toBe(id2)
  })
})
