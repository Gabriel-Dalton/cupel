import {
  ANNEX_K_CHROMA,
  ANNEX_K_LUMA,
  estimateJpegQuality,
  type JpegQuantTable,
  type QuantTableFamily,
  type SelectedQuantTables,
} from './jpeg-dqt.js'

/**
 * Encoder fingerprinting from quantization table signatures. Distinct
 * encoders ship distinct base tables, so an EXACT match of the observed
 * tables against a registry family scaled to some quality identifies the
 * encoder lineage. Anything short of exact returns null: a fingerprint is
 * an identification, and a near miss identifies nothing.
 *
 * The registry ships only families whose constants come straight from
 * published source code. Adobe Save for Web and phone ISP tables are real
 * and characteristic but their constants are not reproducible from an
 * authoritative source here, so they are deliberately absent until the
 * corpus contributes verified dumps (BRIEF 4.1: the registry grows by
 * contribution). quantSignature exists to make those contributions cheap:
 * unknown tables can be reported by hash and added once verified.
 */

export type FingerprintEntry = {
  /** Reported as ProvenanceRecord.encoderFingerprint on a match. */
  name: string
  family: QuantTableFamily
  /** Human context: what ships these tables, and how sure we are. */
  notes: string
}

export type FingerprintMatch = {
  name: string
  /** The quality at which the family's base tables scale to the observed. */
  quality: number
  notes: string
}

/**
 * ImageMagick's quantization table by Nicolas Robidoux (coders/jpeg.c),
 * adopted by mozjpeg as quant table index 3 and used as the cjpeg moz
 * default. mozjpeg applies the same table to both luma and chroma, which is
 * itself a strong signature: libjpeg lineages always ship two distinct
 * tables. Natural (row major) order.
 */
const MOZJPEG_TABLE = Uint16Array.from([
  16, 16, 16, 18, 25, 37, 56, 85, 16, 17, 20, 27, 34, 40, 53, 75, 16, 20, 24, 31, 43, 62, 91, 135,
  18, 27, 31, 40, 53, 74, 106, 156, 25, 34, 43, 53, 69, 94, 131, 189, 37, 40, 62, 74, 94, 124, 169,
  238, 56, 53, 91, 106, 131, 169, 226, 311, 85, 75, 135, 156, 189, 238, 311, 418,
])

export const MOZJPEG_FAMILY: QuantTableFamily = {
  name: 'mozjpeg',
  luma: MOZJPEG_TABLE,
  chroma: MOZJPEG_TABLE,
}

export const FINGERPRINT_REGISTRY: readonly FingerprintEntry[] = [
  {
    name: 'libjpeg',
    family: { name: 'libjpeg', luma: ANNEX_K_LUMA, chroma: ANNEX_K_CHROMA },
    notes:
      'ITU-T T.81 Annex K tables under libjpeg quality scaling. Ships identically in ' +
      'libjpeg, libjpeg-turbo, and mozjpeg builds that keep the default table index ' +
      '(libvips/sharp among them), so the table signature cannot separate those.',
  },
  {
    name: 'mozjpeg',
    family: MOZJPEG_FAMILY,
    notes:
      'mozjpeg -quant-table 3, the ImageMagick table by Nicolas Robidoux, applied to ' +
      'both luma and chroma. The cjpeg moz default.',
  },
]

/**
 * Identifies the encoder lineage behind a set of quantization tables.
 * A match requires the observed tables to be EXACTLY a registry family's
 * base tables scaled to some quality 1..100: luma always, chroma too when
 * the file carries one. If more than one registry entry matches (deeply
 * saturated tables at quality <= 3 collapse every family to all-255), the
 * evidence does not discriminate and the answer is null, never a pick.
 */
export function identifyEncoder(
  tables: SelectedQuantTables,
  registry: readonly FingerprintEntry[] = FINGERPRINT_REGISTRY,
): FingerprintMatch | null {
  if (!tables.luma) return null
  let match: FingerprintMatch | null = null
  for (const entry of registry) {
    const estimate = estimateJpegQuality(tables, [entry.family])
    if (!estimate || !estimate.exact) continue
    if (match !== null) return null
    match = { name: entry.name, quality: estimate.quality, notes: entry.notes }
  }
  return match
}

/**
 * Content hash of one quantization table: FNV-1a 32-bit over the precision
 * byte and the 64 values in natural order (big endian pairs), rendered as
 * eight lowercase hex characters. The destination id (slot) is deliberately
 * excluded: the signature keys what the table IS, not where it sat. Used to
 * report unknown tables so the registry can grow by contribution.
 */
export function quantSignature(table: JpegQuantTable): string {
  let hash = 0x811c9dc5
  const mix = (byte: number): void => {
    hash ^= byte & 0xff
    // FNV prime 16777619 via shifts, kept in uint32 range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  mix(table.precision)
  for (let i = 0; i < 64; i++) {
    const v = table.values[i] ?? 0
    mix(v >> 8)
    mix(v)
  }
  return hash.toString(16).padStart(8, '0')
}
