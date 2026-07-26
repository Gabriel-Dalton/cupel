import type { DiscoveredAsset } from '@cupel/core'

/**
 * Result of crawling one page. Display dimensions come from a static
 * parse of HTML attributes, inline styles, and simple stylesheet rules;
 * responsive layouts and JS driven sizing defeat static analysis, so
 * every consumer must treat these as approximate and the audit output
 * states that assumption explicitly (BRIEF section 15).
 */
export type PageCrawl = {
  url: string
  fetchedAt: string
  /** Viewport assumed for above-the-fold and display size estimation. */
  assumedViewport: { width: number; height: number }
  assets: DiscoveredAsset[]
  /** True when robots.txt disallowed the fetch and nothing was crawled. */
  blockedByRobots: boolean
  notes: string[]
}
