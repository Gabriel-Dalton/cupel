import { matchEntry } from './match'
import { remeasure } from './measure'
import type {
  DecodeFn,
  EntryReport,
  ParsedLedger,
  Verdict,
  VerifyFile,
  VerifyReport,
  VerifySummary,
} from './types'

/**
 * The full pipeline over a parsed ledger: match every entry against the
 * provided files, re-measure the ones where re-measurement applies, and
 * fold the outcome into per-entry reports plus one summary. Entries are
 * processed sequentially: decoding is the expensive step and the progress
 * callback exists so the page can narrate it.
 */
export async function verifyLedger(
  parsed: ParsedLedger,
  files: readonly VerifyFile[],
  decode: DecodeFn,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyReport> {
  const reports: EntryReport[] = []
  const total = parsed.entries.length
  let done = 0
  for (const { line, entry } of parsed.entries) {
    const match = matchEntry(entry, files)
    if (match.classification === 'verifiable' && match.output && match.source) {
      const measured = await remeasure(entry, match.output, match.source, decode)
      reports.push({
        line,
        entry,
        classification: match.classification,
        verdict: measured.verdict,
        notes: [...match.notes, ...measured.notes],
        metrics: measured.metrics,
        referenceHashMatch: measured.referenceHashMatch,
      })
    } else {
      reports.push({
        line,
        entry,
        classification: match.classification,
        verdict: match.verdict ?? 'unverifiable',
        notes: match.notes,
        metrics: null,
        referenceHashMatch: null,
      })
    }
    done += 1
    onProgress?.(done, total)
  }
  return { reports, summary: summarize(reports, parsed.skipped.length) }
}

export function summarize(reports: readonly EntryReport[], skippedLines: number): VerifySummary {
  const summary: VerifySummary = {
    entries: reports.length,
    pass: 0,
    fail: 0,
    unverifiable: 0,
    skippedLines,
  }
  for (const report of reports) {
    if (report.verdict === 'pass') summary.pass += 1
    else if (report.verdict === 'fail') summary.fail += 1
    else summary.unverifiable += 1
  }
  return summary
}

/**
 * Failures first: a refuted receipt is the reason this page exists, so it
 * is never buried under a screen of confirmations. Ties keep ledger order.
 */
const VERDICT_ORDER: Record<Verdict, number> = { fail: 0, unverifiable: 1, pass: 2 }

export function orderForDisplay(reports: readonly EntryReport[]): EntryReport[] {
  return [...reports].sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.line - b.line,
  )
}
