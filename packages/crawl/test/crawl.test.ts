import { describe, expect, it } from 'vitest'
import { crawlPage } from '../src/crawl.js'
import { DEFAULT_VIEWPORT } from '../src/dims.js'
import { CUPEL_USER_AGENT } from '../src/fetcher.js'
import { fakeFetcher, type FetchLogEntry } from './helpers/fake-fetcher.js'

const PAGE = 'https://example.com/gallery/index.html'
const ROBOTS = 'https://example.com/robots.txt'
const NOW = () => new Date('2026-07-26T00:00:00.000Z')

// Stacked heights: 600, 100, 300, 600. Tops: 0, 600, 700, 1000. With the
// default 900px viewport the first three sit above the fold; the last is
// below it and lazy besides.
const HTML = [
  '<html><body>',
  '<img src="hero.jpg" width="1200" height="600">',
  '<img src="/thumb.jpg" width="200" height="100">',
  '<div style="background-image: url(bg.png); width: 300px; height: 300px"></div>',
  '<img src="deep.jpg" width="800" height="600" loading="lazy">',
  '</body></html>',
].join('')

describe('crawlPage', () => {
  it('crawls a page into a PageCrawl: robots, fetch, parse, dims, fold', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = fakeFetcher({ [PAGE]: HTML }, log)
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.url).toBe(PAGE)
    expect(crawl.fetchedAt).toBe('2026-07-26T00:00:00.000Z')
    expect(crawl.assumedViewport).toEqual(DEFAULT_VIEWPORT)
    expect(crawl.blockedByRobots).toBe(false)
    expect(crawl.assets.map((a) => a.url)).toEqual([
      'https://example.com/gallery/hero.jpg',
      'https://example.com/thumb.jpg',
      'https://example.com/gallery/bg.png',
      'https://example.com/gallery/deep.jpg',
    ])

    // robots.txt is consulted before the page, both with the descriptive UA.
    expect(log.map((e) => e.url)).toEqual([ROBOTS, PAGE])
    expect(log[1]?.headers['user-agent']).toBe(CUPEL_USER_AGENT)
  })

  it('estimates display dimensions and flags them as an assumption in notes', async () => {
    const fetcher = fakeFetcher({ [PAGE]: HTML })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.assets[0]?.displayWidthCssPx).toBe(1200)
    expect(crawl.assets[0]?.displayHeightCssPx).toBe(600)
    expect(crawl.assets[2]?.displayWidthCssPx).toBe(300)
    // BRIEF section 15: static display dimensions are approximate, and the
    // output must say so whenever an estimate was used.
    expect(crawl.notes.some((n) => n.includes('1440x900'))).toBe(true)
  })

  it('assigns aboveFold and roles, guessing the largest above-fold asset as LCP', async () => {
    const fetcher = fakeFetcher({ [PAGE]: HTML })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.assets.map((a) => a.aboveFold)).toEqual([true, true, true, false])
    expect(crawl.assets.map((a) => a.role)).toEqual(['lcp', 'content', 'decorative', 'content'])
    expect(crawl.notes.some((n) => n.includes('LCP'))).toBe(true)
  })

  it('returns blockedByRobots with no assets, and never fetches the page', async () => {
    const log: FetchLogEntry[] = []
    const fetcher = fakeFetcher(
      { [ROBOTS]: 'User-agent: *\nDisallow: /', [PAGE]: HTML },
      log,
    )
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.blockedByRobots).toBe(true)
    expect(crawl.assets).toEqual([])
    expect(crawl.notes.some((n) => n.includes(PAGE))).toBe(true)
    expect(log.map((e) => e.url)).toEqual([ROBOTS])
  })

  it('proceeds when robots.txt is unreachable, noting the assumption', async () => {
    const fetcher = fakeFetcher({
      [ROBOTS]: { networkError: 'ETIMEDOUT' },
      [PAGE]: HTML,
    })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.blockedByRobots).toBe(false)
    expect(crawl.assets).toHaveLength(4)
    expect(crawl.notes.some((n) => n.includes('robots.txt'))).toBe(true)
  })

  it('returns an empty crawl with a note when the page fetch fails with an HTTP error', async () => {
    const fetcher = fakeFetcher({ [PAGE]: { status: 500 } })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.blockedByRobots).toBe(false)
    expect(crawl.assets).toEqual([])
    expect(crawl.notes.some((n) => n.includes('500'))).toBe(true)
  })

  it('returns an empty crawl with a note when the page fetch throws', async () => {
    const fetcher = fakeFetcher({ [PAGE]: { networkError: 'ECONNRESET' } })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.assets).toEqual([])
    expect(crawl.notes.some((n) => n.includes('ECONNRESET'))).toBe(true)
  })

  it('resolves relative asset URLs against the final URL after a redirect', async () => {
    const fetcher = fakeFetcher({
      [PAGE]: {
        status: 200,
        body: '<img src="a.jpg">',
        finalUrl: 'https://example.com/moved/page.html',
      },
    })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.url).toBe(PAGE)
    expect(crawl.assets[0]?.url).toBe('https://example.com/moved/a.jpg')
    expect(crawl.notes.some((n) => n.includes('https://example.com/moved/page.html'))).toBe(true)
  })

  it('honours a custom viewport for sizing and reports it in assumedViewport', async () => {
    const viewport = { width: 400, height: 400 }
    const fetcher = fakeFetcher({ [PAGE]: '<img src="a.jpg" style="width: 50%; height: 10px">' })
    const crawl = await crawlPage(PAGE, { fetcher, viewport, now: NOW })

    expect(crawl.assumedViewport).toEqual(viewport)
    expect(crawl.assets[0]?.displayWidthCssPx).toBe(200)
    expect(crawl.notes.some((n) => n.includes('400x400'))).toBe(true)
  })

  it('evaluates robots.txt against a custom user agent and sends it on the fetch', async () => {
    const robots = 'User-agent: otherbot\nDisallow: /\n\nUser-agent: *\nAllow: /'
    const blocked = await crawlPage(PAGE, {
      fetcher: fakeFetcher({ [ROBOTS]: robots, [PAGE]: HTML }),
      userAgent: 'otherbot/2.0',
      now: NOW,
    })
    expect(blocked.blockedByRobots).toBe(true)

    const log: FetchLogEntry[] = []
    const crawl = await crawlPage(PAGE, {
      fetcher: fakeFetcher({ [PAGE]: HTML }, log),
      userAgent: 'otherbot/2.0',
      now: NOW,
    })
    expect(crawl.blockedByRobots).toBe(false)
    expect(log[1]?.headers['user-agent']).toBe('otherbot/2.0')
  })

  it('adds no estimation or LCP notes when the page has no assets', async () => {
    const fetcher = fakeFetcher({ [PAGE]: '<p>no images here</p>' })
    const crawl = await crawlPage(PAGE, { fetcher, now: NOW })

    expect(crawl.assets).toEqual([])
    expect(crawl.notes).toEqual([])
  })
})
