import { lookup } from 'node:dns/promises'
import { checkAddress, checkHostname } from './validate'

/**
 * The guarded fetch every hosted endpoint uses for URLs a user hands us
 * (BRIEF 9.3). One call gives you, in order:
 *
 *   1. scheme allowlist (http and https only, no embedded credentials)
 *   2. host validation: IP literals in every historical spelling are
 *      checked against the loopback / private / link-local / metadata /
 *      CGN / multicast blocklists for both IPv4 and IPv6 (validate.ts)
 *   3. DNS resolution of names with EVERY resolved address checked; one
 *      private answer among many refuses the whole name, which closes the
 *      multi-record rebinding trick
 *   4. manual redirect handling that re-runs steps 1-3 on every hop, so a
 *      public URL bouncing to 127.0.0.1 fails closed
 *   5. a byte cap enforced while streaming: the connection is aborted the
 *      moment the cap is crossed, never buffered and discarded
 *   6. one deadline across the whole exchange, redirects included
 *   7. an optional Content-Type gate applied before the body is read
 *
 * What this deliberately does NOT claim: true connect-by-IP pinning.
 * Vercel's Node runtime fetch (undici) offers no per-request hook to force
 * the connection onto the address we validated without adding undici as a
 * dependency and building a custom Agent, so a DNS answer that changes
 * between our lookup and fetch's own lookup is a residual (small, timed)
 * rebinding window. We shrink it by resolving immediately before each hop
 * and refusing multi-address answers with any private member; closing it
 * fully is the documented upgrade path (custom undici Agent whose connect
 * callback dials the vetted address and keeps the hostname for SNI).
 *
 * Everything is injectable: pass a fetcher and a resolver and the whole
 * surface runs in a unit test without a network.
 */

export type AddressResolver = (hostname: string) => Promise<string[]>

/** The subset of a WHATWG Response the guard needs. fetch satisfies it. */
export type GuardFetchResponse = {
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
  arrayBuffer(): Promise<ArrayBuffer>
}

export type GuardFetchInit = {
  method: 'GET'
  headers: Record<string, string>
  redirect: 'manual'
  signal: AbortSignal
}

/** Fetch-compatible: the platform fetch is assignable to this unchanged. */
export type GuardFetcher = (url: string, init: GuardFetchInit) => Promise<GuardFetchResponse>

export type GuardRefusalCode =
  | 'invalid-url'
  | 'bad-scheme'
  | 'credentials'
  | 'private-address'
  | 'dns-error'
  | 'bad-redirect'
  | 'too-many-redirects'
  | 'timeout'
  | 'content-type'
  | 'network-error'

export type GuardedFetchRefusal = { ok: false; code: GuardRefusalCode; reason: string }

export type GuardedFetchSuccess = {
  ok: true
  status: number
  /** The URL the bytes actually came from, after any redirects. */
  finalUrl: string
  contentType: string | null
  bytes: Uint8Array
  /** True when the body was cut off at maxBytes mid-stream. */
  truncated: boolean
  /** Redirects followed. 0 means the first URL answered directly. */
  hops: number
}

export type GuardedFetchResult = GuardedFetchSuccess | GuardedFetchRefusal

export type GuardedFetchOptions = {
  /**
   * Hard cap on body bytes, enforced while streaming. Required on purpose:
   * every caller must state its budget, there is no unlimited default.
   */
  maxBytes: number
  fetcher?: GuardFetcher
  resolve?: AddressResolver
  headers?: Record<string, string>
  /** One deadline for the whole exchange, redirects included. */
  timeoutMs?: number
  maxRedirects?: number
  /** Gate applied to the Content-Type header before the body is read. */
  acceptContentType?: (contentType: string | null) => boolean
}

export const DEFAULT_TIMEOUT_MS = 10_000
/** BRIEF 9.2 allows at most 3 redirects per fetch. */
export const DEFAULT_MAX_REDIRECTS = 3

const defaultResolver: AddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true })
  return records.map((record) => record.address)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refuse(code: GuardRefusalCode, reason: string): GuardedFetchRefusal {
  return { ok: false, code, reason }
}

