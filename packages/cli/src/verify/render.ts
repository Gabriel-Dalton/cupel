import { heading, indentList, table } from '../lib/format.js'
import type { VerifyReport } from './verify.js'

/**
 * Verification output. Refusal-led: "unverifiable" is printed as its own
 * verdict rather than being rounded to pass or fail, because the difference
 * between "these bytes do not match the receipt" and "I could not check"
 * matters more than either number.
 */

const VERDICT_LABEL = {
  pass: 'pass',
  refuted: 'REFUTED',
  unverifiable: 'unverifiable',
} as const

export function renderVerify(report: VerifyReport): string {
  const out: string[] = [heading(`cupel verify ${report.ledgerPath}`)]

  if (report.results.length === 0) {
    out.push('The ledger contains no usable entries.')
    if (report.skippedLines.length > 0) {
      out.push('', heading('Skipped lines'), indentList(report.skippedLines))
    }
    return out.join('\n')
  }

  const rows: string[][] = [['asset', 'decision', 'verdict', 'ssim', 'deltaE', 'ref hash']]
  for (const result of report.results) {
    const ssimRow = result.metrics.find((m) => m.metric === 'ssim')
    const deltaRow = result.metrics.find((m) => m.metric === 'deltaE')
    rows.push([
      result.asset,
      result.decision,
      VERDICT_LABEL[result.verdict],
      ssimRow ? `${ssimRow.measured.toFixed(4)} vs ${ssimRow.recorded.toFixed(4)}` : '-',
      deltaRow ? `${deltaRow.measured.toFixed(3)} vs ${deltaRow.recorded.toFixed(3)}` : '-',
      result.referenceHashMatch === null ? '-' : result.referenceHashMatch ? 'match' : 'differs',
    ])
  }
  out.push(table(rows))

  const detailed = report.results.filter((r) => r.verdict !== 'pass' || r.notes.length > 0)
  if (detailed.length > 0) {
    out.push(
      '',
      heading('Notes'),
      indentList(detailed.flatMap((r) => r.notes.map((note) => `${r.asset}: ${note}`))),
    )
  }

  const t = report.totals
  out.push(
    '',
    heading('Totals'),
    table([
      ['confirmed', String(t.pass)],
      ['refuted', String(t.refuted)],
      ['unverifiable', String(t.unverifiable)],
    ]),
  )

  if (report.skippedLines.length > 0) {
    out.push('', heading('Skipped lines'), indentList(report.skippedLines))
  }

  out.push(
    '',
    t.refuted > 0
      ? 'At least one receipt does not describe the bytes on disk.'
      : t.unverifiable > 0
        ? 'Nothing was refuted, but not everything could be checked.'
        : 'Every receipt was re-measured and confirmed.',
  )
  return out.join('\n')
}

export function verifyJson(report: VerifyReport): string {
  return JSON.stringify(report, null, 2)
}
