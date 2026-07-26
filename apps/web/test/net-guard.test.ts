import { describe, expect, it } from 'vitest'
import {
  guardedFetch,
  type AddressResolver,
  type GuardedFetchRefusal,
  type GuardedFetchResult,
  type GuardedFetchSuccess,
  type GuardFetcher,
  type GuardFetchResponse,
} from '../lib/net/guard'

/**
 * Every property of the guarded fetch layer (BRIEF 9.3) is exercised with an
 * injected fetcher and an injected DNS resolver. No test touches the
 * network, and the SSRF cases assert not only the refusal but that the
 * private URL was never handed to the fetcher at all.
 */

const CAP = 64 * 1024

type FetchLogEntry = { url: string; headers: Record<string, string> }

function bytesOf(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}

function fakeResponse(init: {
  status?: number
  headers?: Record<string, string>
  body?: Uint8Array | string | ReadableStream<Uint8Array>
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
  const data = bytesOf(init.body ?? '')
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

/** Route map keyed by exact URL. Values are factories so responses are fresh per call. */
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

function refusalOf(result: GuardedFetchResult): GuardedFetchRefusal {
  if (result.ok) throw new Error('expected a refusal, got a success')
  return result
}

function successOf(result: GuardedFetchResult): GuardedFetchSuccess {
  if (!result.ok)
    throw new Error(`expected success, got refusal: ${result.code} (${result.reason})`)
  return result
}

describe('guardedFetch: happy path', () => {
  it('fetches a public URL and returns the bytes', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = routeFetcher(
      {
        'https://cdn.example/photo.jpg': () =>
          fakeResponse({ body: 'hello image', headers: { 'content-type': 'image/jpeg' } }),
      },
      log,
    )
    const result = successOf(
      await guardedFetch('https://cdn.example/photo.jpg', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
        headers: { 'user-agent': 'test-agent/1.0' },
      }),
    )
    expect(result.status).toBe(200)
    expect(new TextDecoder().decode(result.bytes)).toBe('hello image')
    expect(result.contentType).toBe('image/jpeg')
    expect(result.finalUrl).toBe('https://cdn.example/photo.jpg')
    expect(result.truncated).toBe(false)
    expect(result.hops).toBe(0)
    expect(log).toHaveLength(1)
    expect(log[0]?.headers['user-agent']).toBe('test-agent/1.0')
  })

  it('falls back to arrayBuffer when the response has no stream', async () => {
    const data = bytesOf('no stream here')
    const fetcher: GuardFetcher = () =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        body: null,
        arrayBuffer: () => Promise.resolve(data.slice().buffer),
      })
    const result = successOf(
      await guardedFetch('https://cdn.example/x', { fetcher, resolve: publicDns, maxBytes: CAP }),
    )
    expect(new TextDecoder().decode(result.bytes)).toBe('no stream here')
  })
})

