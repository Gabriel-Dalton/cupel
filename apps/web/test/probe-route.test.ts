import { describe, expect, it } from 'vitest'
import { ANNEX_K_CHROMA, ANNEX_K_LUMA, JPEG_ZIGZAG, scaleQuantTable } from '@cupel/core'
import {
  acceptImageContentType,
  createProbeHandler,
  PROBE_BYTE_CAP,
  sniffContainer,
  type ProbeError,
  type ProbeSuccess,
} from '../app/api/probe/probe'
import type { AddressResolver, GuardFetcher, GuardFetchResponse } from '../lib/net/guard'

/**
 * Route-level tests: the handler is invoked directly with a Request and an
 * injected fetcher, so every hardening property is asserted end to end
 * without a server or a network. All byte fixtures are generated in code.
 */

// --- deterministic fixture builders (no binary fixtures, ever) ---

function u16be(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff]
}

/** Natural-order table serialized in the zigzag stream order DQT uses. */
function zigzagged(table: Uint16Array): number[] {
  const out: number[] = []
  for (let k = 0; k < 64; k++) out.push(table[JPEG_ZIGZAG[k] ?? 0] ?? 0)
  return out
}

/**
 * A minimal JPEG header: SOI, one DQT with libjpeg tables scaled to
 * `quality`, an SOF0 declaring 4:2:0, and an SOS so parseJpeg sees a
 * complete header. parseJpeg never enters entropy data, so two filler
 * bytes after SOS are all the "image" this needs.
 */
function jpegBytes(quality: number, width = 320, height = 200): Uint8Array {
  const luma = scaleQuantTable(ANNEX_K_LUMA, quality)
  const chroma = scaleQuantTable(ANNEX_K_CHROMA, quality)
  const dqt = [0xff, 0xdb, ...u16be(2 + 2 * 65), 0x00, ...zigzagged(luma), 0x01, ...zigzagged(chroma)]
  const sof = [
    0xff, 0xc0, ...u16be(8 + 3 * 3), 8, ...u16be(height), ...u16be(width),
    3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]
  const sos = [0xff, 0xda, ...u16be(12), 3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]
  return Uint8Array.from([0xff, 0xd8, ...dqt, ...sof, ...sos, 0x12, 0x34])
}

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
])
const GIF_BYTES = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)))
const WEBP_BYTES = Uint8Array.from(
  [...'RIFF\x10\x00\x00\x00WEBPVP8 '].map((c) => c.charCodeAt(0)),
)
const AVIF_BYTES = Uint8Array.from(
  [0, 0, 0, 0x20, ...[...'ftypavif'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0],
)

// --- fetch fakes ---

type FetchLogEntry = { url: string; headers: Record<string, string> }

function fakeResponse(init: {
  status?: number
  headers?: Record<string, string>
  body?: Uint8Array | ReadableStream<Uint8Array>
}): GuardFetchResponse {
  const status = init.status ?? 200
  const headers = new Headers(init.headers ?? {})
  if (init.body instanceof ReadableStream) {
    return {
      status,
      headers,
      body: init.body,
      arrayBuffer: () => Promise.reject(new Error('streamed response: read the body')),
    }
  }
  const data = init.body ?? new Uint8Array(0)
  return {
    status,
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        if (data.length > 0) controller.enqueue(data)
        controller.close()
      },
    }),
    arrayBuffer: () => Promise.resolve(data.slice().buffer),
  }
}

function routeFetcher(
  routes: Record<string, () => GuardFetchResponse>,
  log: FetchLogEntry[] = [],
): GuardFetcher {
  return (url, init) => {
    log.push({ url, headers: { ...init.headers } })
    const route = routes[url]
    if (!route) return Promise.resolve(fakeResponse({ status: 404 }))
    return Promise.resolve(route())
  }
}

const publicDns: AddressResolver = () => Promise.resolve(['93.184.216.34'])

