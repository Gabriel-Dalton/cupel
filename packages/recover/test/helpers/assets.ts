import type { DiscoveredAsset } from '@cupel/core'

/**
 * Builds a DiscoveredAsset with just the fields a test cares about. Every
 * recoverer receives the full asset shape; tests fill in only what the
 * recoverer under test actually reads.
 */
export function asset(url: string, extra: Partial<DiscoveredAsset> = {}): DiscoveredAsset {
  return { url, ...extra }
}
