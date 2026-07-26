import type { LedgerDecision, LedgerEntryV1 } from '@cupel/core'
import type { ParsedLedger, ParsedLine, SkippedLine } from './types'

/**
 * Tolerant JSON Lines parsing for .cupel/ledger.jsonl.
 *
 * Tolerant means: one bad line never poisons the file. Blank lines are
 * ignored silently; every other line either validates against the frozen
 * LedgerEntryV1 shape or is skipped with a line number and a reason the
 * page can show. Unknown extra fields are accepted (a future writer may add
 * signatures), but a field the schema requires must be present and typed
 * correctly, because everything downstream relies on it.
 */

const DECISIONS: readonly string[] = [
  'encoded',
  'kept',
  'refused',
  'skipped',
] satisfies readonly LedgerDecision[]

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const nonEmpty = (v: unknown): v is string => isStr(v) && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPosInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0

export type ValidationResult = { ok: true; entry: LedgerEntryV1 } | { ok: false; reason: string }

/** Returns the reason a value is not a LedgerEntryV1, or null when it is. */
function entryProblem(value: unknown): string | null {
  if (!isRec(value)) return 'not a JSON object'
  if (value.v !== 1) return 'v must be 1'
  if (!nonEmpty(value.ts)) return 'ts must be a non-empty string'
  if (!nonEmpty(value.asset)) return 'asset must be a non-empty string'
  if (!nonEmpty(value.sourceHash)) return 'sourceHash must be a non-empty string'
  if (value.outputHash !== null && !nonEmpty(value.outputHash)) {
    return 'outputHash must be a non-empty string or null'
  }
  const recovered = value.sourceRecovered
  if (
    recovered !== null &&
    !(isRec(recovered) && nonEmpty(recovered.from) && nonEmpty(recovered.via))
  ) {
    return 'sourceRecovered must be { from, via } or null'
  }
  const reference = value.reference
  if (
    !isRec(reference) ||
    !isPosInt(reference.w) ||
    !isPosInt(reference.h) ||
    !nonEmpty(reference.hash)
  ) {
    return 'reference must be { w, h, hash } with positive integer dimensions'
  }
  if (!isStr(value.decision) || !DECISIONS.includes(value.decision)) {
    return `decision must be one of: ${DECISIONS.join(', ')}`
  }
  if (value.reason !== null && !isStr(value.reason)) return 'reason must be a string or null'
  const output = value.output
  if (
    output !== null &&
    !(
      isRec(output) &&
      nonEmpty(output.format) &&
      (output.quality === null || isNum(output.quality)) &&
      isNum(output.bytes)
    )
  ) {
    return 'output must be { format, quality, bytes } or null'
  }
  const before = value.before
  if (!isRec(before) || !nonEmpty(before.format) || !isNum(before.bytes)) {
    return 'before must be { format, bytes }'
  }
  const metrics = value.metrics
  if (
    metrics !== null &&
    !(isRec(metrics) && isNum(metrics.ssim) && isNum(metrics.deltaE) && isNum(metrics.distortion))
  ) {
    return 'metrics must be { ssim, deltaE, distortion } with finite numbers, or null'
  }
  if (value.weight !== null && !isNum(value.weight)) return 'weight must be a finite number or null'
  if (value.lambda !== null && !isNum(value.lambda)) return 'lambda must be a finite number or null'
  const provenance = value.provenance
  if (
    provenance !== null &&
    !(
      isRec(provenance) &&
      (provenance.generations === null || isNum(provenance.generations)) &&
      (provenance.estimatedOriginalQuality === null ||
        isNum(provenance.estimatedOriginalQuality)) &&
      (provenance.headroom === 'normal' ||
        provenance.headroom === 'low' ||
        provenance.headroom === 'none')
    )
  ) {
    return 'provenance must be { generations, estimatedOriginalQuality, headroom } or null'
  }
  if (value.encoder !== null && !isStr(value.encoder)) return 'encoder must be a string or null'
  if (!nonEmpty(value.tool)) return 'tool must be a non-empty string'
  if (
    value.decision === 'encoded' &&
    (value.outputHash === null || output === null || metrics === null)
  ) {
    return 'an "encoded" entry must record outputHash, output, and metrics'
  }
  return null
}

export function validateEntry(value: unknown): ValidationResult {
  const problem = entryProblem(value)
  if (problem !== null) return { ok: false, reason: problem }
  // Every schema field was just checked structurally; the cast records that.
  return { ok: true, entry: value as LedgerEntryV1 }
}

export function parseLedger(text: string): ParsedLedger {
  const entries: ParsedLine[] = []
  const skipped: SkippedLine[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1
    // trim() also strips the \r a CRLF file leaves behind.
    const raw = (lines[i] ?? '').trim()
    if (raw === '') continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      skipped.push({ line, reason: `invalid JSON: ${detail}` })
      continue
    }
    const result = validateEntry(value)
    if (result.ok) {
      entries.push({ line, entry: result.entry })
    } else {
      skipped.push({ line, reason: result.reason })
    }
  }
  return { entries, skipped }
}
