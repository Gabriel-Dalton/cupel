import robotsParser from 'robots-parser'
import { CUPEL_USER_AGENT, type Fetcher } from './fetcher.js'

/**
 * Robots evaluation for the page fetch (BRIEF section 9.3, citizenship).
 * The policy is deliberately permissive on failure: a missing (404) or
 * unreachable robots.txt means the site has expressed no crawling
 * preference, so the crawl proceeds. Only an explicit disallow blocks it.
 */
export type RobotsDecision = {
  allowed: boolean
  /** Present when there is something worth surfacing in PageCrawl.notes. */
  note?: string
}

export async function checkRobots(
  pageUrl: string,
  fetcher: Fetcher,
  userAgent: string = CUPEL_USER_AGENT,
): Promise<RobotsDecision> {
  const robotsUrl = new URL('/robots.txt', pageUrl).toString()

  let body: string
  try {
    const response = await fetcher(robotsUrl, { headers: { 'user-agent': userAgent } })
    // Any non-2xx counts as "no robots.txt": there is no policy to honour.
    if (!response.ok) return { allowed: true }
    body = await response.text()
  } catch (error) {
    return {
      allowed: true,
      note: `robots.txt at ${robotsUrl} was unreachable (${messageOf(error)}); crawling as allowed`,
    }
  }

  // robots-parser lowercases the UA and cuts it at the first "/", so the
  // full "cupel-audit/0.1 (+url)" string matches a "User-agent: cupel-audit"
  // group. isAllowed returns undefined when the URL is outside the
  // robots.txt origin, which is treated as allowed.
  const robots = robotsParser(robotsUrl, body)
  if (robots.isAllowed(pageUrl, userAgent) !== false) return { allowed: true }
  return {
    allowed: false,
    note: `robots.txt disallows ${pageUrl} for user agent "${userAgent}"; nothing was crawled`,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
