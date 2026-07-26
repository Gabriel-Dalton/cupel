import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'
import { originOf, parseQueryPairs, splitUrl } from './internal/url.js'

/**
 * The Next.js image optimizer wraps the real asset behind
 * /_next/image?url=<encoded>&w=<width>&q=<quality>. The url param IS the
 * source: decoding it (and resolving site-relative paths against the
 * optimizer URL's origin) recovers the un-resized, un-recompressed asset.
 */

const OPTIMIZER_SUFFIX = '/_next/image'

function urlParam(asset: DiscoveredAsset): string | undefined {
  const { path, query } = splitUrl(asset.url)
  if (!path.endsWith(OPTIMIZER_SUFFIX)) return undefined
  return parseQueryPairs(query).find((p) => p.key === 'url')?.value
}

function tryDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    // Malformed percent-encoding: nothing trustworthy to propose.
    return null
  }
}

export const nextjsRecoverer: SourceRecoverer = {
  name: 'nextjs',
  match(asset: DiscoveredAsset): boolean {
    return urlParam(asset) !== undefined
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    const encoded = urlParam(asset)
    if (encoded === undefined) return Promise.resolve([])
    const decoded = tryDecode(encoded)
    if (decoded === null || decoded === '') return Promise.resolve([])

    let target: string
    if (/^https?:\/\//i.test(decoded) || decoded.startsWith('//')) {
      target = decoded
    } else if (decoded.startsWith('/')) {
      target = originOf(asset.url) + decoded
    } else {
      // Neither absolute nor site-relative: not a shape the optimizer
      // accepts, so do not guess.
      return Promise.resolve([])
    }
    if (target === asset.url) return Promise.resolve([])

    const pairs = parseQueryPairs(splitUrl(asset.url).query)
    const w = pairs.find((p) => p.key === 'w')?.value
    const q = pairs.find((p) => p.key === 'q')?.value
    const served = w !== undefined ? ` (served at w=${w}${q !== undefined ? `, q=${q}` : ''})` : ''
    return Promise.resolve([
      {
        url: target,
        via: 'nextjs',
        rationale: `Next.js image optimizer wrapper${served}; the url param decodes to the underlying source asset`,
      },
    ])
  },
}
