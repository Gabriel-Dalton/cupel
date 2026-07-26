import type { Examined } from '../lib/analyze.js'
import { bytes, dims, heading, indentList, orUnknown, table } from '../lib/format.js'

/**
 * The provenance report: what has already been done to this file. Every
 * line is evidence with its uncertainty attached, and "undetermined" is a
 * legitimate answer that appears often. The one derived verdict is headroom,
 * and it is printed with the reasons that produced it so a reader can
 * disagree with it.
 */

export function renderReport(examined: Examined): string {
  const { path, container, provenance } = examined
  const sections: string[] = [heading(`cupel inspect ${path}`)]

  if (!provenance) {
    sections.push(
      table([
        ['container', container],
        ['file size', bytes(examined.bytes.length)],
      ]),
      '',
      examined.note ?? 'no provenance available for this container',
    )
    return sections.join('\n')
  }

  const rows: string[][] = [
    ['container', container],
    ['file size', bytes(examined.bytes.length)],
    ['declared resolution', dims(provenance.declaredResolution)],
    ['effective resolution', dims(provenance.effectiveResolution)],
    ['upscaled', provenance.upscaled ? 'yes, past its real detail' : 'no'],
    ['chroma subsampling', orUnknown(provenance.chromaSubsampling)],
    ['estimated original quality', orUnknown(provenance.estimatedOriginalQuality, ' (+/- 2)')],
    ['encoder fingerprint', orUnknown(provenance.encoderFingerprint)],
    ['encode generations', orUnknown(provenance.generations)],
    ['blocking score', provenance.blockingScore.toFixed(2)],
    [
      'softness',
      `${provenance.softness.verdict} (p95 laplacian ${provenance.softness.p95Laplacian.toFixed(1)})`,
    ],
    ['headroom', provenance.headroom],
  ]

  sections.push(table(rows), '', heading('Evidence'), indentList(provenance.evidence))

  if (provenance.headroom === 'none') {
    sections.push(
      '',
      'Verdict: cupel would refuse to re-encode this file. There is no quality left to',
      'spend, so another generation would cost detail and buy nothing. Recover a better',
      'original instead.',
    )
  }

  return sections.join('\n')
}

/** The --json payload: the record plus the file facts, nothing invented. */
export function reportJson(examined: Examined): string {
  return JSON.stringify(
    {
      path: examined.path,
      container: examined.container,
      fileBytes: examined.bytes.length,
      provenance: examined.provenance,
      note: examined.note,
    },
    null,
    2,
  )
}
