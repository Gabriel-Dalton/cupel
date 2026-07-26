// Test-only fetcher fakes. Every crawl test injects one of these, so no
// test ever touches the network.
import type { FetchResponse, Fetcher } from '../../src/fetcher.js'

/** One fake route. A bare string is a 200 response with that body. */
export type FakeRoute =
  | string
  | { status: number; body?: string; finalUrl?: string }
  | { networkError: string }

export type FetchLogEntry = { url: string; headers: Record<string, string> }

/**
 * Builds a Fetcher backed by an in-memory URL map. Unknown URLs return 404,
 * which conveniently models a site without a robots.txt. Every call is
 * appended to `log` so tests can assert exactly what was requested and with
 * which headers.
 */
export function fakeFetcher(
  routes: Record<string, FakeRoute>,
  log: FetchLogEntry[] = [],
): Fetcher {
  return (url, init) => {
    log.push({ url, headers: { ...(init?.headers ?? {}) } })
    const route = routes[url]
    if (route === undefined) return Promise.resolve(response(404, '', url))
    if (typeof route === 'string') return Promise.resolve(response(200, route, url))
    if ('networkError' in route) return Promise.reject(new Error(route.networkError))
    return Promise.resolve(response(route.status, route.body ?? '', route.finalUrl ?? url))
  }
}

function response(status: number, body: string, finalUrl: string): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    text: () => Promise.resolve(body),
  }
}