function probeRequest(target: string, ip = '203.0.113.7'): Request {
  return new Request(`https://cupel.example/api/probe?url=${encodeURIComponent(target)}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

async function jsonOf<T>(response: Response): Promise<T> {
  expect(response.headers.get('content-type')).toMatch(/application\/json/)
  return (await response.json()) as T
}

// --- container sniffing ---

describe('sniffContainer', () => {
  it('identifies each supported container from magic bytes', () => {
    expect(sniffContainer(jpegBytes(85))).toBe('jpeg')
    expect(sniffContainer(PNG_BYTES)).toBe('png')
    expect(sniffContainer(GIF_BYTES)).toBe('gif')
    expect(sniffContainer(WEBP_BYTES)).toBe('webp')
    expect(sniffContainer(AVIF_BYTES)).toBe('avif')
  })

  it('returns null for anything else', () => {
    expect(sniffContainer(new TextEncoder().encode('<html>not an image</html>'))).toBeNull()
    expect(sniffContainer(new Uint8Array(0))).toBeNull()
    expect(sniffContainer(Uint8Array.from([0xff, 0xd8]))).toBeNull()
  })
})

describe('acceptImageContentType', () => {
  it('accepts image types, octet-stream, and an absent header', () => {
    expect(acceptImageContentType('image/jpeg')).toBe(true)
    expect(acceptImageContentType('image/png; charset=binary')).toBe(true)
    expect(acceptImageContentType('application/octet-stream')).toBe(true)
    expect(acceptImageContentType(null)).toBe(true)
  })

  it('rejects everything else', () => {
    expect(acceptImageContentType('text/html')).toBe(false)
    expect(acceptImageContentType('application/json')).toBe(false)
    expect(acceptImageContentType('text/html; charset=utf-8')).toBe(false)
  })
})

// --- the probe route ---

describe('probe route: jpeg metadata', () => {
  const target = 'https://img.example/photo.jpg'

  function jpegHandler(log: FetchLogEntry[] = []) {
    return createProbeHandler({
      fetcher: routeFetcher(
        { [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }) },
        log,
      ),
      resolve: publicDns,
    })
  }

  it('returns header-derived metadata without decoding pixels', async () => {
    const response = await jpegHandler()(probeRequest(target))
    expect(response.status).toBe(200)
    const body = await jsonOf<ProbeSuccess>(response)
    expect(body.container).toBe('jpeg')
    expect(body.finalUrl).toBe(target)
    expect(body.truncated).toBe(false)
    expect(body.cached).toBe(false)
    expect(body.jpeg?.width).toBe(320)
    expect(body.jpeg?.height).toBe(200)
    expect(body.jpeg?.bitDepth).toBe(8)
    expect(body.jpeg?.progressive).toBe(false)
    expect(body.jpeg?.chromaSubsampling).toBe('4:2:0')
    expect(body.jpeg?.estimatedOriginalQuality).toBe(85)
    expect(body.jpeg?.encoderFingerprint).toBe('libjpeg')
    expect(body.jpeg?.generations).toBeNull()
    expect(body.jpeg?.headroom).toBe('normal')
    expect(body.jpeg?.evidence.join('\n')).toMatch(/quality 85/)
  })

  it('sends the descriptive user agent and a 64 KB range request', async () => {
    const log: FetchLogEntry[] = []
    await jpegHandler(log)(probeRequest(target))
    expect(log).toHaveLength(1)
    expect(log[0]?.headers['user-agent']).toMatch(/cupel/)
    expect(log[0]?.headers['range']).toBe(`bytes=0-${PROBE_BYTE_CAP - 1}`)
  })

  it('sets shared-cache headers on success', async () => {
    const response = await jpegHandler()(probeRequest(target))
    expect(response.headers.get('cache-control')).toMatch(/s-maxage=3600/)
  })

  it('reports exhausted headroom for a low quality source', async () => {
    const lowTarget = 'https://img.example/rough.jpg'
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [lowTarget]: () =>
          fakeResponse({ body: jpegBytes(45), headers: { 'content-type': 'image/jpeg' } }),
      }),
      resolve: publicDns,
    })
    const body = await jsonOf<ProbeSuccess>(await handler(probeRequest(lowTarget)))
    expect(body.jpeg?.estimatedOriginalQuality).toBe(45)
    expect(body.jpeg?.headroom).toBe('none')
  })
})

describe('probe route: non-jpeg containers get a reduced answer', () => {
  const cases: Array<[string, Uint8Array, string]> = [
    ['png', PNG_BYTES, 'image/png'],
    ['gif', GIF_BYTES, 'image/gif'],
    ['webp', WEBP_BYTES, 'image/webp'],
    ['avif', AVIF_BYTES, 'image/avif'],
  ]
  for (const [container, bytes, contentType] of cases) {
    it(`reports container and bytes for ${container}`, async () => {
      const target = `https://img.example/file.${container}`
      const handler = createProbeHandler({
        fetcher: routeFetcher({
          [target]: () => fakeResponse({ body: bytes, headers: { 'content-type': contentType } }),
        }),
        resolve: publicDns,
      })
      const response = await handler(probeRequest(target))
      expect(response.status).toBe(200)
      const body = await jsonOf<ProbeSuccess>(response)
      expect(body.container).toBe(container)
      expect(body.jpeg).toBeNull()
      expect(body.bytesFetched).toBe(bytes.length)
      expect(body.notes.length).toBeGreaterThan(0)
    })
  }
})

