import { bytes, heading, indentList, percent, table } from '../lib/format.js'
import type { ApplyResult } from './apply.js'
import { outputPathFor, type Plan } from './plan.js'

/**
 * What the operator reads before deciding to apply. Refusals and skips are
 * listed as prominently as encodes: a run that refuses four files and
 * encodes one has done its job, and hiding the refusals would misrepresent
 * what the tool is for.
 */

function decisionLabel(decision: string): string {
  return decision === 'refused' ? 'REFUSED' : decision
}

export function renderPlan(plan: Plan, applied: ApplyResult | null): string {
  const out: string[] = [
    heading(applied === null ? `cupel write ${plan.root} (dry run)` : `cupel write ${plan.root}`),
  ]

  if (plan.assets.length === 0) {
    out.push('No images were found.')
    if (plan.skipped.length > 0) out.push('', heading('Skipped'), indentList(plan.skipped))
    return out.join('\n')
  }

  const rows: string[][] = [['asset', 'decision', 'before', 'after', 'saved', 'ssim', 'output']]
  let before = 0
  let after = 0
  for (const planned of plan.assets) {
    const sourceBytes = planned.sourceBytes.length
    before += sourceBytes
    const chosen = planned.decision.decision === 'encoded' ? planned.decision.chosen : null
    after += chosen === null ? sourceBytes : chosen.bytes
    rows.push([
      planned.asset,
      decisionLabel(planned.decision.decision),
      bytes(sourceBytes),
      chosen === null ? '-' : bytes(chosen.bytes),
      chosen === null ? '-' : percent((sourceBytes - chosen.bytes) / sourceBytes),
      chosen === null ? '-' : chosen.ssim.toFixed(4),
      chosen === null ? '-' : outputPathFor(planned.asset, chosen.format),
    ])
  }
  out.push(table(rows))

  out.push(
    '',
    heading('Reasons'),
    indentList(plan.assets.map((p) => `${p.asset}: ${p.decision.reason}`)),
  )

  const encodedCount = plan.assets.filter((p) => p.decision.decision === 'encoded').length
  const refusedCount = plan.assets.filter((p) => p.decision.decision === 'refused').length
  out.push(
    '',
    heading('Totals'),
    table([
      ['assets considered', String(plan.assets.length)],
      ['would encode', String(encodedCount)],
      ['refused for exhausted headroom', String(refusedCount)],
      ['kept or skipped', String(plan.assets.length - encodedCount - refusedCount)],
      ['bytes before', bytes(before)],
      ['bytes after', bytes(after)],
      [
        'saved',
        before > 0 ? `${bytes(before - after)} (${percent((before - after) / before)})` : '0 B',
      ],
    ]),
  )

  if (plan.skipped.length > 0) out.push('', heading('Skipped'), indentList(plan.skipped))

  if (applied === null) {
    out.push(
      '',
      'Nothing was written. This was a dry run, which is the default.',
      'Re-run with --apply to write these outputs and the receipts in .cupel/ledger.jsonl.',
    )
    return out.join('\n')
  }

  out.push(
    '',
    heading('Applied'),
    table([
      ['outputs written', String(applied.written.length)],
      ['originals preserved', String(applied.preserved.length)],
      ['receipts appended', `${applied.entries.length} in .cupel/ledger.jsonl`],
    ]),
  )
  if (applied.unrecorded.length > 0) {
    out.push('', heading('Not recorded'), indentList(applied.unrecorded))
  }
  out.push('', 'Run cupel verify to re-measure these outputs against the receipts.')
  return out.join('\n')
}