/**
 * Validates one hop's URL: scheme, credentials, host, and (for names) a
 * fresh DNS resolution with every answer checked.
 */
async function checkTarget(
  url: URL,
  resolve: AddressResolver,
): Promise<GuardedFetchRefusal | { ok: true }> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refuse(
      'bad-scheme',
      `scheme ${url.protocol} is refused; only http and https are fetched`,
    )
  }
  if (url.username !== '' || url.password !== '') {
    return refuse('credentials', 'URLs with embedded credentials are refused')
  }
  const host = checkHostname(url.hostname)
  if (!host.ok) return refuse('private-address', host.reason)
  if (host.kind === 'name') {
    let addresses: string[]
    try {
      addresses = await resolve(host.hostname)
    } catch (error) {
      return refuse('dns-error', `${host.hostname} did not resolve (${messageOf(error)})`)
    }
    if (addresses.length === 0) {
      return refuse('dns-error', `${host.hostname} resolved to no addresses`)
    }
    for (const address of addresses) {
      const check = checkAddress(address)
      if (!check.ok) {
        return refuse('private-address', `${host.hostname} resolves to ${address}: ${check.reason}`)
      }
    }
  }
  return { ok: true }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Reads a body up to maxBytes. The moment a chunk would cross the cap the
 * excess is dropped, the reader is cancelled, and the connection is
 * aborted: an attacker's endless body costs us at most one extra chunk,
 * not memory or bandwidth.
 */
async function readBody(
  response: GuardFetchResponse,
  maxBytes: number,
  controller: AbortController,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.length > maxBytes) return { bytes: buffer.slice(0, maxBytes), truncated: true }
    return { bytes: buffer, truncated: false }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return { bytes: concatChunks(chunks, total), truncated: false }
    if (value === undefined || value.length === 0) continue
    if (total + value.length > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total))
      total = maxBytes
      await reader.cancel().catch(() => undefined)
      controller.abort()
      return { bytes: concatChunks(chunks, total), truncated: true }
    }
    chunks.push(value)
    total += value.length
  }
}

/** Best-effort body drop for responses we refuse or redirect past. */
function discardBody(response: GuardFetchResponse): void {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // A locked or already-consumed stream is not our problem here.
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  const fetcher = options.fetcher ?? (fetch as GuardFetcher)
  const resolve = options.resolve ?? defaultResolver
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    return refuse('invalid-url', 'the URL did not parse')
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await checkTarget(current, resolve)
      if (!target.ok) return target

      let response: GuardFetchResponse
      try {
        response = await fetcher(current.href, {
          method: 'GET',
          headers: { ...(options.headers ?? {}) },
          redirect: 'manual',
          signal: controller.signal,
        })
      } catch (error) {
        if (timedOut) return refuse('timeout', `no response within ${timeoutMs}ms`)
        return refuse('network-error', `fetch failed (${messageOf(error)})`)
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        discardBody(response)
        const location = response.headers.get('location')
        if (location === null || location === '') {
          return refuse('bad-redirect', `HTTP ${response.status} without a Location header`)
        }
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          return refuse('bad-redirect', `Location header did not parse (${location})`)
        }
        current = next
        continue
      }

      const contentType = response.headers.get('content-type')
      if (options.acceptContentType && !options.acceptContentType(contentType)) {
        discardBody(response)
        controller.abort()
        return refuse(
          'content-type',
          `content-type ${contentType ?? '(none)'} is not acceptable for this endpoint`,
        )
      }

      let body: { bytes: Uint8Array; truncated: boolean }
      try {
        body = await readBody(response, options.maxBytes, controller)
      } catch (error) {
        if (timedOut) return refuse('timeout', `body did not finish within ${timeoutMs}ms`)
        return refuse('network-error', `body read failed (${messageOf(error)})`)
      }

      return {
        ok: true,
        status: response.status,
        finalUrl: current.href,
        contentType,
        bytes: body.bytes,
        truncated: body.truncated,
        hops: hop,
      }
    }
    return refuse(
      'too-many-redirects',
      `more than ${maxRedirects} redirect${maxRedirects === 1 ? '' : 's'}; giving up`,
    )
  } finally {
    clearTimeout(timer)
  }
}
