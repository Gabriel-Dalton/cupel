import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'
import { hasImageExtension, splitExtension, splitLastSegment, splitUrl } from './internal/url.js'

/**
 * Design tools export retina variants alongside the 1x asset (logo.png,
 * logo@2x.png, logo@3x.png), and pages routinely reference only the 1x
 * file. The higher-density siblings are the same art at two or three times
 * the resolution, so when the referenced filename carries no density
 * marker, the @2x and @3x names are worth proposing. Verification decides
 * whether they actually exist.
 */

const DENSITY_MARKER_RE = /@\d+(?:\.\d+)?x$/i

function siblingStems(
  asset: DiscoveredAsset,
): { rebuild: (stem: string) => string; stem: string } | null {
  const { path, query, hash } = splitUrl(asset.url)
  const { dir, name } = splitLastSegment(path)
  if (!hasImageExtension(name)) return null
  const { stem, ext } = splitExtension(name)
  if (stem === '' || DENSITY_MARKER_RE.test(stem)) return null
  return { stem, rebuild: (s: string) => `${dir}${s}${ext}${query}${hash}` }
}

export const retinaRecoverer: SourceRecoverer = {
  name: 'retina',
  match(asset: DiscoveredAsset): boolean {
    return siblingStems(asset) !== null
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    const result = siblingStems(asset)
    if (result === null) return Promise.resolve([])
    const candidates = ['@2x', '@3x'].map((marker) => ({
      url: result.rebuild(`${result.stem}${marker}`),
      via: 'retina',
      rationale: `the referenced file carries no density marker; export pipelines often ship a ${marker} retina sibling of the same art next to it`,
    }))
    return Promise.resolve(candidates.filter((c) => c.url !== asset.url))
  },
}
