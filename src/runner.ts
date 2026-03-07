import type { AgentName } from './config.js'

export interface AgentRunner {
  runAgent(
    agent: AgentName,
    model: string,
    prompt: string,
    onLine: (line: string) => void
  ): Promise<string>
  stop(): Promise<void>
}

export type SandboxMode = 'agent' | 'docker' | 'none'

export class RunnerPool {
  private runners = new Map<SandboxMode, AgentRunner>()

  constructor(
    private factory: (mode: SandboxMode) => Promise<AgentRunner>
  ) {}

  async get(mode: SandboxMode): Promise<AgentRunner> {
    if (!this.runners.has(mode)) {
      this.runners.set(mode, await this.factory(mode))
    }
    return this.runners.get(mode)!
  }

  async stopAll(): Promise<void> {
    for (const runner of this.runners.values()) {
      await runner.stop()
    }
  }
}
