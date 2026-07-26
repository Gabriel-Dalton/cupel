import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'
import {
  hasImageExtension,
  parseQueryPairs,
  splitLastSegment,
  splitUrl,
} from './internal/url.js'

/**
 * Generic image CDN transforms. Two independent mechanisms:
 *
 * 1. Cloudinary encodes transformations as path segments between
 *    /image/upload/ and the version segment (w_400,h_300,c_fill/...).
 *    Removing them addresses the stored original.
 * 2. imgix and most generic CDNs encode transforms as query params
 *    (?w=&h=&q=&fit=...). Stripping them, while keeping unrelated params
 *    such as ?v=, addresses the stored original.
 */

const CLOUDINARY_MARKER = '/image/upload/'

/**
 * Transformation parameter prefixes Cloudinary documents. A path segment is
 * treated as a transformation only when every comma-separated chunk uses one
 * of these, which keeps folders like my_photos out of the strip.
 */
const CLOUDINARY_PREFIXES = new Set([
  'a',
  'ar',
  'b',
  'bo',
  'br',
  'c',
  'co',
  'cs',
  'dl',
  'dn',
  'dpr',
  'du',
  'e',
  'eo',
  'f',
  'fl',
  'fn',
  'g',
  'h',
  'ki',
  'l',
  'o',
  'q',
  'r',
  'so',
  'sp',
  't',
  'u',
  'vc',
  'vs',
  'w',
  'x',
  'y',
  'z',
])

function isTransformSegment(segment: string): boolean {
  if (segment === '') return false
  return segment.split(',').every((chunk) => {
    const m = /^([a-z]{1,3})_.+$/.exec(chunk)
    return m !== null && CLOUDINARY_PREFIXES.has(m[1] ?? '')
  })
}

type PathStrip = { cleanPath: string; removed: string[] }

/** Removes leading transformation segments after /image/upload/, if any. */
function stripCloudinaryPath(path: string): PathStrip | null {
  const idx = path.indexOf(CLOUDINARY_MARKER)
  if (idx === -1) return null
  const head = path.slice(0, idx + CLOUDINARY_MARKER.length)
  const segments = path.slice(idx + CLOUDINARY_MARKER.length).split('/')
  let i = 0
  // Never consume the final segment: that is the file itself.
  while (i < segments.length - 1 && isTransformSegment(segments[i] ?? '')) i++
  if (i === 0) return null
  return { cleanPath: head + segments.slice(i).join('/'), removed: segments.slice(0, i) }
}

/** Query params that describe a transform rather than identify the file. */
const TRANSFORM_PARAMS = new Set([
  'ar',
  'auto',
  'crop',
  'cs',
  'dpr',
  'fit',
  'fm',
  'h',
  'q',
  'rect',
  'w',
])

type QueryStrip = { cleanQuery: string; removed: string[] }

/** Removes transform params, keeping everything else in original order. */
function stripTransformQuery(query: string): QueryStrip | null {
  const pairs = parseQueryPairs(query)
  const kept = pairs.filter((p) => !TRANSFORM_PARAMS.has(p.key.toLowerCase()))
  if (kept.length === pairs.length) return null
  return {
    cleanQuery: kept.length === 0 ? '' : `?${kept.map((p) => p.raw).join('&')}`,
    removed: pairs.filter((p) => TRANSFORM_PARAMS.has(p.key.toLowerCase())).map((p) => p.key),
  }
}

function analyze(asset: DiscoveredAsset): {
  parts: ReturnType<typeof splitUrl>
  pathStrip: PathStrip | null
  queryStrip: QueryStrip | null
} {
  const parts = splitUrl(asset.url)
  const pathStrip = stripCloudinaryPath(parts.path)
  // Query stripping is generic, so it is gated harder: the path must look
  // like an image file, and the Next.js optimizer route (which also carries
  // w= and q=) belongs to the nextjs recoverer.
  const { name } = splitLastSegment(parts.path)
  const queryEligible = hasImageExtension(name) && !parts.path.endsWith('/_next/image')
  const queryStrip = queryEligible ? stripTransformQuery(parts.query) : null
  return { parts, pathStrip, queryStrip }
}

export const cdnRecoverer: SourceRecoverer = {
  name: 'cdn',
  match(asset: DiscoveredAsset): boolean {
    const { pathStrip, queryStrip } = analyze(asset)
    return pathStrip !== null || queryStrip !== null
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    const { parts, pathStrip, queryStrip } = analyze(asset)
    const candidates: SourceCandidate[] = []

    if (pathStrip !== null && queryStrip !== null) {
      candidates.push({
        url: pathStrip.cleanPath + queryStrip.cleanQuery + parts.hash,
        via: 'cdn',
        rationale: `Cloudinary transformation segment "${pathStrip.removed.join('/')}" and transform query params (${queryStrip.removed.join(', ')}) removed; the bare URL addresses the stored original`,
      })
    }
    if (pathStrip !== null) {
      candidates.push({
        url: pathStrip.cleanPath + parts.query + parts.hash,
        via: 'cdn',
        rationale: `Cloudinary transformation segment "${pathStrip.removed.join('/')}" removed from the /image/upload/ URL; the remainder addresses the stored original`,
      })
    }
    if (queryStrip !== null) {
      candidates.push({
        url: parts.path + queryStrip.cleanQuery + parts.hash,
        via: 'cdn',
        rationale: `transform query params (${queryStrip.removed.join(', ')}) stripped, imgix style; the bare path usually serves the stored original`,
      })
    }

    const seen = new Set<string>()
    return Promise.resolve(
      candidates.filter((c) => {
        if (c.url === asset.url || seen.has(c.url)) return false
        seen.add(c.url)
        return true
      }),
    )
  },
}
