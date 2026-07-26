import { describe, expect, it } from 'vitest'
import { clientIpFrom, createRateLimiter } from '../lib/net/ratelimit'

/**
 * The limiter is in-memory and per serverless instance by design; these
 * tests pin the sliding-window arithmetic with an injected clock so the
 * behaviour is exact, not probabilistic.
 */

describe('createRateLimiter', () => {
  it('allows up to the limit and refuses the next request', () => {
    const t = 0
    const limiter = createRateLimiter({ windows: [{ limit: 3, windowMs: 1000 }], now: () => t })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    const refused = limiter.check('a')
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    expect(refused.retryAfterMs).toBeLessThanOrEqual(1000)
  })

  it('recovers once the window slides past the old requests', () => {
    let t = 0
    const limiter = createRateLimiter({ windows: [{ limit: 2, windowMs: 1000 }], now: () => t })
    limiter.check('a')
    t = 100
    limiter.check('a')
    t = 200
    expect(limiter.check('a').allowed).toBe(false)
    // The first request (t=0) leaves the window at t=1001.
    t = 1001
    expect(limiter.check('a').allowed).toBe(true)
    // But the t=100 and t=1001 requests still occupy the window.
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('reports when to retry', () => {
    let t = 0
    const limiter = createRateLimiter({ windows: [{ limit: 1, windowMs: 1000 }], now: () => t })
    limiter.check('a')
    t = 400
    const refused = limiter.check('a')
    expect(refused.allowed).toBe(false)
    // The t=0 hit expires at t=1000, which is 600ms away.
    expect(refused.retryAfterMs).toBe(600)
  })

  it('keeps keys independent', () => {
    const t = 0
    const limiter = createRateLimiter({ windows: [{ limit: 1, windowMs: 1000 }], now: () => t })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('does not charge refused requests against the quota', () => {
    let t = 0
    const limiter = createRateLimiter({ windows: [{ limit: 1, windowMs: 1000 }], now: () => t })
    limiter.check('a')
    t = 500
    limiter.check('a')
    limiter.check('a')
    // Only the t=0 hit counts; it expires at t=1000.
    t = 1001
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('enforces every window at once', () => {
    let t = 0
    const limiter = createRateLimiter({
      windows: [
        { limit: 2, windowMs: 100 },
        { limit: 3, windowMs: 10_000 },
      ],
      now: () => t,
    })
    expect(limiter.check('a').allowed).toBe(true)
    t = 10
    expect(limiter.check('a').allowed).toBe(true)
    t = 20
    // Burst window full.
    expect(limiter.check('a').allowed).toBe(false)
    t = 150
    // Burst window slid; long window has room for one more.
    expect(limiter.check('a').allowed).toBe(true)
    t = 300
    // Long window is now full (t=0, 10, 150).
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('bounds the number of tracked keys', () => {
    const t = 0
    const limiter = createRateLimiter({
      windows: [{ limit: 1, windowMs: 60_000 }],
      now: () => t,
      maxKeys: 2,
    })
    limiter.check('a')
    limiter.check('b')
    limiter.check('c')
    // 'a' was evicted to make room, so a repeat is treated as fresh rather
    // than crashing or growing without bound.
    expect(limiter.check('a').allowed).toBe(true)
  })
})

describe('clientIpFrom', () => {
  it('takes the first x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 70.132.1.2' })
    expect(clientIpFrom(headers)).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.4' })
    expect(clientIpFrom(headers)).toBe('198.51.100.4')
  })

  it('returns a stable key when no header is present', () => {
    expect(clientIpFrom(new Headers())).toBe('unknown')
  })
})
