// src/retry.ts — Rate-limit detection and retry-after-wait utility

export interface RetryConfig {
  enabled: boolean
  pollIntervalMs: number    // default: 5 * 60 * 1000 (5 min)
  maxWaitMs: number         // default: 6 * 60 * 60 * 1000 (6 hours)
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  pollIntervalMs: 5 * 60 * 1000,
  maxWaitMs: 6 * 60 * 60 * 1000,
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /token.?limit/i,
  /quota/i,
  /too many requests/i,
  /\b429\b/,
  /capacity/i,
  /overloaded/i,
  /resource_exhausted/i,
]

export function isRateLimitError(error: Error): boolean {
  const msg = error.message ?? ''
  return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(msg))
}

export interface WaitingInfo {
  error: Error
  nextRetryAt: Date
  attempt: number
}

export interface RetryInfo {
  attempt: number
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onWaiting?: (info: WaitingInfo) => void,
  onRetry?: (info: RetryInfo) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!config.enabled) {
    return fn()
  }

  let totalWaited = 0
  let attempt = 0

  while (true) {
    try {
      attempt++
      if (attempt > 1) {
        onRetry?.({ attempt })
      }
      return await fn()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      if (!isRateLimitError(error)) {
        throw error
      }

      if (totalWaited >= config.maxWaitMs) {
        throw error
      }

      if (signal?.aborted) {
        throw error
      }

      const waitMs = Math.min(config.pollIntervalMs, config.maxWaitMs - totalWaited)
      const nextRetryAt = new Date(Date.now() + waitMs)

      onWaiting?.({ error, nextRetryAt, attempt })

      await sleep(waitMs, signal)
      totalWaited += waitMs
    }
  }
}
