// src/testing/test-runner.ts
import type { AgentRunner, SandboxMode } from '../runner.js'
import type { AgentName } from '../config.js'
import { RunnerPool } from '../runner.js'

/**
 * A mock AgentRunner for use in tests.
 *
 * Responses are consumed in order from the queue. When the queue is empty,
 * the runner returns 'DONE' by default (or a custom fallback if provided).
 *
 * Each response string is also fed line-by-line to the onLine callback,
 * matching the behavior of real runners.
 */
export class TestRunner implements AgentRunner {
  private responses: string[]
  private fallback: string

  constructor(responses: string[], fallback = 'DONE') {
    this.responses = [...responses]
    this.fallback = fallback
  }

  async runAgent(
    _agent: AgentName,
    _model: string,
    _prompt: string,
    onLine: (line: string) => void,
  ): Promise<string> {
    const response = this.responses.shift() ?? this.fallback
    for (const line of response.split('\n')) {
      onLine(line)
    }
    return response
  }

  async stop(): Promise<void> {}
}

/**
 * Build a RunnerPool that always returns the given TestRunner,
 * regardless of SandboxMode. Pass the returned pool as the poolFactory
 * result in ExecutionContext.
 */
export function makeTestPool(runner: TestRunner): RunnerPool {
  return new RunnerPool(async (_mode: SandboxMode) => runner)
}

/**
 * Convenience: build a poolFactory suitable for ExecutionContext.poolFactory.
 *
 * Usage:
 *   const ctx: ExecutionContext = {
 *     ...baseCtx,
 *     poolFactory: testPoolFactory(new TestRunner(['DONE'])),
 *   }
 */
export function testPoolFactory(
  runner: TestRunner,
): (_worktreePath: string, _config: unknown, _runAgents: unknown) => RunnerPool {
  return () => makeTestPool(runner)
}
