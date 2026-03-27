import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

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
