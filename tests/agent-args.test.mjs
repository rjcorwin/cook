// Unit tests for the agentArgs feature (config parser, splitShellArgs,
// resolveAgentArgs, and NativeRunner.buildCommand argv composition).
//
// Run via npm:
//   npm test
//
// Or directly:
//   node --import tsx --test tests/agent-args.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { splitShellArgs, resolveAgentArgs } = await import('../src/util.ts')
const { loadConfig } = await import('../src/config.ts')
const { NativeRunner } = await import('../src/native-runner.ts')

test('splitShellArgs: simple tokens', () => {
  assert.deepEqual(splitShellArgs('--a --b'), ['--a', '--b'])
})

test('splitShellArgs: single-quoted with space', () => {
  assert.deepEqual(splitShellArgs("--mcp 'with space'"), ['--mcp', 'with space'])
})

test('splitShellArgs: double-quoted with backslash', () => {
  assert.deepEqual(splitShellArgs('--key "a\\"b"'), ['--key', 'a"b'])
})

test('splitShellArgs: empty input', () => {
  assert.deepEqual(splitShellArgs(''), [])
})

test('resolveAgentArgs: returns config when env-var is unset', () => {
  delete process.env.COOK_AGENT_ARGS_CLAUDE
  assert.deepEqual(resolveAgentArgs('claude', ['--mcp-config', 'x']), ['--mcp-config', 'x'])
})

test('resolveAgentArgs: env-var overrides config', () => {
  process.env.COOK_AGENT_ARGS_CLAUDE = '--add-dir /tmp'
  try {
    assert.deepEqual(resolveAgentArgs('claude', ['--mcp-config', 'x']), ['--add-dir', '/tmp'])
  } finally {
    delete process.env.COOK_AGENT_ARGS_CLAUDE
  }
})

test('resolveAgentArgs: empty config returns empty array', () => {
  delete process.env.COOK_AGENT_ARGS_CLAUDE
  assert.deepEqual(resolveAgentArgs('claude', undefined), [])
})

function withTmpConfig(content, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-test-'))
  try {
    fs.mkdirSync(path.join(tmp, '.cook'))
    fs.writeFileSync(path.join(tmp, '.cook/config.json'), JSON.stringify(content))
    return fn(tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('loadConfig: parses agentArgs from .cook/config.json', () => {
  withTmpConfig({
    agent: 'claude',
    agentArgs: {
      claude: ['--mcp-config', '.cook/mcp.json', '--add-dir', '/x'],
      codex: [],
    },
  }, (tmp) => {
    const config = loadConfig(tmp)
    assert.deepEqual(config.agentArgs, { claude: ['--mcp-config', '.cook/mcp.json', '--add-dir', '/x'] })
  })
})

test('loadConfig: missing agentArgs defaults to empty object', () => {
  withTmpConfig({ agent: 'claude' }, (tmp) => {
    const config = loadConfig(tmp)
    assert.deepEqual(config.agentArgs, {})
  })
})

test('loadConfig: malformed agentArgs (non-object) falls back to empty', () => {
  withTmpConfig({ agent: 'claude', agentArgs: 'oops' }, (tmp) => {
    const config = loadConfig(tmp)
    assert.deepEqual(config.agentArgs, {})
  })
})

test('loadConfig: unknown agent key is dropped', () => {
  withTmpConfig({
    agent: 'claude',
    agentArgs: { ghost: ['--x'], claude: ['--ok'] },
  }, (tmp) => {
    const config = loadConfig(tmp)
    assert.deepEqual(config.agentArgs, { claude: ['--ok'] })
  })
})

test('loadConfig: non-string entries in agentArgs list are dropped', () => {
  withTmpConfig({
    agent: 'claude',
    agentArgs: { claude: [1, '--b', null, '--c'] },
  }, (tmp) => {
    const config = loadConfig(tmp)
    assert.deepEqual(config.agentArgs, { claude: ['--b', '--c'] })
  })
})

test('NativeRunner: claude argv appends agentArgs after the base flags', () => {
  const runner = new NativeRunner('/tmp/x', [], { claude: ['--mcp-config', 'm.json'] })
  // buildCommand is private — read via index access to keep the test honest.
  const { cmd, args } = runner['buildCommand']('claude', 'opus')
  assert.equal(cmd, 'claude')
  assert.deepEqual(args.slice(-2), ['--mcp-config', 'm.json'])
  // Sanity: base flags still present in order.
  assert.equal(args[0], '--model')
  assert.equal(args[1], 'opus')
})

test('NativeRunner: codex argv places agentArgs before the stdin marker', () => {
  const runner = new NativeRunner('/tmp/x', [], { codex: ['--profile', 'fast'] })
  const { cmd, args } = runner['buildCommand']('codex', 'opus')
  assert.equal(cmd, 'codex')
  assert.equal(args.at(-1), '-')
  assert.deepEqual(args.slice(-3, -1), ['--profile', 'fast'])
})

test('NativeRunner: no agentArgs leaves base argv unchanged', () => {
  const runner = new NativeRunner('/tmp/x', [])
  const { args } = runner['buildCommand']('claude', 'opus')
  assert.deepEqual(args, ['--model', 'opus', '--permission-mode', 'acceptEdits', '-p'])
})
