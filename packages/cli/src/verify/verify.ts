import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  CIE76_JND_DELTA_E,
  DEFAULT_KAPPA,
  areaAverageResize,
  deltaE,
  distortion,
  ssim,
} from '@cupel/core'
import type { LedgerEntryV1, RawImage } from '@cupel/core'
import { decodeBytes } from '../lib/analyze.js'
import { hashRawImage, sha256Hex } from '../lib/hash.js'
import { isDecodable } from '../lib/sniff.js'
import { SOURCES_DIR } from '../write/apply.js'
import { outputPathFor } from '../write/plan.js'

/**
 * Verification re-measures; it never re-encodes. That is what makes a
 * receipt checkable by someone who does not have cupel's encoder, or the
 * same version of it, or the same CPU: only decoders are involved, and
 * decoders are bounded by their standards.
 *
 * This is the CLI twin of the /verify page in apps/web. The two must agree,
 * so the tolerances below are mirrored from apps/web/lib/verify/measure.ts
 * rather than chosen here. Cross-boundary imports from an app into a package
 * are not possible, so the values are duplicated with this comment naming
 * the source of truth; if they drift, the same receipt gets two different
 * verdicts and both become worthless.
 */

/** Mirrored from apps/web/lib/verify/measure.ts (SSIM_TOLERANCE). */
export const SSIM_TOLERANCE = 0.002
/** Mirrored from apps/web/lib/verify/measure.ts (DELTA_E_TOLERANCE). */
export const DELTA_E_TOLERANCE = 0.1
/** Derived exactly as the page derives it: worst-case propagation, not a knob. */
export const DISTORTION_TOLERANCE =
  SSIM_TOLERANCE + DEFAULT_KAPPA * (DELTA_E_TOLERANCE / CIE76_JND_DELTA_E)

export type Verdict = 'pass' | 'refuted' | 'unverifiable'

export type MetricComparison = {
  metric: 'ssim' | 'deltaE' | 'distortion'
  recorded: number
  measured: number
  tolerance: number
  withinTolerance: boolean
}

export type EntryResult = {
  asset: string
  verdict: Verdict
  decision: LedgerEntryV1['decision']
  metrics: MetricComparison[]
  referenceHashMatch: boolean | null
  notes: string[]
}

export type VerifyReport = {
  ledgerPath: string
  root: string
  results: EntryResult[]
  /** Lines that were not valid entries, each with why it was skipped. */
  skippedLines: string[]
  totals: { pass: number; refuted: number; unverifiable: number }
}

/**
 * Tolerant line-by-line parsing. One malformed line must not invalidate the
 * rest of the log, and every skip is reported with its reason rather than
 * being silently dropped.
 */
export function parseLedger(text: string): { entries: LedgerEntryV1[]; skipped: string[] } {
  const entries: LedgerEntryV1[] = []
  const skipped: string[] = []
  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped.push(`line ${index + 1}: not valid JSON`)
      continue
    }
    const problem = ledgerProblem(parsed)
    if (problem !== null) {
      skipped.push(`line ${index + 1}: ${problem}`)
      continue
    }
    entries.push(parsed as LedgerEntryV1)
  }
  return { entries, skipped }
}

/**
 * Structural validation against the frozen v1 schema. Required fields must
 * be PRESENT, including the ones whose value is null: an omitted field and
 * an explicit null mean different things in a receipt, and the browser
 * verifier draws the same distinction.
 */
function ledgerProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not a JSON object'
  const entry = value as Record<string, unknown>
  if (entry['v'] !== 1) return `unsupported schema version ${String(entry['v'])}`
  const required = [
    'ts',
    'asset',
    'sourceHash',
    'outputHash',
    'sourceRecovered',
    'reference',
    'decision',
    'reason',
    'output',
    'before',
    'metrics',
    'weight',
    'lambda',
    'provenance',
    'encoder',
    'tool',
  ]
  const missing = required.filter((key) => !(key in entry))
  if (missing.length > 0) return `missing required field(s): ${missing.join(', ')}`
  const reference = entry['reference']
  if (
    typeof reference !== 'object' ||
    reference === null ||
    typeof (reference as Record<string, unknown>)['hash'] !== 'string'
  ) {
    return 'reference is not a {w, h, hash} object'
  }
  return null
}