describe('guardedFetch: URL validation', () => {
  const neverFetch: GuardFetcher = () => {
    throw new Error('the fetcher must not be called for a refused URL')
  }

  it('refuses a URL that does not parse', async () => {
    const result = refusalOf(
      await guardedFetch('not a url', { fetcher: neverFetch, resolve: publicDns, maxBytes: CAP }),
    )
    expect(result.code).toBe('invalid-url')
  })

  it('refuses non-http(s) schemes', async () => {
    for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'gopher://example.com/']) {
      const result = refusalOf(
        await guardedFetch(url, { fetcher: neverFetch, resolve: publicDns, maxBytes: CAP }),
      )
      expect(result.code, url).toBe('bad-scheme')
    }
  })

  it('refuses URLs with embedded credentials', async () => {
    const result = refusalOf(
      await guardedFetch('https://user:pass@example.com/', {
        fetcher: neverFetch,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('credentials')
  })

  it('refuses IPv4 loopback, metadata, and 0.0.0.0 literals without fetching', async () => {
    for (const url of [
      'http://127.0.0.1/secret',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/',
      'http://2130706433/',
    ]) {
      const result = refusalOf(
        await guardedFetch(url, { fetcher: neverFetch, resolve: publicDns, maxBytes: CAP }),
      )
      expect(result.code, url).toBe('private-address')
    }
  })

  it('refuses IPv6 loopback without fetching', async () => {
    const result = refusalOf(
      await guardedFetch('http://[::1]/secret', {
        fetcher: neverFetch,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
  })

  it('refuses IPv4-mapped IPv6 loopback without fetching', async () => {
    const result = refusalOf(
      await guardedFetch('http://[::ffff:127.0.0.1]/', {
        fetcher: neverFetch,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
  })
})

describe('guardedFetch: DNS validation', () => {
  const neverFetch: GuardFetcher = () => {
    throw new Error('the fetcher must not be called when DNS resolves private')
  }

  it('refuses a name that resolves to a private address', async () => {
    const resolve: AddressResolver = () => Promise.resolve(['10.0.0.5'])
    const result = refusalOf(
      await guardedFetch('https://internal.example/x', {
        fetcher: neverFetch,
        resolve,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
    expect(result.reason).toMatch(/internal\.example/)
  })

  it('refuses when ANY resolved address is private (rebinding window)', async () => {
    const resolve: AddressResolver = () => Promise.resolve(['93.184.216.34', '10.0.0.5'])
    const result = refusalOf(
      await guardedFetch('https://flappy.example/x', {
        fetcher: neverFetch,
        resolve,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
  })

  it('refuses when the name resolves to IPv6 loopback', async () => {
    const resolve: AddressResolver = () => Promise.resolve(['::1'])
    const result = refusalOf(
      await guardedFetch('https://sneaky.example/x', {
        fetcher: neverFetch,
        resolve,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
  })

  it('reports a resolver failure as dns-error', async () => {
    const resolve: AddressResolver = () => Promise.reject(new Error('ENOTFOUND'))
    const result = refusalOf(
      await guardedFetch('https://nowhere.example/x', {
        fetcher: neverFetch,
        resolve,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('dns-error')
  })

  it('reports an empty resolution as dns-error', async () => {
    const resolve: AddressResolver = () => Promise.resolve([])
    const result = refusalOf(
      await guardedFetch('https://empty.example/x', {
        fetcher: neverFetch,
        resolve,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('dns-error')
  })
})

describe('guardedFetch: redirects re-validate every hop', () => {
  it('refuses a 302 to http://127.0.0.1/ and never fetches it (BRIEF 9.3 mandatory case)', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = routeFetcher(
      {
        'https://public.example/image.jpg': () =>
          fakeResponse({ status: 302, headers: { location: 'http://127.0.0.1/latest' } }),
      },
      log,
    )
    const result = refusalOf(
      await guardedFetch('https://public.example/image.jpg', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
    expect(log).toHaveLength(1)
    expect(log.map((entry) => entry.url)).not.toContain('http://127.0.0.1/latest')
  })

  it('refuses a 302 to a private range after one legal hop', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = routeFetcher(
      {
        'https://public.example/a': () =>
          fakeResponse({ status: 302, headers: { location: 'https://cdn.example/b' } }),
        'https://cdn.example/b': () =>
          fakeResponse({ status: 302, headers: { location: 'http://10.0.0.8/secret' } }),
      },
      log,
    )
    const result = refusalOf(
      await guardedFetch('https://public.example/a', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('private-address')
    expect(log).toHaveLength(2)
    expect(log.map((entry) => entry.url)).not.toContain('http://10.0.0.8/secret')
  })

  it('re-resolves DNS on every hop', async () => {
    const resolved: string[] = []
    const resolve: AddressResolver = (hostname) => {
      resolved.push(hostname)
      return Promise.resolve(hostname === 'evil.example' ? ['192.168.1.1'] : ['93.184.216.34'])
    }
    const fetcher = routeFetcher({
      'https://public.example/a': () =>
        fakeResponse({ status: 301, headers: { location: 'https://evil.example/b' } }),
    })
    const result = refusalOf(
      await guardedFetch('https://public.example/a', { fetcher, resolve, maxBytes: CAP }),
    )
    expect(result.code).toBe('private-address')
    expect(resolved).toEqual(['public.example', 'evil.example'])
  })

  it('follows a legal relative redirect and reports the final URL', async () => {
    const fetcher = routeFetcher({
      'https://public.example/old': () =>
        fakeResponse({ status: 301, headers: { location: '/new' } }),
      'https://public.example/new': () =>
        fakeResponse({ body: 'moved bytes', headers: { 'content-type': 'image/png' } }),
    })
    const result = successOf(
      await guardedFetch('https://public.example/old', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.finalUrl).toBe('https://public.example/new')
    expect(result.hops).toBe(1)
    expect(new TextDecoder().decode(result.bytes)).toBe('moved bytes')
  })

  it('refuses a redirect without a Location header', async () => {
    const fetcher = routeFetcher({
      'https://public.example/a': () => fakeResponse({ status: 302 }),
    })
    const result = refusalOf(
      await guardedFetch('https://public.example/a', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('bad-redirect')
  })

  it('refuses a redirect to a non-http scheme', async () => {
    const fetcher = routeFetcher({
      'https://public.example/a': () =>
        fakeResponse({ status: 302, headers: { location: 'file:///etc/passwd' } }),
    })
    const result = refusalOf(
      await guardedFetch('https://public.example/a', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.code).toBe('bad-scheme')
  })

  it('stops after maxRedirects hops', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = routeFetcher(
      {
        'https://public.example/1': () =>
          fakeResponse({ status: 302, headers: { location: 'https://public.example/2' } }),
        'https://public.example/2': () =>
          fakeResponse({ status: 302, headers: { location: 'https://public.example/3' } }),
        'https://public.example/3': () =>
          fakeResponse({ status: 302, headers: { location: 'https://public.example/4' } }),
      },
      log,
    )
    const result = refusalOf(
      await guardedFetch('https://public.example/1', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
        maxRedirects: 1,
      }),
    )
    expect(result.code).toBe('too-many-redirects')
    expect(log).toHaveLength(2)
  })
})

describe('guardedFetch: size cap enforced while streaming', () => {
  it('cuts an oversized body off mid-stream instead of buffering it', async () => {
    let pulls = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(16 * 1024).fill(0xaa))
      },
    })
    const fetcher: GuardFetcher = () => Promise.resolve(fakeResponse({ body: endless }))
    const result = successOf(
      await guardedFetch('https://big.example/huge.bin', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.truncated).toBe(true)
    expect(result.bytes.length).toBe(CAP)
    // The stream would happily produce forever; the guard must stop pulling
    // right after the cap, not drain and discard.
    expect(pulls).toBeLessThanOrEqual(6)
  })

  it('does not mark a body that fits exactly as truncated', async () => {
    const fetcher: GuardFetcher = () =>
      Promise.resolve(fakeResponse({ body: new Uint8Array(CAP).fill(1) }))
    const result = successOf(
      await guardedFetch('https://big.example/exact.bin', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
      }),
    )
    expect(result.truncated).toBe(false)
    expect(result.bytes.length).toBe(CAP)
  })
})

describe('guardedFetch: timeout', () => {
  it('aborts a fetch that never responds', async () => {
    const hanging: GuardFetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const result = refusalOf(
      await guardedFetch('https://slow.example/x', {
        fetcher: hanging,
        resolve: publicDns,
        maxBytes: CAP,
        timeoutMs: 25,
      }),
    )
    expect(result.code).toBe('timeout')
  })
})

describe('guardedFetch: content type gate', () => {
  it('refuses a response whose content type fails the predicate', async () => {
    const fetcher = routeFetcher({
      'https://public.example/page': () =>
        fakeResponse({ body: '<html></html>', headers: { 'content-type': 'text/html' } }),
    })
    const result = refusalOf(
      await guardedFetch('https://public.example/page', {
        fetcher,
        resolve: publicDns,
        maxBytes: CAP,
        acceptContentType: (contentType) => contentType?.startsWith('image/') === true,
      }),
    )
    expect(result.code).toBe('content-type')
  })
})

describe('guardedFetch: network failures', () => {
  it('reports a thrown fetch as network-error, never as an exception', async () => {
    const fetcher: GuardFetcher = () => Promise.reject(new Error('ECONNRESET'))
    const result = refusalOf(
      await guardedFetch('https://flaky.example/x', { fetcher, resolve: publicDns, maxBytes: CAP }),
    )
    expect(result.code).toBe('network-error')
    expect(result.reason).toMatch(/ECONNRESET/)
  })
})
