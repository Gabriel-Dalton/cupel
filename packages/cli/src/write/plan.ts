import { relative } from 'node:path'
import { decideAsset } from '@cupel/core'
import type {
  AssetDecision,
  CandidatePoint,
  Container,
  ProvenanceRecord,
  RawImage,
} from '@cupel/core'
import { UnreadableInput, examine } from '../lib/analyze.js'
import { hashRawImage, sha256Hex } from '../lib/hash.js'
import { candidateKey, sweepMeasured, type SweepOptions } from '../lib/sweep.js'
import { walkImages } from '../lib/walk.js'

/**
 * Planning is where all the thinking happens, and it is completely separate
 * from applying, because the plan is what `--dry-run` prints and what the
 * operator reviews. Nothing in this module touches a byte on disk.
 *
 * The decision itself is never made here: candidates are measured and handed
 * to core's decideAsset, which owns refusal, the floors, and the no-op
 * guard. If this module ever grows an `if` about whether to encode, that is
 * a bug.
 */

/**
 * The reference every metric is measured against. With no page context the
 * CLI has no display dimensions, so the reference is the decoded source at
 * its own declared size: an identity derivation. The /verify page and
 * `cupel verify` both re-derive it the same way, and recording its hash is
 * what lets them prove they measured the same thing.
 *
 * EXIF orientation is deliberately not applied, matching the browser
 * verifier. A rotated reference on one side and an unrotated one on the
 * other would make every receipt unverifiable.
 */
export function deriveReference(image: RawImage): { w: number; h: number; hash: string } {
  return { w: image.width, h: image.height, hash: hashRawImage(image) }
}

const EXTENSION_FOR: Record<string, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
}

/**
 * The output path for a decision: the asset path with the chosen format's
 * extension. This rule is load bearing. LedgerEntryV1 records the asset
 * path and the output format but no output path, so `verify` must be able
 * to derive one from the other; changing this changes what every existing
 * receipt points at.
 */
export function outputPathFor(assetPath: string, format: string): string {
  const extension = EXTENSION_FOR[format] ?? `.${format}`
  const dot = assetPath.lastIndexOf('.')
  const slash = Math.max(assetPath.lastIndexOf('/'), assetPath.lastIndexOf('\\'))
  const stem = dot > slash ? assetPath.slice(0, dot) : assetPath
  return `${stem}${extension}`
}

export type PlannedAsset = {
  /** Path relative to the target root; the ledger's asset field. */
  asset: string
  absolutePath: string
  sourceBytes: Uint8Array
  sourceHash: string
  container: Container
  provenance: ProvenanceRecord | null
  reference: { w: number; h: number; hash: string } | null
  candidates: CandidatePoint[]
  decision: AssetDecision
  /** The exact measured bytes to write. Set only when decision is 'encoded'. */
  encoded: Uint8Array | null
}

export type Plan = {
  root: string
  assets: PlannedAsset[]
  /** Files and directories not planned, with the reason. Never silent. */
  skipped: string[]
}

export type PlanOptions = SweepOptions & {
  /** Progress hook so a long sweep does not look like a hang. */
  onAsset?: (asset: string, index: number, total: number) => void
}

export async function planDirectory(root: string, opts: PlanOptions = {}): Promise<Plan> {
  const { files, skipped: skippedDirs } = await walkImages(root)
  const assets: PlannedAsset[] = []
  const skipped = skippedDirs.map((entry) => `skipped ${entry}`)

  for (const [index, file] of files.entries()) {
    const asset = relative(root, file) || file
    opts.onAsset?.(asset, index, files.length)

    let examined
    try {
      examined = await examine(file)
    } catch (err) {
      if (!(err instanceof UnreadableInput)) throw err
      skipped.push(`unreadable: ${asset} (${err.message})`)
      continue
    }

    const sourceHash = sha256Hex(examined.bytes)
    const base = {
      asset,
      absolutePath: file,
      sourceBytes: examined.bytes,
      sourceHash,
      container: examined.container,
    }

    // No pixels means no measurement and no decision worth recording. An
    // svg is reported and left alone, which is the whole point.
    if (examined.image === null || examined.provenance === null) {
      assets.push({
        ...base,
        provenance: null,
        reference: null,
        candidates: [],
        decision: {
          decision: 'skipped',
          chosen: null,
          reason: examined.note ?? `${examined.container} was not decoded, so nothing was measured`,
        },
        encoded: null,
      })
      continue
    }

    const reference = deriveReference(examined.image)

    // Refusal and classification skips are decided before the sweep, so a
    // refused asset never pays for thirty encodes it cannot use. Passing an
    // empty candidate list reaches exactly those two branches of
    // decideAsset; anything else it says at this point ('skipped' for the
    // empty list) is not a real verdict and is discarded.
    const preflight = decideAsset(examined.provenance, [], {})
    const decidedEarly =
      preflight.decision === 'refused' ||
      (preflight.decision === 'skipped' && preflight.reason.includes('container'))
    if (decidedEarly) {
      assets.push({
        ...base,
        provenance: examined.provenance,
        reference,
        candidates: [],
        decision: preflight,
        encoded: null,
      })
      continue
    }

    const measured = await sweepMeasured(
      examined.image,
      examined.container,
      examined.bytes.length,
      opts,
    )
    const candidates = measured.map((m) => m.point)
    const decision = decideAsset(examined.provenance, candidates, {})

    let encoded: Uint8Array | null = null
    if (decision.decision === 'encoded') {
      const key = candidateKey(decision.chosen)
      encoded = measured.find((m) => candidateKey(m.point) === key)?.bytes ?? null
      if (encoded === null) {
        skipped.push(`internal: no buffer retained for the chosen point on ${asset}`)
        continue
      }
    }

    assets.push({
      ...base,
      provenance: examined.provenance,
      reference,
      candidates,
      decision,
      encoded,
    })
  }

  return { root, assets, skipped }
}
