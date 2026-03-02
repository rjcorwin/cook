import fs from 'fs'
import path from 'path'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BLUE = '\x1b[0;34m'

export const logPhase = (msg: string) => {
  console.error(`\n${BLUE}══════════════════════════════════════${RESET}`)
  console.error(`${BLUE}  ${msg}${RESET}`)
  console.error(`${BLUE}══════════════════════════════════════${RESET}\n`)
}

export const logStep = (msg: string) => console.error(`${CYAN}▸ ${msg}${RESET}`)
export const logOK = (msg: string) => console.error(`${GREEN}✓ ${msg}${RESET}`)
export const logWarn = (msg: string) => console.error(`${YELLOW}⚠ ${msg}${RESET}`)
export const logErr = (msg: string) => console.error(`${RED}✗ ${msg}${RESET}`)

export { BOLD, RESET, CYAN }

function localTimestamp(fmt: 'file' | 'log'): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return fmt === 'file' ? `${date}-${time}` : `${date} ${time.replace(/(..)(..)(..)/, '$1:$2:$3')}`
}

export function createSessionLog(projectRoot: string): string {
  const logDir = path.join(projectRoot, '.cook', 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const ts = localTimestamp('file')
  const logPath = path.join(logDir, `${ts}.md`)
  fs.writeFileSync(logPath, '')
  return logPath
}

export function appendToLog(logFile: string, step: string, iteration: number, output: string): void {
  const timestamp = localTimestamp('log')
  fs.appendFileSync(logFile, `## [${step} ${iteration}] ${timestamp}\n\n${output}\n\n---\n\n`)
}
