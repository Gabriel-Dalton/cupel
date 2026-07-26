import {
  estimateJpegQuality,
  FINGERPRINT_REGISTRY,
  identifyEncoder,
  parseJpeg,
  quantSignature,
  resolveHeadroom,
  selectQuantTables,
  type ChromaSubsampling,
  type Headroom,
} from '@cupel/core'
import { CUPEL_USER_AGENT } from '@cupel/crawl'
import { createTtlCache, normalizeUrl } from '../../../lib/net/cache'
import {
  guardedFetch,
  type AddressResolver,
  type GuardFetcher,
  type GuardRefusalCode,
} from '../../../lib/net/guard'
import {
  clientIpFrom,
  createRateLimiter,
  type RateLimitWindow,
} from '../../../lib/net/ratelimit'

/**
 * The single-image metadata probe (BRIEF sections 7 and 9.1): fetch the
 * first 64 KB of a user-supplied image URL through the guarded fetch,
 * read what the container header says, and return the evidence as JSON.
 *
 * The probe NEVER decodes pixels. Everything it reports comes from marker
 * and header parsing, which is why 64 KB is enough and why generation
 * counting (double quantization needs decoded luma) is reported as
 * undetermined with a pointer to the audit and the CLI. Non-JPEG
 * containers get the reduced honest answer: container identity and byte
 * counts, nothing invented.
 *
 * Errors are structured JSON with stable codes, never stack traces.
 */

/** BRIEF 9.2: 64 KB per asset covers headers, EXIF, and the full DQT. */
export const PROBE_BYTE_CAP = 64 * 1024
/** Kept under the route's 15s maxDuration in vercel.json. */
export const PROBE_TIMEOUT_MS = 10_000
export const PROBE_CACHE_TTL_MS = 60 * 60 * 1000
/**
 * BRIEF 9.3 suggests 5/minute and 30/hour for audits. A probe costs at
 * most one 64 KB ranged GET, roughly one sixtieth of an audit, so it gets
 * proportionally more headroom while staying hostile to scripted scraping.
 */
export const PROBE_RATE_WINDOWS: readonly RateLimitWindow[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 60, windowMs: 60 * 60_000 },
]

export type SniffedContainer = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif'

export type ProbeJpegReport = {
  width: number | null
  height: number | null
  bitDepth: number | null
  progressive: boolean
  chromaSubsampling: ChromaSubsampling | null
  estimatedOriginalQuality: number | null
  encoderFingerprint: string | null
  /** Always null here: counting generations needs decoded pixels. */
  generations: null
  headroom: Headroom
  evidence: string[]
}

export type ProbeSuccess = {
  url: string
  finalUrl: string
  container: SniffedContainer
  contentType: string | null
  upstreamStatus: number
  bytesFetched: number
  truncated: boolean
  cached: boolean
  jpeg: ProbeJpegReport | null
  notes: string[]
}

export type ProbeError = { error: { code: string; message: string } }

