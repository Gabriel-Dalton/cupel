import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'
import { hasImageExtension, splitExtension, splitLastSegment, splitUrl } from './internal/url.js'

/**
 * WordPress derives every rendition from the uploaded filename: thumbnails
 * get a -WIDTHxHEIGHT suffix, uploads past the big-image threshold get a
 * -scaled copy, and EXIF-corrected uploads get a -rotated copy. In all
 * three cases the true original survives under the bare name, so stripping
 * the suffix chain points straight at it.
 */

const SIZE_SUFFIX_RE = /-\d{1,5}x\d{1,5}$/
const VARIANT_SUFFIX_RE = /-(scaled|rotated)$/i

function candidatesFor(asset: DiscoveredAsset): SourceCandidate[] {
  const { path, query, hash } = splitUrl(asset.url)
  const { dir, name } = splitLastSegment(path)
  if (!hasImageExtension(name)) return []
  const { stem, ext } = splitExtension(name)

  const sizeMatch = SIZE_SUFFIX_RE.exec(stem)
  const afterSize = sizeMatch ? stem.slice(0, -sizeMatch[0].length) : stem
  const variantMatch = VARIANT_SUFFIX_RE.exec(afterSize)
  const bare = variantMatch ? afterSize.slice(0, -variantMatch[0].length) : afterSize
  if (!sizeMatch && !variantMatch) return []
  if (bare === '') return []

  const rebuild = (fileStem: string): string => `${dir}${fileStem}${ext}${query}${hash}`
  const candidates: SourceCandidate[] = []

  candidates.push({
    url: rebuild(bare),
    via: 'wordpress',
    rationale: sizeMatch
      ? `WordPress generates ${sizeMatch[0].slice(1)} thumbnails from the upload; the original usually survives under the bare filename`
      : `WordPress serves a ${variantMatch?.[0].slice(1)} copy but keeps the true original under the bare filename`,
  })

  if (sizeMatch) {
    // Whether or not the thumbnail name itself carried -scaled, a -scaled
    // sibling may exist (uploads past the big-image threshold), and it is
    // still much larger than any thumbnail.
    candidates.push({
      url: rebuild(`${bare}-scaled`),
      via: 'wordpress',
      rationale:
        'uploads past the WordPress big-image threshold keep a -scaled copy that is larger than every generated thumbnail',
    })
  }

  return candidates.filter((c) => c.url !== asset.url)
}

export const wordpressRecoverer: SourceRecoverer = {
  name: 'wordpress',
  match(asset: DiscoveredAsset): boolean {
    return candidatesFor(asset).length > 0
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    return Promise.resolve(candidatesFor(asset))
  },
}
