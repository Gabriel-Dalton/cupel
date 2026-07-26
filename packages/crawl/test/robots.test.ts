import { describe, expect, it } from 'vitest'
import { CUPEL_USER_AGENT } from '../src/fetcher.js'
import { checkRobots } from '../src/robots.js'
import { fakeFetcher, type FetchLogEntry } from './helpers/fake-fetcher.js'

const PAGE = 'https://example.com/private/page.html'
const ROBOTS = 'https://example.com/robots.txt'

describe('checkRobots', () => {
  it('treats a missing robots.txt (404) as allowed', async () => {
    const result = await checkRobots(PAGE, fakeFetcher({}))
    expect(result.allowed).toBe(true)
  })

  it('treats an unreachable robots.txt as allowed, with a note', async () => {
    const fetcher = fakeFetcher({ [ROBOTS]: { networkError: 'ECONNREFUSED' } })
    const result = await checkRobots(PAGE, fetcher)
    expect(result.allowed).toBe(true)
    expect(result.note).toBeTruthy()
  })

  it('blocks when robots.txt disallows everything', async () => {
    const fetcher = fakeFetcher({ [ROBOTS]: 'User-agent: *\nDisallow: /' })
    const result = await checkRobots(PAGE, fetcher)
    expect(result.allowed).toBe(false)
    expect(result.note).toContain(PAGE)
  })

  it('applies path specific disallow rules', async () => {
    const fetcher = fakeFetcher({ [ROBOTS]: 'User-agent: *\nDisallow: /private/' })
    expect((await checkRobots(PAGE, fetcher)).allowed).toBe(false)
    expect((await checkRobots('https://example.com/public.html', fetcher)).allowed).toBe(true)
  })

  it('honours a group that targets the cupel token specifically', async () => {
    const robots = 'User-agent: cupel-audit\nDisallow: /\n\nUser-agent: *\nAllow: /'
    const result = await checkRobots(PAGE, fakeFetcher({ [ROBOTS]: robots }))
    expect(result.allowed).toBe(false)
  })

  it('lets Allow override a broader Disallow', async () => {
    const robots = 'User-agent: *\nDisallow: /\nAllow: /private/'
    const result = await checkRobots(PAGE, fakeFetcher({ [ROBOTS]: robots }))
    expect(result.allowed).toBe(true)
  })

  it('sends the descriptive user agent when fetching robots.txt', async () => {
    const log: FetchLogEntry[] = []
    await checkRobots(PAGE, fakeFetcher({}, log))
    expect(log[0]?.url).toBe(ROBOTS)
    expect(log[0]?.headers['user-agent']).toBe(CUPEL_USER_AGENT)
  })

  it('evaluates against a custom user agent when one is given', async () => {
    const robots = 'User-agent: otherbot\nDisallow: /\n\nUser-agent: *\nAllow: /'
    const fetcher = fakeFetcher({ [ROBOTS]: robots })
    expect((await checkRobots(PAGE, fetcher, 'otherbot/2.0')).allowed).toBe(false)
    expect((await checkRobots(PAGE, fetcher)).allowed).toBe(true)
  })
})
