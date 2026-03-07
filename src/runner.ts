import type { AgentName } from './config.js'

export interface AgentRunner {
  runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void,
  ): Promise<string>
  cleanup(): Promise<void>
}

export type SandboxMode = 'agent' | 'docker' | 'none'