export type ProbeHandlerOptions = {
  fetcher?: GuardFetcher
  resolve?: AddressResolver
  now?: () => number
  rateWindows?: readonly RateLimitWindow[]
  cacheTtlMs?: number
  timeoutMs?: number
  maxBytes?: number
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** Magic-byte container sniff. The server's Content-Type gets no vote. */
export function sniffContainer(bytes: Uint8Array): SniffedContainer | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes[0] === 0x89 &&
    matchesAscii(bytes, 1, 'PNG') &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  if (matchesAscii(bytes, 0, 'GIF87a') || matchesAscii(bytes, 0, 'GIF89a')) return 'gif'
  if (matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP')) return 'webp'
  if (matchesAscii(bytes, 4, 'ftyp') && (matchesAscii(bytes, 8, 'avif') || matchesAscii(bytes, 8, 'avis'))) {
    return 'avif'
  }
  return null
}

/**
 * BRIEF 9.3: reject responses whose Content-Type is not an image. A
 * missing header and application/octet-stream pass through because the
 * magic-byte sniff is the real arbiter; a server declaring text/html is
 * answering with an error page and gets refused before the body is read.
 */
export function acceptImageContentType(contentType: string | null): boolean {
  if (contentType === null) return true
  const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  if (essence === '') return true
  return essence.startsWith('image/') || essence === 'application/octet-stream'
}

const REGISTRY_FAMILIES = FINGERPRINT_REGISTRY.map((entry) => entry.family)

/**
 * Header-only JPEG evidence: the same core surface the CLI uses
 * (parseJpeg, quality estimation, encoder fingerprinting, the headroom
 * rule) minus everything that needs pixels. Double quantization analysis
 * is honestly absent, so generations stays null and headroom rests on the
 * quality evidence alone.
 */
function buildJpegReport(bytes: Uint8Array): { jpeg: ProbeJpegReport | null; notes: string[] } {
  const info = parseJpeg(bytes)
  if (info === null) {
    return {
      jpeg: null,
      notes: ['jpeg magic bytes present but the header did not parse; no quality evidence recovered'],
    }
  }

  const evidence: string[] = []
  if (info.truncated) {
    evidence.push('jpeg header ran past the fetched range: evidence may be partial')
  }
  if (info.chromaSubsampling !== null) {
    evidence.push(`chroma subsampling ${info.chromaSubsampling}`)
  }

  let estimatedOriginalQuality: number | null = null
  let encoderFingerprint: string | null = null
  const selected = selectQuantTables(info)
  if (selected.luma === null) {
    evidence.push('no quantization tables recovered from the header')
  } else {
    const estimate = estimateJpegQuality(selected, REGISTRY_FAMILIES)
    if (estimate !== null) {
      estimatedOriginalQuality = estimate.quality
      evidence.push(
        `quantization tables fit the ${estimate.family} family at quality ${estimate.quality}` +
          (estimate.exact ? ' (exact match)' : ` (fit error ${estimate.fitError.toFixed(4)})`),
      )
    } else {
      const signatures =
        `luma ${quantSignature(selected.luma)}` +
        (selected.chroma ? `, chroma ${quantSignature(selected.chroma)}` : '')
      evidence.push(
        `quantization tables match no known family (signatures ${signatures}): quality unknown`,
      )
    }
    const match = identifyEncoder(selected)
    if (match !== null) {
      encoderFingerprint = match.name
      evidence.push(`encoder fingerprint: ${match.name}`)
    }
  }

  evidence.push(
    'pixel data not decoded: generation counting needs it, so generations is undetermined; ' +
      'run the audit or the CLI for the full read',
  )

  const headroom = resolveHeadroom({
    container: 'jpeg',
    generations: null,
    estimatedOriginalQuality,
    blockingScore: 0,
  })
  evidence.push(...headroom.reasons.map((reason) => `headroom ${headroom.headroom}: ${reason}`))

  return {
    jpeg: {
      width: info.width,
      height: info.height,
      bitDepth: info.bitDepth,
      progressive: info.progressive,
      chromaSubsampling: info.chromaSubsampling,
      estimatedOriginalQuality,
      encoderFingerprint,
      generations: null,
      headroom: headroom.headroom,
      evidence,
    },
    notes: [],
  }
}

const JSON_TYPE = 'application/json; charset=utf-8'
/** Matches the audit permalink policy in vercel.json: cache shared, revalidate stale. */
const SUCCESS_CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=600'

function json(payload: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': JSON_TYPE, ...headers },
  })
}

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  const payload: ProbeError = { error: { code, message } }
  return json(payload, status, { 'cache-control': 'no-store', ...headers })
}

function statusForRefusal(code: GuardRefusalCode): number {
  switch (code) {
    case 'invalid-url':
    case 'bad-scheme':
    case 'credentials':
    case 'private-address':
    case 'bad-redirect':
    case 'too-many-redirects':
      return 400
    case 'content-type':
      return 415
    case 'timeout':
      return 504
    case 'dns-error':
    case 'network-error':
      return 502
  }
}

