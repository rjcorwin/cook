import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { AgentName } from './config.js'

function stripSurroundingQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function isRunnableFile(file: string): boolean {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return false
    if (process.platform !== 'win32') {
      fs.accessSync(file, fs.constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

function commandCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command]
  if (path.extname(command)) return [command]

  const pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  const exts = pathExt
    .split(';')
    .map(ext => ext.trim())
    .filter(Boolean)

  return [command, ...exts.map(ext => `${command}${ext}`)]
}

/**
 * Check if a command exists on PATH without spawning a subprocess.
 * Used by `cook doctor` and `cook shell` for precondition checks.
 */
export function hasCommandOnPath(command: string): boolean {
  if (!command.trim()) return false

  const isDirectPath = path.isAbsolute(command) || command.includes('/') || command.includes('\\')
  if (isDirectPath) {
    return commandCandidates(command).some(isRunnableFile)
  }

  const rawPath = process.env.PATH ?? process.env.Path ?? ''
  const pathEntries = rawPath
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => process.platform === 'win32' ? stripSurroundingQuotes(entry) : entry)

  for (const entry of pathEntries) {
    const base = path.join(entry, command)
    if (commandCandidates(base).some(isRunnableFile)) {
      return true
    }
  }

  return false
}

/**
 * Find the project root by looking for a git repository root.
 * Falls back to the current working directory if not in a git repo.
 */
export function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

/**
 * Split a shell-style argument string into argv tokens.
 *
 * Supports POSIX-style single quotes (literal), double quotes (with backslash
 * escapes), and bare tokens. Used for the `COOK_AGENT_ARGS_<AGENT>` env-var
 * fallback so users can pass quoted flags through the shell environment.
 */
export function splitShellArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  let i = 0
  const push = () => { if (cur.length > 0) { out.push(cur); cur = '' } }
  while (i < input.length) {
    const ch = input[i]!
    if (inSingle) {
      if (ch === "'") inSingle = false
      else cur += ch
    } else if (inDouble) {
      if (ch === '"') inDouble = false
      else if (ch === '\\' && i + 1 < input.length) { cur += input[i + 1]; i++ }
      else cur += ch
    } else if (ch === "'") {
      inSingle = true
    } else if (ch === '"') {
      inDouble = true
    } else if (ch === '\\' && i + 1 < input.length) {
      cur += input[i + 1]; i++
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      push()
    } else {
      cur += ch
    }
    i++
  }
  push()
  return out
}

/**
 * Resolve the extra CLI flags to pass to an agent. The env-var
 * `COOK_AGENT_ARGS_<AGENT>` (uppercase) takes precedence over the
 * config value so users can override per-run without editing config.
 */
export function resolveAgentArgs(agent: AgentName, configArgs: string[] | undefined): string[] {
  const envKey = `COOK_AGENT_ARGS_${agent.toUpperCase()}`
  const raw = process.env[envKey]
  if (raw && raw.trim().length > 0) {
    return splitShellArgs(raw)
  }
  return configArgs ?? []
}
