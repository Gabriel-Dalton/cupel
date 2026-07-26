import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LedgerEntryV1 } from '@cupel/core'
import { sha256Hex } from '../lib/hash.js'
import { CUPEL_TOOL } from '../version.js'
import { outputPathFor, type Plan, type PlannedAsset } from './plan.js'

/**
 * Applying a plan. Every rule here exists so that a failed or interrupted
 * run leaves a tree that is still correct:
 *
 * - Writes are atomic: a temp file in the destination directory, then a
 *   rename, which is atomic on the same filesystem. A crash mid-write
 *   leaves the temp file, never a half-written asset.
 * - Originals are never deleted and never modified in place before being
 *   copied. Every source that gets rewritten is first preserved byte for
 *   byte under .cupel/sources/, which is what makes `cupel verify` possible
 *   later without a git checkout.
 * - Nothing is written outside the target root.
 */

/** Where preserved originals live, relative to the target root. */
export const SOURCES_DIR = join('.cupel', 'sources')
export const LEDGER_PATH = join('.cupel', 'ledger.jsonl')

/**
 * The receipt for one decision. Explicit nulls throughout: the /verify
 * page's parser rejects omitted fields, and an absent value that means
 * "not applicable" must be visibly absent rather than missing.
 *
 * `reason` is null for encoded entries per the frozen schema, even though
 * decideAsset always returns one; the populated reason belongs in the
 * command's own output, not the receipt.
 */
export function ledgerEntry(planned: PlannedAsset, timestamp: string): LedgerEntryV1 | null {
  const { decision, reference, provenance } = planned
  // No reference means no pixels were ever decoded (svg, gif, a decode
  // failure). The schema requires a reference, and inventing dimensions for
  // one would produce a receipt that cannot be checked, which is worse than
  // no receipt at all.
  if (reference === null) return null

  const chosen = decision.decision === 'encoded' ? decision.chosen : null
  return {
    v: 1,
    ts: timestamp,
    asset: planned.asset.split('\\').join('/'),
    sourceHash: planned.sourceHash,
    outputHash: planned.encoded === null ? null : sha256Hex(planned.encoded),
    sourceRecovered: null,
    reference,
    decision: decision.decision,
    reason: decision.decision === 'encoded' ? null : decision.reason,
    output:
      chosen === null
        ? null
        : { format: chosen.format, quality: chosen.quality, bytes: chosen.bytes },
    before: { format: planned.container, bytes: planned.sourceBytes.length },
    metrics:
      chosen === null
        ? null
        : { ssim: chosen.ssim, deltaE: chosen.deltaE, distortion: chosen.distortion },
    weight: null,
    lambda: null,
    provenance:
      provenance === null
        ? null
        : {
            generations: provenance.generations,
            estimatedOriginalQuality: provenance.estimatedOriginalQuality,
            headroom: provenance.headroom,
          },
    encoder: chosen === null ? null : chosen.encoder,
    tool: CUPEL_TOOL,
  }
}

/** Temp file plus rename. The temp lives beside the destination so the
 * rename never crosses a filesystem boundary. */
async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.cupel-tmp`
  await writeFile(temp, bytes, { flag: 'w' })
  await rename(temp, path)
}

export type ApplyResult = {
  written: string[]
  preserved: string[]
  entries: LedgerEntryV1[]
  /** Assets that got no receipt, with the reason. */
  unrecorded: string[]
}

export type ApplyOptions = {
  /** Injectable so tests get a fixed ts. */
  now?: () => Date
}

export async function applyPlan(plan: Plan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const timestamp = (opts.now?.() ?? new Date()).toISOString()
  const written: string[] = []
  const preserved: string[] = []
  const entries: LedgerEntryV1[] = []
  const unrecorded: string[] = []

  for (const planned of plan.assets) {
    const entry = ledgerEntry(planned, timestamp)
    if (entry === null) {
      unrecorded.push(`${planned.asset}: no reference could be derived, so no receipt was written`)
    } else {
      entries.push(entry)
    }

    if (planned.encoded === null) continue

    // Preserve the original before anything can overwrite it, and verify the
    // copy by hash: a receipt that points at a corrupted source is not a
    // receipt. This happens even when the output lands at a different
    // extension, so verify never depends on the original still being in place.
    const preservedPath = join(plan.root, SOURCES_DIR, planned.asset)
    await atomicWrite(preservedPath, planned.sourceBytes)
    preserved.push(join(SOURCES_DIR, planned.asset))

    const relativeOutput = outputPathFor(planned.asset, entry?.output?.format ?? planned.container)
    await atomicWrite(join(plan.root, relativeOutput), planned.encoded)
    written.push(relativeOutput)
  }

  if (entries.length > 0) {
    const ledgerPath = join(plan.root, LEDGER_PATH)
    await mkdir(dirname(ledgerPath), { recursive: true })
    // One JSON object per line, appended, no trailing blank line. Appending
    // rather than rewriting keeps earlier receipts intact: the ledger is a
    // log, not a snapshot.
    const lines = entries.map((entry) => JSON.stringify(entry)).join('\n')
    await writeFile(ledgerPath, `${lines}\n`, { flag: 'a' })
  }

  return { written, preserved, entries, unrecorded }
}
