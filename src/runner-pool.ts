import type { AgentRunner, SandboxMode } from './runner.js'

export class RunnerPool {
  private runners = new Map<SandboxMode, Promise<AgentRunner>>()

  constructor(
    private factory: (mode: SandboxMode) => AgentRunner | Promise<AgentRunner>,
  ) {}

  async get(mode: SandboxMode): Promise<AgentRunner> {
    if (!this.runners.has(mode)) {
      this.runners.set(mode, Promise.resolve(this.factory(mode)))
    }
    return this.runners.get(mode)!
  }

  async cleanupAll(): Promise<void> {
    for (const promise of this.runners.values()) {
      try {
        const runner = await promise
        await runner.cleanup()
      } catch {
        // factory may have failed — nothing to clean up
      }
    }
    this.runners.clear()
  }
}