describe('probe route: SSRF fails closed end to end', () => {
  it('refuses a 302 to http://127.0.0.1/ with a structured error', async () => {
    const target = 'https://public.example/image.jpg'
    const log: FetchLogEntry[] = []
    const handler = createProbeHandler({
      fetcher: routeFetcher(
        { [target]: () => fakeResponse({ status: 302, headers: { location: 'http://127.0.0.1/steal' } }) },
        log,
      ),
      resolve: publicDns,
    })
    const response = await handler(probeRequest(target))
    expect(response.status).toBe(400)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('private-address')
    expect(log).toHaveLength(1)
    expect(log.map((entry) => entry.url)).not.toContain('http://127.0.0.1/steal')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a direct private target without fetching', async () => {
    const handler = createProbeHandler({
      fetcher: () => {
        throw new Error('must not fetch')
      },
      resolve: publicDns,
    })
    const response = await handler(probeRequest('http://169.254.169.254/latest/meta-data/'))
    expect(response.status).toBe(400)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('private-address')
  })
})

describe('probe route: request validation', () => {
  const handler = createProbeHandler({
    fetcher: () => {
      throw new Error('must not fetch')
    },
    resolve: publicDns,
  })

  it('rejects a missing url parameter', async () => {
    const response = await handler(new Request('https://cupel.example/api/probe'))
    expect(response.status).toBe(400)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('missing-url')
  })

  it('rejects an unparseable url parameter', async () => {
    const response = await handler(probeRequest('not a url'))
    expect(response.status).toBe(400)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('invalid-url')
  })
})

describe('probe route: upstream failures are structured, never stack traces', () => {
  it('maps an upstream HTTP error to 502', async () => {
    const target = 'https://img.example/missing.jpg'
    const handler = createProbeHandler({
      fetcher: routeFetcher({ [target]: () => fakeResponse({ status: 404 }) }),
      resolve: publicDns,
    })
    const response = await handler(probeRequest(target))
    expect(response.status).toBe(502)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('upstream-status')
  })

  it('maps a network failure to 502 without leaking internals', async () => {
    const handler = createProbeHandler({
      fetcher: () => Promise.reject(new Error('ECONNRESET')),
      resolve: publicDns,
    })
    const response = await handler(probeRequest('https://img.example/x.jpg'))
    expect(response.status).toBe(502)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('network-error')
  })

  it('rejects a non-image content type with 415', async () => {
    const target = 'https://img.example/page'
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [target]: () =>
          fakeResponse({
            body: new TextEncoder().encode('<html></html>'),
            headers: { 'content-type': 'text/html' },
          }),
      }),
      resolve: publicDns,
    })
    const response = await handler(probeRequest(target))
    expect(response.status).toBe(415)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('content-type')
  })

  it('rejects bytes that match no known container with 415', async () => {
    const target = 'https://img.example/lying-server'
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [target]: () =>
          fakeResponse({
            body: new TextEncoder().encode('plain text pretending'),
            headers: { 'content-type': 'image/jpeg' },
          }),
      }),
      resolve: publicDns,
    })
    const response = await handler(probeRequest(target))
    expect(response.status).toBe(415)
    const body = await jsonOf<ProbeError>(response)
    expect(body.error.code).toBe('unrecognized-container')
  })
})

