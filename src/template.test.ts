import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { renderTemplate, loadCookMD, DEFAULT_COOK_MD } from './template.js'
import type { LoopContext } from './template.js'

// ---- renderTemplate tests ----

describe('renderTemplate', () => {
  function makeCtx(overrides: Partial<LoopContext> = {}): LoopContext {
    return {
      step: 'work',
      prompt: 'do the work',
      lastMessage: '',
      iteration: 1,
      maxIterations: 3,
      logFile: '/tmp/log.txt',
      ...overrides,
    }
  }

  it('substitutes all LoopContext variables', () => {
    const template = 'Step: ${step}, iter: ${iteration}'
    const result = renderTemplate(template, makeCtx({ step: 'review', iteration: 2 }))
    expect(result).toBe('Step: review, iter: 2')
  })

  it('handles undefined optional variables without crashing', () => {
    const template = 'ralph: ${ralphIteration}, max: ${maxRalph}, pass: ${repeatPass}'
    const ctx = makeCtx({ ralphIteration: undefined, maxRalph: undefined, repeatPass: undefined })
    // Should not throw; undefined renders as 'undefined' string in JS template literals
    expect(() => renderTemplate(template, ctx)).not.toThrow()
    const result = renderTemplate(template, ctx)
    expect(result).toContain('undefined')
  })

  it('throws with "Template error in COOK.md" message for invalid template syntax', () => {
    // A template with unclosed expression causes SyntaxError when compiled
    const badTemplate = 'Hello ${name'
    expect(() => renderTemplate(badTemplate, makeCtx())).toThrow('Template error in COOK.md')
  })
})

// ---- loadCookMD tests ----

describe('loadCookMD', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-template-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns DEFAULT_COOK_MD when no COOK.md exists', () => {
    const result = loadCookMD(tmpDir)
    expect(result).toBe(DEFAULT_COOK_MD)
  })

  it('returns file contents when COOK.md exists', () => {
    const customContent = '# My Custom COOK.md\n\nCustom instructions here.'
    fs.writeFileSync(path.join(tmpDir, 'COOK.md'), customContent, 'utf8')
    const result = loadCookMD(tmpDir)
    expect(result).toBe(customContent)
  })
})
