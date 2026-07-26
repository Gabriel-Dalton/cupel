import { bytes, dims, heading, indentList, percent, table } from '../lib/format.js'
import type { AuditReport } from './engine.js'

/**
 * Audit output. The per-asset table is factual, the rollup states which
 * numbers are measured and which are modelled, and the caveats are part of
 * the report rather than a footnote nobody reads.
 */

function shorten(ref: string, max = 44): string {
  if (ref.length <= max) return ref
  return `...${ref.slice(ref.length - (max - 3))}`
}

function headroomCell(asset: AuditReport['assets'][number]): string {
  if (asset.headroom === null) return '?'
  if (asset.headroom === 'none') return 'NONE'
  return asset.headroom
}

export function renderAudit(report: AuditReport): string {
  const out: string[] = [heading(`cupel audit ${report.target}`)]

  if (report.assets.length === 0) {
    out.push('No images were found or inspected.')
    if (report.truncations.length > 0)
      out.push('', heading('Caveats'), indentList(report.truncations))
    return out.join('\n')
  }

  const rows: string[][] = [
    ['asset', 'kind', 'size', 'declared', 'display', 'q', 'gens', 'headroom', 'recoverable'],
  ]
  for (const asset of report.assets) {
    rows.push([
      shorten(asset.ref),
      asset.container ?? '?',
      bytes(asset.fileBytes ?? asset.bytesInspected),
      dims(asset.declared),
      asset.display ? dims(asset.display) : '-',
      asset.estimatedOriginalQuality === null ? '?' : String(asset.estimatedOriginalQuality),
      asset.generations === null ? '?' : String(asset.generations),
      headroomCell(asset),
      asset.recoverable.bytes === 0
        ? '-'
        : `${bytes(asset.recoverable.bytes)} (${percent(asset.recoverable.fraction)})`,
    ])
  }
  out.push(table(rows))

  const t = report.totals
  out.push(
    '',
    heading('Rollup'),
    table([
      ['assets inspected', String(t.assets)],
      ['total bytes', bytes(t.bytes)],
      [
        'estimated recoverable',
        `${bytes(t.recoverableBytes)} (${t.bytes > 0 ? percent(t.recoverableBytes / t.bytes) : '0.0%'}), modelled not measured`,
      ],
      ['would be refused', `${t.refused} (no quality headroom left)`],
      [
        'generation damage',
        report.pixelsDecoded
          ? `${t.generationDamaged} re-encoded at least twice`
          : 'undetermined without pixel decode',
      ],
      [
        'laundered lossless',
        report.pixelsDecoded
          ? `${t.launderedLossless} png/gif carrying JPEG artifacts`
          : 'undetermined without pixel decode',
      ],
      [
        'upscaled past real detail',
        report.pixelsDecoded ? String(t.upscaled) : 'undetermined without pixel decode',
      ],
    ]),
  )

  out.push('', heading('How to read this'), indentList(report.notes))
  if (report.truncations.length > 0) {
    out.push('', heading('Caveats and caps that fired'), indentList(report.truncations))
  }
  return out.join('\n')
}

export function auditJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2)
}
