import { describe, it, expect } from 'vitest'
import { parse } from './parser.js'

describe('parse', () => {
  it('parses a simple work prompt', () => {
    const { ast } = parse(['do the work'])
    expect(ast.type).toBe('work')
    if (ast.type !== 'work') throw new Error('unreachable')
    expect(ast.prompt).toBe('do the work')
  })

  it('parses work + review keyword', () => {
    const { ast } = parse(['do the work', 'review'])
    expect(ast.type).toBe('review')
    if (ast.type !== 'review') throw new Error('unreachable')
    expect(ast.inner.type).toBe('work')
    expect(ast.maxIterations).toBe(3)
  })

  it('parses work + xN as repeat', () => {
    const { ast } = parse(['do the work', 'x3'])
    expect(ast.type).toBe('repeat')
    if (ast.type !== 'repeat') throw new Error('unreachable')
    expect(ast.count).toBe(3)
    expect(ast.inner.type).toBe('work')
  })

  it('parses work + ralph + gate prompt', () => {
    const { ast } = parse(['do the work', 'ralph', 'check done'])
    expect(ast.type).toBe('ralph')
    if (ast.type !== 'ralph') throw new Error('unreachable')
    expect(ast.maxTasks).toBe(100)
    expect(ast.gatePrompt).toBe('check done')
  })

  it('parses work + vN + pick as composition', () => {
    const { ast } = parse(['do the work', 'v2', 'pick'])
    expect(ast.type).toBe('composition')
    if (ast.type !== 'composition') throw new Error('unreachable')
    expect(ast.branches.length).toBe(2)
    expect(ast.resolver).toBe('pick')
  })

  it('parses work a vs work b merge as composition', () => {
    const { ast } = parse(['work a', 'vs', 'work b', 'merge'])
    expect(ast.type).toBe('composition')
    if (ast.type !== 'composition') throw new Error('unreachable')
    expect(ast.branches.length).toBe(2)
    expect(ast.branches[0].type).toBe('work')
    expect(ast.branches[1].type).toBe('work')
    expect(ast.resolver).toBe('merge')
  })

  it('parses --agent flag', () => {
    const { flags } = parse(['do the work', '--agent', 'claude'])
    expect(flags.agent).toBe('claude')
  })

  it('parses --model flag', () => {
    const { flags } = parse(['do the work', '--model', 'gpt-4o'])
    expect(flags.model).toBe('gpt-4o')
  })

  it('parses --sandbox flag', () => {
    const { flags } = parse(['do the work', '--sandbox', 'docker'])
    expect(flags.sandbox).toBe('docker')
  })

  it('parses --work flag override', () => {
    const { ast } = parse(['original prompt', '--work', 'custom work prompt'])
    expect(ast.type).toBe('work')
    if (ast.type !== 'work') throw new Error('unreachable')
    expect(ast.prompt).toBe('custom work prompt')
  })

  it('parses --review flag', () => {
    const { ast } = parse(['prompt', 'review', '--review', 'custom review'])
    expect(ast.type).toBe('review')
    if (ast.type !== 'review') throw new Error('unreachable')
    expect(ast.reviewPrompt).toBe('custom review')
  })

  it('parses --gate flag', () => {
    const { ast } = parse(['prompt', 'review', '--gate', 'custom gate'])
    expect(ast.type).toBe('review')
    if (ast.type !== 'review') throw new Error('unreachable')
    expect(ast.gatePrompt).toBe('custom gate')
  })

  it('parses --max-iterations flag', () => {
    const { ast } = parse(['prompt', 'review', '--max-iterations', '5'])
    expect(ast.type).toBe('review')
    if (ast.type !== 'review') throw new Error('unreachable')
    expect(ast.maxIterations).toBe(5)
  })

  it('throws when no work prompt is given', () => {
    expect(() => parse([])).toThrow('Work prompt is required')
  })

  it('throws when first token is a reserved keyword', () => {
    expect(() => parse(['review'])).toThrow('Work prompt is required')
  })

  it('parses bare number after work prompt as max-iterations for implicit review', () => {
    const { ast } = parse(['do work', '5'])
    expect(ast.type).toBe('review')
    if (ast.type !== 'review') throw new Error('unreachable')
    expect(ast.maxIterations).toBe(5)
  })
})
