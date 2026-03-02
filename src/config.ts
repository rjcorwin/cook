import fs from 'fs'
import path from 'path'
import { logWarn } from './log.js'

export type AnimationStyle = 'flame' | 'strip' | 'campfire' | 'pot' | 'pulse'

export interface CookConfig {
  network: {
    mode: 'default' | 'restricted'
    allowedHosts: string[]
  }
  env: string[]
  animation: AnimationStyle
}

export function loadConfig(projectRoot: string): CookConfig {
  const configPath = path.join(projectRoot, '.cook.config.json')
  const defaults: CookConfig = { network: { mode: 'default', allowedHosts: [] }, env: [], animation: 'strip' }
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch {
    return defaults
  }
  try {
    const parsed = JSON.parse(raw)
    return {
      network: { ...defaults.network, ...parsed.network },
      env: parsed.env ?? defaults.env,
      animation: parsed.animation ?? defaults.animation,
    }
  } catch (err) {
    logWarn(`Malformed .cook.config.json: ${err}`)
    return defaults
  }
}
