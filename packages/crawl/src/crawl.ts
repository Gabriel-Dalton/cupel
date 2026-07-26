import type { DiscoveredAsset } from '@cupel/core'
import { DEFAULT_VIEWPORT, estimateDisplayDims, type Viewport } from './dims.js'
import { CUPEL_USER_AGENT, type Fetcher } from './fetcher.js'
import { estimateFold } from './fold.js'
import { parseHtml } from './parse.js'
import { checkRobots } from './robots.js'
import type { PageCrawl } from './types.js'

export type CrawlOptions = {
  /** All network goes through this; the CLI passes the platform fetch. */
  fetcher: Fetcher
  /** Assumed viewport for sizing and fold estimation. Default 1440x900. */
  viewport?: Viewport
  /** Sent on every request and evaluated against robots.txt groups. */
  userAgent?: string
  /** Injectable clock so tests get a deterministic fetchedAt. */
  now?: () => Date
}

/**
 * Crawls one page: robots check, fetch, static parse, display dimension
 * estimation, and fold/LCP guessing, folded into a PageCrawl.
 *
 * Never rejects for network reasons: a robots disallow, an HTTP error, or
 * a thrown fetch each produce a PageCrawl with no assets and a note saying
 * why, so the hosted endpoint and the CLI share one error surface.
 * PageCrawl.url is always the URL that was asked for; when the fetch was
 * redirected, asset URLs resolve against the final URL and a note records
 * the redirect.
 */
export async function crawlPage(url: string, opts: CrawlOptions): Promise<PageCrawl> {
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT
  const userAgent = opts.userAgent ?? CUPEL_USER_AGENT
  const fetchedAt = (opts.now?.() ?? new Date()).toISOString()

  const base: PageCrawl = {
    url,
    fetchedAt,
    assumedViewport: viewport,
    assets: [],
    blockedByRobots: false,
    notes: [],
  }

  const robots = await checkRobots(url, opts.fetcher, userAgent)
  if (!robots.allowed) {
    return {
      ...base,
      blockedByRobots: true,
      notes: [robots.note ?? `robots.txt disallows ${url}; nothing was crawled`],
    }
  }

  const notes: string[] = []
  if (robots.note !== undefined) notes.push(robots.note)

  let html: string
  let finalUrl = url
  try {
    const response = await opts.fetcher(url, { headers: { 'user-agent': userAgent } })
    if (!response.ok) {
      notes.push(`page fetch failed with HTTP ${response.status}; nothing was crawled`)
      return { ...base, notes }
    }
    html = await response.text()
    if (response.url !== '' && response.url !== url) {
      finalUrl = response.url
      notes.push(`fetch was redirected to ${finalUrl}; asset URLs resolve against it`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    notes.push(`page fetch failed (${message}); nothing was crawled`)
    return { ...base, notes }
  }

  const found = parseHtml(html, finalUrl)
  const estimates = found.map((f) => estimateDisplayDims(f.sizing, viewport))
  const fold = estimateFold(
    found.map((f, i) => ({ display: estimates[i]!, lazy: f.lazy })),
    viewport,
  )

  const assets: DiscoveredAsset[] = found.map((f, i) => {
    const estimate = estimates[i]!
    const asset: DiscoveredAsset = { ...f.asset, aboveFold: fold.aboveFold[i] === true }
    if (estimate.width !== undefined) asset.displayWidthCssPx = estimate.width
    if (estimate.height !== undefined) asset.displayHeightCssPx = estimate.height
    asset.role = i === fold.lcpIndex ? 'lcp' : f.kind === 'background' ? 'decorative' : 'content'
    return asset
  })

  if (estimates.some((e) => e.estimated)) {
    notes.push(
      `display dimensions are estimated from static HTML and CSS against an assumed viewport of ` +
        `${viewport.width}x${viewport.height}; responsive layouts and JS driven sizing are not evaluated`,
    )
  }
  if (assets.length > 0) {
    notes.push(
      'above-the-fold flags assume assets stack vertically in document order; loading="lazy" is treated as below the fold',
    )
  }
  if (fold.lcpIndex !== undefined) {
    notes.push(
      `LCP guess: ${assets[fold.lcpIndex]?.url ?? ''} (largest estimated above-fold display area; ties go to the earliest asset in document order)`,
    )
  }

  return { ...base, assets, notes }
}
