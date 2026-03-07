import type { AgentName } from './config.js'
import { NativeRunner } from './native-runner.js'
import { logWarn } from './log.js'

export class BareRunner extends NativeRunner {
  constructor(projectRoot: string, env: string[]) {
    super(projectRoot, env)
    logWarn('Running in bare mode — all agent safety restrictions are bypassed.')
  }

  protected getBypassFlags(agent: AgentName): string[] {
    switch (agent) {
      case 'claude':
        return ['--dangerously-skip-permissions']
      case 'codex':
        return ['--dangerously-bypass-approvals-and-sandbox']
      case 'opencode':
        throw new Error('opencode is not supported in bare mode — it has no OS-level sandbox. Use --sandbox docker instead.')
      default:
        throw new Error(`Unsupported agent: ${agent}`)
    }
  }
}
