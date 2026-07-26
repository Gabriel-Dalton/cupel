import { describe, expect, it } from 'vitest'
import { createTtlCache, normalizeUrl } from '../lib/net/cache'

describe('normalizeUrl', () => {
  it('lowercases the host and drops the default port', () => {
    expect(normalizeUrl('https://EXAMPLE.com:443/a')).toBe('https://example.com/a')
    expect(normalizeUrl('http://Example.COM:80/a')).toBe('http://example.com/a')
  })

  it('keeps a non-default port', () => {
    expect(normalizeUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a')
  })

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/a#section')).toBe('https://example.com/a')
  })

  it('strips credentials from the key', () => {
    expect(normalizeUrl('https://user:pass@example.com/a')).toBe('https://example.com/a')
  })

  it('sorts query parameters so equivalent URLs share a key', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      normalizeUrl('https://example.com/a?a=1&b=2'),
    )
  })

  it('preserves path case (paths are case sensitive)', () => {
    expect(normalizeUrl('https://example.com/Images/A.JPG')).toBe(
      'https://example.com/Images/A.JPG',
    )
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://example.com/A'))
  })

  it('returns unparseable input unchanged as a last-resort key', () => {
    expect(normalizeUrl('not a url')).toBe('not a url')
  })
})

describe('createTtlCache', () => {
  it('returns a stored value inside the TTL', () => {
    let t = 0
    const cache = createTtlCache<string>({ ttlMs: 1000, now: () => t })
    cache.set('k', 'value')
    t = 999
    expect(cache.get('k')).toBe('value')
  })

  it('expires a value after the TTL', () => {
    let t = 0
    const cache = createTtlCache<string>({ ttlMs: 1000, now: () => t })
    cache.set('k', 'value')
    t = 1000
    expect(cache.get('k')).toBeUndefined()
  })

  it('misses on unknown keys', () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 })
    expect(cache.get('nope')).toBeUndefined()
  })

  it('overwrites on set', () => {
    const t = 0
    const cache = createTtlCache<string>({ ttlMs: 1000, now: () => t })
    cache.set('k', 'one')
    cache.set('k', 'two')
    expect(cache.get('k')).toBe('two')
  })

  it('evicts the oldest entry when full', () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('reports its size, not counting entries expired on read', () => {
    let t = 0
    const cache = createTtlCache<number>({ ttlMs: 1000, now: () => t })
    cache.set('a', 1)
    expect(cache.size).toBe(1)
    t = 2000
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })
})
