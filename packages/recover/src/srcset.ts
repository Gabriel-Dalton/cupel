import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'

/**
 * The markup itself often names a better source: the largest srcset
 * candidate is frequently bigger than the URL the page actually used.
 * When the current URL appears in the srcset, only strictly larger entries
 * (same descriptor unit) are proposed. When it does not appear, every
 * listed entry is proposed largest first and left to verification.
 */

type Descriptor = { value: number; unit: 'w' | 'x' }

/** Per the HTML spec a srcset entry without a descriptor means 1x. */
function parseDescriptor(descriptor: string): Descriptor | null {
  const trimmed = descriptor.trim()
  if (trimmed === '') return { value: 1, unit: 'x' }
  const m = /^(\d+(?:\.\d+)?)(w|x)$/i.exec(trimmed)
  if (m === null) return null
  return { value: Number(m[1]), unit: m[2]?.toLowerCase() === 'w' ? 'w' : 'x' }
}

function describe(descriptor: string): string {
  return descriptor.trim() === '' ? '1x' : descriptor.trim()
}

export const srcsetRecoverer: SourceRecoverer = {
  name: 'srcset',
  match(asset: DiscoveredAsset): boolean {
    return (asset.srcset ?? []).some((e) => e.url !== asset.url)
  },
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
    const entries = asset.srcset ?? []
    const current = entries.find((e) => e.url === asset.url)
    const currentDesc = current ? parseDescriptor(current.descriptor) : null

    const others = entries
      .filter((e) => e.url !== asset.url)
      .map((e) => ({ entry: e, desc: parseDescriptor(e.descriptor) }))

    const pool =
      current && currentDesc
        ? others.filter(
            (o) =>
              o.desc !== null &&
              o.desc.unit === currentDesc.unit &&
              o.desc.value > currentDesc.value,
          )
        : others

    const seen = new Set<string>()
    const candidates = pool
      .slice()
      .sort((a, b) => (b.desc?.value ?? 0) - (a.desc?.value ?? 0))
      .filter((o) => {
        if (seen.has(o.entry.url)) return false
        seen.add(o.entry.url)
        return true
      })
      .map((o) => ({
        url: o.entry.url,
        via: 'srcset',
        rationale:
          current && currentDesc
            ? `srcset lists a ${describe(o.entry.descriptor)} candidate; the page currently uses the ${describe(current.descriptor)} file`
            : `srcset lists a ${describe(o.entry.descriptor)} candidate; the currently used URL is not in the srcset, so any listed entry may be a better source`,
      }))

    return Promise.resolve(candidates)
  },
}
