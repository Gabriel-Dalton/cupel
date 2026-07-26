/**
 * In-memory sliding-window rate limiting per client IP (BRIEF 9.3).
 *
 * Honest scope notes, because this is serverless:
 *
 * - State lives in the module instance. Vercel functions scale to many
 *   instances and instances do not share memory, so a determined abuser
 *   spread across instances sees a multiple of the nominal limit, not the
 *   limit itself. This is still worth having: Fluid Compute reuses warm
 *   instances aggressively, so the common abuse shape (one client
 *   hammering one region) lands on few instances and gets throttled, and
 *   the limiter costs nothing: no store, no environment variable, no
 *   latency.
 * - BRIEF 9.3 names @vercel/firewall's checkRateLimit as the platform
 *   answer with the same zero-store property. It is not currently a
 *   dependency of this app; when it is added, the route swaps this check
 *   for checkRateLimit in one place. A durable alternative (Upstash Redis
 *   or Vercel KV keyed on client IP) buys exact global limits at the cost
 *   of an environment variable, which BRIEF section 10 treats as a design
 *   smell to be questioned first.
 * - Refused requests are not charged against the quota, so a client that
 *   backs off recovers exactly when the window says it should.
 *
 * Memory is bounded: at most maxKeys clients are tracked and each key
 * keeps only the timestamps inside the largest window.
 */

export type RateLimitWindow = { limit: number; windowMs: number }

export type RateLimitDecision = {
  allowed: boolean
  /** When refused: how long until the window admits this key again. */
  retryAfterMs: number
}

export type RateLimiter = { check(key: string): RateLimitDecision }

export type RateLimiterOptions = {
  windows: readonly RateLimitWindow[]
  now?: () => number
  maxKeys?: number
}

const DEFAULT_MAX_KEYS = 10_000

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windows = [...options.windows]
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  const longestMs = windows.reduce((max, window) => Math.max(max, window.windowMs), 0)
  const hits = new Map<string, number[]>()

  return {
    check(key: string): RateLimitDecision {
      const at = now()
      const kept = (hits.get(key) ?? []).filter((t) => t > at - longestMs)

      let retryAfterMs = 0
      for (const window of windows) {
        const inWindow = kept.filter((t) => t > at - window.windowMs)
        if (inWindow.length >= window.limit) {
          // The (limit)th most recent hit must age out before another
          // request fits in this window.
          const blocking = inWindow[inWindow.length - window.limit] ?? at
          retryAfterMs = Math.max(retryAfterMs, blocking + window.windowMs - at)
        }
      }

      if (retryAfterMs > 0) {
        if (kept.length > 0) hits.set(key, kept)
        else hits.delete(key)
        return { allowed: false, retryAfterMs }
      }

      if (!hits.has(key) && hits.size >= maxKeys) {
        // Evict the oldest-tracked key rather than growing without bound.
        const oldest = hits.keys().next()
        if (!oldest.done) hits.delete(oldest.value)
      }
      kept.push(at)
      hits.set(key, kept)
      return { allowed: true, retryAfterMs: 0 }
    },
  }
}

/**
 * The rate limit key for a request. Vercel terminates TLS ahead of the
 * function and sets x-forwarded-for; the first entry is the client. The
 * fallback key 'unknown' throttles all unidentifiable traffic as one
 * client, which fails safe rather than open.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null) {
    const first = (forwarded.split(',')[0] ?? '').trim()
    if (first !== '') return first
  }
  const real = headers.get('x-real-ip')
  if (real !== null && real.trim() !== '') return real.trim()
  return 'unknown'
}