describe('probe route: result cache', () => {
  it('serves a repeat probe from cache and skips the fetcher', async () => {
    const target = 'https://img.example/photo.jpg'
    const log: FetchLogEntry[] = []
    const handler = createProbeHandler({
      fetcher: routeFetcher(
        { [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }) },
        log,
      ),
      resolve: publicDns,
    })
    const first = await jsonOf<ProbeSuccess>(await handler(probeRequest(target)))
    expect(first.cached).toBe(false)
    const second = await jsonOf<ProbeSuccess>(await handler(probeRequest(target)))
    expect(second.cached).toBe(true)
    expect(second.container).toBe('jpeg')
    expect(log).toHaveLength(1)
  })

  it('keys the cache on the normalized URL', async () => {
    const target = 'https://img.example/photo.jpg?b=2&a=1'
    const equivalent = 'https://img.example/photo.jpg?a=1&b=2'
    const log: FetchLogEntry[] = []
    const handler = createProbeHandler({
      fetcher: routeFetcher(
        { [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }) },
        log,
      ),
      resolve: publicDns,
    })
    await handler(probeRequest(target))
    const second = await jsonOf<ProbeSuccess>(await handler(probeRequest(equivalent)))
    expect(second.cached).toBe(true)
    expect(log).toHaveLength(1)
  })

  it('expires cache entries after one hour', async () => {
    const target = 'https://img.example/photo.jpg'
    let t = 0
    const log: FetchLogEntry[] = []
    const handler = createProbeHandler({
      fetcher: routeFetcher(
        { [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }) },
        log,
      ),
      resolve: publicDns,
      now: () => t,
    })
    await handler(probeRequest(target))
    t = 3_600_000
    const late = await jsonOf<ProbeSuccess>(await handler(probeRequest(target)))
    expect(late.cached).toBe(false)
    expect(log).toHaveLength(2)
  })
})

describe('probe route: rate limiting', () => {
  it('trips at the limit, reports Retry-After, and recovers', async () => {
    const target = 'https://img.example/photo.jpg'
    let t = 0
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }),
      }),
      resolve: publicDns,
      now: () => t,
      rateWindows: [{ limit: 2, windowMs: 60_000 }],
    })
    expect((await handler(probeRequest(target))).status).toBe(200)
    expect((await handler(probeRequest(target))).status).toBe(200)
    const refused = await handler(probeRequest(target))
    expect(refused.status).toBe(429)
    const retryAfter = refused.headers.get('retry-after')
    expect(retryAfter).toBeTruthy()
    expect(Number(retryAfter)).toBeGreaterThan(0)
    const body = await jsonOf<ProbeError>(refused)
    expect(body.error.code).toBe('rate-limited')
    // The window slides; the same client is welcome again.
    t = 61_000
    expect((await handler(probeRequest(target))).status).toBe(200)
  })

  it('limits per client IP, not globally', async () => {
    const target = 'https://img.example/photo.jpg'
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [target]: () => fakeResponse({ body: jpegBytes(85), headers: { 'content-type': 'image/jpeg' } }),
      }),
      resolve: publicDns,
      rateWindows: [{ limit: 1, windowMs: 60_000 }],
    })
    expect((await handler(probeRequest(target, '203.0.113.7'))).status).toBe(200)
    expect((await handler(probeRequest(target, '203.0.113.7'))).status).toBe(429)
    expect((await handler(probeRequest(target, '198.51.100.9'))).status).toBe(200)
  })
})

describe('probe route: byte cap', () => {
  it('cuts an endless body at the cap and still reads the header evidence', async () => {
    const target = 'https://img.example/enormous.jpg'
    const header = jpegBytes(85)
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) {
          controller.enqueue(header)
        } else {
          controller.enqueue(new Uint8Array(16 * 1024).fill(0xaa))
        }
        sent++
      },
    })
    const handler = createProbeHandler({
      fetcher: routeFetcher({
        [target]: () => fakeResponse({ body: endless, headers: { 'content-type': 'image/jpeg' } }),
      }),
      resolve: publicDns,
    })
    const response = await handler(probeRequest(target))
    expect(response.status).toBe(200)
    const body = await jsonOf<ProbeSuccess>(response)
    expect(body.truncated).toBe(true)
    expect(body.bytesFetched).toBe(PROBE_BYTE_CAP)
    expect(body.jpeg?.estimatedOriginalQuality).toBe(85)
    expect(body.notes.join('\n')).toMatch(/byte cap/)
  })
})
