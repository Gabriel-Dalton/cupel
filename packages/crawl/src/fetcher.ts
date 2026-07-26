/**
 * Every byte the crawler moves goes through an injected, fetch-compatible
 * function. The CLI passes the platform fetch straight in; the hosted
 * endpoint passes an SSRF-guarded wrapper (BRIEF section 9.3). Nothing in
 * this package ever reaches for a global network primitive on its own,
 * which is what makes the whole crawl testable without touching the
 * network.
 */

/**
 * The subset of the WHATWG Response the crawler needs. `url` is the final
 * URL after redirects; relative asset URLs resolve against it, not against
 * the URL that was requested.
 */
export type FetchResponse = {
  ok: boolean
  status: number
  url: string
  text(): Promise<string>
}

export type FetchInit = {
  headers?: Record<string, string>
}

/** Fetch-compatible: the platform fetch is assignable to this unchanged. */
export type Fetcher = (url: string, init?: FetchInit) => Promise<FetchResponse>

/**
 * The descriptive User-Agent sent with every request (BRIEF section 9.3,
 * citizenship). The token before the first slash is what robots.txt groups
 * match against, so it stays short and stable; the URL lets site owners
 * find out who is crawling them and how to make it stop.
 */
export const CUPEL_USER_AGENT = 'cupel-audit/0.1 (+https://github.com/Gabriel-Dalton/cupel)'