/**
 * Builds the GET handler with injectable collaborators so every property
 * is unit-testable. The route module calls this once with no arguments;
 * the limiter and cache then live for the life of the instance.
 */
export function createProbeHandler(
  options: ProbeHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const now = options.now ?? Date.now
  const maxBytes = options.maxBytes ?? PROBE_BYTE_CAP
  const limiter = createRateLimiter({ windows: options.rateWindows ?? PROBE_RATE_WINDOWS, now })
  const cache = createTtlCache<ProbeSuccess>({
    ttlMs: options.cacheTtlMs ?? PROBE_CACHE_TTL_MS,
    now,
  })

  return async function handleProbe(request: Request): Promise<Response> {
    try {
      const target = new URL(request.url).searchParams.get('url')
      if (target === null || target === '') {
        return errorResponse(400, 'missing-url', 'pass the image URL as ?url=')
      }

      const decision = limiter.check(clientIpFrom(request.headers))
      if (!decision.allowed) {
        const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
        return errorResponse(429, 'rate-limited', `rate limit exceeded; retry in about ${seconds}s`, {
          'retry-after': String(seconds),
        })
      }

      try {
        new URL(target)
      } catch {
        return errorResponse(400, 'invalid-url', 'the url parameter did not parse as a URL')
      }

      const cacheKey = normalizeUrl(target)
      const hit = cache.get(cacheKey)
      if (hit !== undefined) {
        return json({ ...hit, cached: true }, 200, { 'cache-control': SUCCESS_CACHE_CONTROL })
      }

      const result = await guardedFetch(target, {
        fetcher: options.fetcher,
        resolve: options.resolve,
        maxBytes,
        timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
        headers: {
          'user-agent': CUPEL_USER_AGENT,
          accept: 'image/*,*/*;q=0.5',
          range: `bytes=0-${maxBytes - 1}`,
        },
        acceptContentType: acceptImageContentType,
      })

      if (!result.ok) {
        return errorResponse(statusForRefusal(result.code), result.code, result.reason)
      }
      if (result.status < 200 || result.status >= 300) {
        return errorResponse(
          502,
          'upstream-status',
          `the target responded with HTTP ${result.status}`,
        )
      }

      const container = sniffContainer(result.bytes)
      if (container === null) {
        return errorResponse(
          415,
          'unrecognized-container',
          'the fetched bytes match no supported image container (jpeg, png, webp, avif, gif)',
        )
      }

      const notes: string[] = []
      let jpeg: ProbeJpegReport | null = null
      if (container === 'jpeg') {
        const built = buildJpegReport(result.bytes)
        jpeg = built.jpeg
        notes.push(...built.notes)
      } else {
        notes.push(
          `container ${container} identified from magic bytes; the probe parses jpeg headers only, ` +
            'so container identity and byte counts are the whole answer here',
        )
      }
      if (result.truncated) {
        notes.push(
          `fetch stopped at the ${maxBytes} byte cap; headers live at the front of the file, ` +
            'so the evidence above stands',
        )
      }

      const payload: ProbeSuccess = {
        url: target,
        finalUrl: result.finalUrl,
        container,
        contentType: result.contentType,
        upstreamStatus: result.status,
        bytesFetched: result.bytes.length,
        truncated: result.truncated,
        cached: false,
        jpeg,
        notes,
      }
      cache.set(cacheKey, payload)
      return json(payload, 200, { 'cache-control': SUCCESS_CACHE_CONTROL })
    } catch (error) {
      // Structured JSON no matter what; the stack goes to the server log
      // and never over the wire.
      console.error('probe: unexpected failure', error)
      return errorResponse(500, 'internal', 'the probe failed unexpectedly')
    }
  }
}
