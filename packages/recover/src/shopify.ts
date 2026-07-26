import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'
import {
  hasImageExtension,
  hostOf,
  splitExtension,
  splitLastSegment,
  splitUrl,
} from './internal/url.js'

/**
 * Shopify's CDN encodes resize and crop instructions in the filename:
 * tee_800x600_crop_center@2x.jpg is a rendition of tee.jpg. Stripping the
 * token chain recovers the merchant upload. The ?v= cache-busting param
 * belongs to the file identity and must survive untouched.
 */

const SIZE_RE = /_(\d{1,5}x\d{0,5}|x\d{1,5})$/i
const NAMED_SIZE_RE = /_(pico|icon|thumb|small|compact|medium|large|grande|original|master)$/i
const CROP_RE = /_crop_(top|center|bottom|left|right)$/i
const SCALE_RE = /@[23]x$/i

/** Strips trailing Shopify rendition tokens until none remain. */
function stripTokens(stem: string): string {
  let current = stem
  for (;;) {
    let next = current
    next = next.replace(SCALE_RE, '')
    next = next.replace(CROP_RE, '')
    next = next.replace(SIZE_RE, '')
    next = next.replace(NAMED_SIZE_RE, '')
    if (next === current) return current
    current = next
  }
}

function isShopifyCdn(asset: DiscoveredAsset, path: string): boolean {
  const host = hostOf(asset.url)
  if (host === 'cdn.shopify.com' || host.endsWith('.cdn.shopify.com')) return true
  // Modern storefronts proxy the CDN under the shop's own domain.
  return path.includes('/cdn/shop/')
}

function strippedStem(asset: DiscoveredAsset): { stem: string; stripped: string; ext: string; dir: string } | null {
  const { path } = splitUrl(asset.url)
  if (!isShopifyCdn(asset, path)) return null
  const { dir, name } = splitLastSegment(path)
  if (!hasImageExtension(name)) return null
  const { stem, ext } = splitExtension(name)
  const stripped = stripTokens(stem)
  if (stripped === stem || stripped === '') return null
  return { stem, stripped, ext, dir }
}

export const shopifyRecoverer: SourceRecoverer = {
  name: 'shopify',
  match(asset: DiscoveredAsset): boolean {
    return strippedStem(asset) !== null
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    const result = strippedStem(asset)
    if (result === null) return Promise.resolve([])
    const { query, hash } = splitUrl(asset.url)
    const url = `${result.dir}${result.stripped}${result.ext}${query}${hash}`
    if (url === asset.url) return Promise.resolve([])
    const removed = result.stem.slice(result.stripped.length)
    return Promise.resolve([
      {
        url,
        via: 'shopify',
        rationale: `Shopify CDN rendition token "${removed}" stripped; the unsuffixed file is the merchant upload`,
      },
    ])
  },
}