/**
 * Re-derives the reference the writer measured against: the decoded source
 * at the recorded reference dimensions. Identity when they already agree,
 * area-average downscale otherwise, and null when either axis would need
 * upscaling, because fabricating pixels the source does not carry is
 * refused. Same rule, same resampler as the page.
 */
export function deriveReference(
  source: RawImage,
  target: { w: number; h: number },
): RawImage | null {
  if (target.w === source.width && target.h === source.height) {
    return { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) }
  }
  if (target.w > source.width || target.h > source.height) return null
  return areaAverageResize(source, target.w, target.h)
}

async function readIfPresent(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

/**
 * Finds the source bytes for an entry. `cupel write` preserves every source
 * it rewrites under .cupel/sources/, so that is the first place to look;
 * falling back to the asset path itself covers entries whose decision left
 * the original in place. Either way the bytes are accepted only if they hash
 * to the recorded sourceHash.
 */
async function locateSource(
  root: string,
  entry: LedgerEntryV1,
): Promise<{ bytes: Uint8Array; from: string } | null> {
  const candidates = [
    { path: join(root, SOURCES_DIR, entry.asset), label: `.cupel/sources/${entry.asset}` },
    { path: join(root, entry.asset), label: entry.asset },
  ]
  for (const candidate of candidates) {
    const bytes = await readIfPresent(candidate.path)
    if (bytes !== null && sha256Hex(bytes) === entry.sourceHash) {
      return { bytes, from: candidate.label }
    }
  }
  return null
}

function compare(
  metric: MetricComparison['metric'],
  recorded: number,
  measured: number,
  tolerance: number,
): MetricComparison {
  return {
    metric,
    recorded,
    measured,
    tolerance,
    withinTolerance: Math.abs(measured - recorded) <= tolerance,
  }
}

async function verifyEntry(root: string, entry: LedgerEntryV1): Promise<EntryResult> {
  const base = { asset: entry.asset, decision: entry.decision, metrics: [] as MetricComparison[] }

  // Entries that record no encode have nothing to re-measure. That is a pass
  // in the only sense available: the receipt claims nothing about output
  // bytes, and there are none to contradict it.
  if (entry.decision !== 'encoded' || entry.output === null || entry.metrics === null) {
    return {
      ...base,
      verdict: 'pass',
      referenceHashMatch: null,
      notes: [`decision "${entry.decision}" records no output metrics; nothing to re-measure`],
    }
  }

  if (!isDecodable(entry.before.format as never) || !isDecodable(entry.output.format as never)) {
    return {
      ...base,
      verdict: 'unverifiable',
      referenceHashMatch: null,
      notes: [
        `this build decodes jpeg, png, webp, and avif; the receipt names ${entry.before.format} -> ${entry.output.format}`,
      ],
    }
  }

  const source = await locateSource(root, entry)
  if (source === null) {
    return {
      ...base,
      verdict: 'unverifiable',
      referenceHashMatch: null,
      notes: [
        `no file matching the recorded sourceHash was found at .cupel/sources/${entry.asset} or ${entry.asset}`,
      ],
    }
  }

  const outputRelative = outputPathFor(entry.asset, entry.output.format)
  const outputBytes = await readIfPresent(join(root, outputRelative))
  if (outputBytes === null) {
    return {
      ...base,
      verdict: 'unverifiable',
      referenceHashMatch: null,
      notes: [`the recorded output is missing from disk at ${outputRelative}`],
    }
  }
  if (entry.outputHash !== null && sha256Hex(outputBytes) !== entry.outputHash) {
    return {
      ...base,
      verdict: 'refuted',
      referenceHashMatch: null,
      notes: [
        `${outputRelative} does not hash to the recorded outputHash: these are not the bytes the receipt describes`,
      ],
    }
  }

  let sourceImage: RawImage
  let outputImage: RawImage
  try {
    sourceImage = await decodeBytes(entry.before.format as never, source.bytes)
    outputImage = await decodeBytes(entry.output.format as never, outputBytes)
  } catch (err) {
    return {
      ...base,
      verdict: 'unverifiable',
      referenceHashMatch: null,
      notes: [`decode failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  const reference = deriveReference(sourceImage, entry.reference)
  if (reference === null) {
    return {
      ...base,
      verdict: 'unverifiable',
      referenceHashMatch: null,
      notes: [
        `the recorded reference is ${entry.reference.w}x${entry.reference.h} but the source decodes to ${sourceImage.width}x${sourceImage.height}`,
        'refusing to fabricate pixels the source does not carry',
      ],
    }
  }
  const referenceHashMatch = hashRawImage(reference) === entry.reference.hash

  if (outputImage.width !== reference.width || outputImage.height !== reference.height) {
    return {
      ...base,
      verdict: 'refuted',
      referenceHashMatch,
      notes: [
        `the output decodes to ${outputImage.width}x${outputImage.height}; the recorded reference is ${reference.width}x${reference.height}`,
      ],
    }
  }

  const measuredSsim = ssim(reference, outputImage)
  const measuredDeltaE = deltaE(reference, outputImage).mean
  const metrics = [
    compare('ssim', entry.metrics.ssim, measuredSsim, SSIM_TOLERANCE),
    compare('deltaE', entry.metrics.deltaE, measuredDeltaE, DELTA_E_TOLERANCE),
    compare(
      'distortion',
      entry.metrics.distortion,
      distortion(measuredSsim, measuredDeltaE),
      DISTORTION_TOLERANCE,
    ),
  ]

  if (metrics.every((m) => m.withinTolerance)) {
    return {
      ...base,
      metrics,
      verdict: 'pass',
      referenceHashMatch,
      notes: referenceHashMatch
        ? [`re-measured from ${source.from}; the re-derived reference matches the recorded hash`]
        : [
            'the recorded numbers were reproduced within tolerance, but the re-derived reference does not hash to the recorded one (a resampler or orientation difference is the likely cause)',
          ],
    }
  }

  // An out-of-tolerance number only refutes the shipped file when the
  // reference it was measured against is provably the recorded one.
  // Otherwise the disagreement may come from derivation, and refusing to
  // guess which side is wrong is the honest verdict.
  if (!referenceHashMatch) {
    return {
      ...base,
      metrics,
      verdict: 'unverifiable',
      referenceHashMatch,
      notes: [
        'the re-measured numbers disagree with the receipt, but the re-derived reference also fails to hash to the recorded reference, so the disagreement may come from reference derivation rather than from the shipped file',
      ],
    }
  }
  return {
    ...base,
    metrics,
    verdict: 'refuted',
    referenceHashMatch,
    notes: [
      'the re-measured numbers disagree with the receipt beyond the documented decoder tolerance',
    ],
  }
}

/**
 * Verifies a ledger. `ledger` may be the ledger file itself or the directory
 * that contains .cupel/; asset paths in the receipts resolve against the
 * root the ledger sits in.
 */
export async function verifyLedger(ledger: string): Promise<VerifyReport> {
  const ledgerPath = ledger.endsWith('.jsonl')
    ? resolve(ledger)
    : join(resolve(ledger), '.cupel', 'ledger.jsonl')
  // .cupel/ledger.jsonl sits one level inside the root it describes.
  const root = resolve(dirname(ledgerPath), '..')
  const text = await readFile(ledgerPath, 'utf8')
  const { entries, skipped } = parseLedger(text)

  const results: EntryResult[] = []
  for (const entry of entries) {
    results.push(await verifyEntry(root, entry))
  }

  return {
    ledgerPath,
    root,
    results,
    skippedLines: skipped,
    totals: {
      pass: results.filter((r) => r.verdict === 'pass').length,
      refuted: results.filter((r) => r.verdict === 'refuted').length,
      unverifiable: results.filter((r) => r.verdict === 'unverifiable').length,
    },
  }
}

/** Exit codes per BRIEF: 0 all pass, 1 any refuted, 2 only unverifiable. */
export function exitCodeFor(report: VerifyReport): 0 | 1 | 2 {
  if (report.totals.refuted > 0) return 1
  if (report.totals.unverifiable > 0) return 2
  return 0
}
