/**
 * Result caching for hosted endpoints (BRIEF 9.3, citizenship): a probe or
 * audit result is cached for one hour keyed on the normalized URL, so a
 * shared link does not re-fetch the target on every view.
 *
 * Two layers do this job together:
 *
 * - The HTTP response carries `s-maxage=3600`, so Vercel's CDN caches the
 *   JSON across instances and regions. That is the layer that protects the
 *   probed site from most repeat traffic.
 * - This in-memory TTL cache catches what the CDN misses: repeat requests
 *   for the same target through DIFFERENT query strings of ours, and warm
 *   same-instance repeats under Fluid Compute. It lives and dies with the
 *   instance; that is documented behaviour, not a bug. A durable shared
 *   cache (KV keyed on the normalized URL) is the upgrade if cross-instance
 *   exactness ever matters more than the zero-environment-variable deploy.
 *
 * Memory is bounded by maxEntries with oldest-first eviction.
 */

/**
 * One normal form per target URL: fragment dropped (never sent to servers
 * anyway), credentials dropped, host lowercased with default ports removed
 * (the URL parser does both), query parameters sorted so equivalent URLs
 * share one cache entry. Path case is preserved: paths are case sensitive.
 * Unparseable input is returned unchanged; it still works as a key and the
 * guard will refuse it long before anything is fetched.
 */
export function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  url.hash = ''
  url.username = ''
  url.password = ''
  url.searchParams.sort()
  const search = url.search === '?' ? '' : url.search
  return url.origin + url.pathname + search
}

export type TtlCache<T> = {
  get(key: string): T | undefined
  set(key: string, value: T): void
  readonly size: number
}

export type TtlCacheOptions = {
  ttlMs: number
  maxEntries?: number
  now?: () => number
}

const DEFAULT_MAX_ENTRIES = 500

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const entries = new Map<string, { value: T; expiresAt: number }>()

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (now() >= entry.expiresAt) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: T): void {
      if (!entries.has(key) && entries.size >= maxEntries) {
        const oldest = entries.keys().next()
        if (!oldest.done) entries.delete(oldest.value)
      }
      entries.set(key, { value, expiresAt: now() + options.ttlMs })
    },
    get size(): number {
      return entries.size
    },
  }
}
