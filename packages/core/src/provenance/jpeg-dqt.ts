import type { ChromaSubsampling } from './types.js'

/**
 * JPEG marker-level parsing: quantization tables, frame header, chroma
 * subsampling, and recovery of the original encode quality by inverting the
 * libjpeg quality scaling relationship against known base tables.
 *
 * This is a HEADER parser, not a decoder. It walks SOI, DQT, SOF0/SOF2, and
 * stops at SOS. Entropy coded data is never touched, which is what makes the
 * same code safe to run over a ranged GET of the first 64 KB of a remote
 * file (BRIEF section 9.2).
 */

/**
 * Zigzag position k (stream order) maps to natural row major index
 * JPEG_ZIGZAG[k]. ITU-T T.81 figure 5.
 */
export const JPEG_ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

/** ITU-T T.81 Annex K.1 luminance table, natural (row major) order. */
export const ANNEX_K_LUMA: Uint16Array = Uint16Array.from([
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
])

/** ITU-T T.81 Annex K.2 chrominance table, natural (row major) order. */
export const ANNEX_K_CHROMA: Uint16Array = Uint16Array.from([
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
])

/** One quantization table recovered from a DQT segment. */
export type JpegQuantTable = {
  /** Table destination id Tq, 0..3. */
  id: number
  /** 8 for Pq=0 (one byte per entry), 16 for Pq=1 (two bytes, big endian). */
  precision: 8 | 16
  /** The 64 steps in natural (row major) order, de-zigzagged. */
  values: Uint16Array
}

/** One frame component from SOF: id, sampling factors, table binding. */
export type JpegComponent = {
  id: number
  h: number
  v: number
  quantTableId: number
}

export type JpegInfo = {
  /**
   * Tables in first-definition order. A redefinition of an id replaces the
   * earlier entry in place, matching how a decoder would end up seeing them.
   */
  tables: JpegQuantTable[]
  /** Declared dimensions from SOF, null when no SOF was seen. */
  width: number | null
  height: number | null
  /** Sample precision from SOF, null when no SOF was seen. */
  bitDepth: number | null
  /** True for SOF2 (progressive), false for SOF0/SOF1 or no SOF. */
  progressive: boolean
  components: JpegComponent[]
  /**
   * Derived from SOF sampling factors. 'none' for grayscale. null when no
   * SOF was seen or the factors fall outside the declared vocabulary
   * (e.g. 4:4:0): the honest null, never the nearest guess.
   */
  chromaSubsampling: ChromaSubsampling | null
  /** True when the walk ran out of bytes before reaching SOS or EOI. */
  truncated: boolean
}

/** The tables actually referenced by the frame's components. */
export type SelectedQuantTables = {
  luma: JpegQuantTable | null
  chroma: JpegQuantTable | null
}

/**
 * A base table pair that some encoder family scales by the libjpeg quality
 * formula. Plain arrays are accepted so vendor families can be passed as
 * literals.
 */
export type QuantTableFamily = {
  name: string
  /** Base luminance table, natural order, 64 entries. */
  luma: ArrayLike<number>
  /** Base chrominance table, natural order, 64 entries. */
  chroma: ArrayLike<number>
}

export const LIBJPEG_FAMILY: QuantTableFamily = {
  name: 'libjpeg',
  luma: ANNEX_K_LUMA,
  chroma: ANNEX_K_CHROMA,
}

export type JpegQualityEstimate = {
  /** Recovered libjpeg-style quality, 1..100. Accurate to about 2 points. */
  quality: number
  /** True when the observed tables are exactly the scaled base tables. */
  exact: boolean
  /** Mean per-coefficient relative deviation at the best fit. 0 when exact. */
  fitError: number
  /** Name of the winning QuantTableFamily. */
  family: string
}

/**
 * Fits above this mean relative deviation are rejected as "not this family
 * at any quality" and the estimator returns null instead of a guess. The
 * closest legitimate case in the tests (a vendor tweak nudging six entries
 * by one step at q80) fits at about 0.005; alien tables fit no better than
 * several times this threshold at any quality.
 */
const MAX_FIT_ERROR = 0.05

/** Marker byte values. Only the ones the walk must recognize by name. */
const M_SOI = 0xd8
const M_EOI = 0xd9
const M_SOS = 0xda
const M_DQT = 0xdb
const M_SOF0 = 0xc0
const M_SOF1 = 0xc1
const M_SOF2 = 0xc2
const M_TEM = 0x01

/**
 * libjpeg's jpeg_quality_scaling plus the per-entry scaling from
 * jpeg_add_quant_table, C integer division semantics included. limit is 255
 * for baseline 8-bit tables and 32767 for 16-bit (Pq=1) tables.
 */
export function scaleQuantTable(base: ArrayLike<number>, quality: number, limit = 255): Uint16Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const s = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q
  const out = new Uint16Array(64)
  for (let i = 0; i < 64; i++) {
    const v = Math.floor(((base[i] ?? 0) * s + 50) / 100)
    out[i] = Math.min(limit, Math.max(1, v))
  }
  return out
}

/**
 * Walks the marker stream of a JPEG header. Returns null when the bytes do
 * not begin with SOI (this is strict: an embedded JPEG mid-buffer does not
 * count). Any structural damage past a valid SOI (truncation mid segment,
 * a declared length that overruns the buffer, a stray non-marker byte) ends
 * the walk with whatever was recovered so far and truncated: true.
 */
export function parseJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== M_SOI) return null

  const tables = new Map<number, JpegQuantTable>()
  let width: number | null = null
  let height: number | null = null
  let bitDepth: number | null = null
  let progressive = false
  let components: JpegComponent[] = []
  let chromaSubsampling: ChromaSubsampling | null = null
  let truncated = true

  let pos = 2
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) break
    // Any number of 0xFF fill bytes may precede a marker (T.81 B.1.1.2).
    while (pos < bytes.length && bytes[pos] === 0xff) pos++
    if (pos >= bytes.length) break
    const marker = bytes[pos] ?? 0
    pos++

    // 0xFF00 is a stuffed data byte and only legal inside entropy coded
    // data, which this walk never enters. Treat it as damage.
    if (marker === 0x00) break
    // Standalone markers carry no length field.
    if (marker === M_SOI || marker === M_TEM || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === M_EOI) {
      truncated = false
      break
    }

    if (pos + 2 > bytes.length) break
    const length = ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0)
    if (length < 2) break
    const segStart = pos + 2
    const segEnd = pos + length
    if (segEnd > bytes.length) break

    if (marker === M_DQT) {
      if (!parseDqtPayload(bytes, segStart, segEnd, tables)) break
    } else if ((marker === M_SOF0 || marker === M_SOF1 || marker === M_SOF2) && width === null) {
      const sof = parseSofPayload(bytes, segStart, segEnd)
      if (sof === null) break
      width = sof.width
      height = sof.height
      bitDepth = sof.bitDepth
      progressive = marker === M_SOF2
      components = sof.components
      chromaSubsampling = deriveSubsampling(sof.components)
    } else if (marker === M_SOS) {
      // Everything the header can say has been said. Entropy coded data
      // begins after this segment and is never parsed.
      truncated = false
      break
    }
    pos = segEnd
  }

  return {
    tables: [...tables.values()],
    width,
    height,
    bitDepth,
    progressive,
    components,
    chromaSubsampling,
    truncated,
  }
}

/**
 * One DQT segment holds one or more tables back to back: a Pq/Tq byte then
 * 64 entries in zigzag order, one byte each for Pq=0 and two (big endian)
 * for Pq=1. Values are de-zigzagged into natural order here. Returns false
 * on a malformed payload (bad Pq, table cut short by the declared length).
 */
function parseDqtPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
  tables: Map<number, JpegQuantTable>,
): boolean {
  let p = start
  while (p < end) {
    const pqtq = bytes[p] ?? 0
    p++
    const pq = pqtq >> 4
    const id = pqtq & 0x0f
    if (pq > 1 || id > 3) return false
    const wide = pq === 1
    if (p + (wide ? 128 : 64) > end) return false
    const values = new Uint16Array(64)
    for (let k = 0; k < 64; k++) {
      const v = wide ? (((bytes[p] ?? 0) << 8) | (bytes[p + 1] ?? 0)) : (bytes[p] ?? 0)
      p += wide ? 2 : 1
      values[JPEG_ZIGZAG[k] ?? 0] = v
    }
    // Map.set keeps first-insertion order, so a redefinition replaces the
    // earlier table in place: last definition wins.
    tables.set(id, { id, precision: wide ? 16 : 8, values })
  }
  return true
}

function parseSofPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number; bitDepth: number; components: JpegComponent[] } | null {
  if (start + 6 > end) return null
  const bitDepth = bytes[start] ?? 0
  const height = ((bytes[start + 1] ?? 0) << 8) | (bytes[start + 2] ?? 0)
  const width = ((bytes[start + 3] ?? 0) << 8) | (bytes[start + 4] ?? 0)
  const count = bytes[start + 5] ?? 0
  if (start + 6 + count * 3 > end) return null
  const components: JpegComponent[] = []
  for (let i = 0; i < count; i++) {
    const o = start + 6 + i * 3
    const hv = bytes[o + 1] ?? 0
    components.push({
      id: bytes[o] ?? 0,
      h: hv >> 4,
      v: hv & 0x0f,
      quantTableId: bytes[o + 2] ?? 0,
    })
  }
  return { width, height, bitDepth, components }
}

/**
 * Subsampling from sampling factors. Grayscale carries no chroma at all
 * ('none'). Three-component frames map by the luma-to-chroma sampling
 * ratio; anything outside {1:1, 2:1, 2:2} with matching chroma factors
 * (e.g. 4:4:0, or a four-component CMYK frame) reports null.
 */
function deriveSubsampling(components: JpegComponent[]): ChromaSubsampling | null {
  if (components.length === 1) return 'none'
  if (components.length !== 3) return null
  const [y, cb, cr] = components
  if (!y || !cb || !cr) return null
  if (cb.h !== cr.h || cb.v !== cr.v) return null
  if (cb.h < 1 || cb.v < 1 || y.h % cb.h !== 0 || y.v % cb.v !== 0) return null
  const rh = y.h / cb.h
  const rv = y.v / cb.v
  if (rh === 1 && rv === 1) return '4:4:4'
  if (rh === 2 && rv === 1) return '4:2:2'
  if (rh === 2 && rv === 2) return '4:2:0'
  return null
}

/**
 * Maps frame components to their quantization tables. The first component
 * is luma by JPEG convention; the second carries the chroma table (Cb and
 * Cr virtually always share one). Without a SOF the JPEG convention of
 * table 0 for luma and table 1 for chroma is the only sensible fallback.
 */
export function selectQuantTables(info: JpegInfo): SelectedQuantTables {
  const byId = new Map(info.tables.map((t) => [t.id, t]))
  const lumaComponent = info.components[0]
  if (lumaComponent) {
    const chromaComponent = info.components[1]
    return {
      luma: byId.get(lumaComponent.quantTableId) ?? null,
      chroma: chromaComponent ? (byId.get(chromaComponent.quantTableId) ?? null) : null,
    }
  }
  return { luma: byId.get(0) ?? null, chroma: byId.get(1) ?? null }
}

/** Sum of relative deviations |observed - predicted| / predicted. */
function accumulateError(observed: Uint16Array, predicted: Uint16Array): number {
  let sum = 0
  for (let i = 0; i < 64; i++) {
    const p = predicted[i] ?? 1
    sum += Math.abs((observed[i] ?? 0) - p) / p
  }
  return sum
}

/**
 * Recovers the original encode quality by inverting the libjpeg scaling:
 * for each candidate family and each quality 1..100, scale the family's
 * base tables (with the clamp limit implied by the observed precision) and
 * measure the mean per-coefficient relative deviation against the observed
 * tables. The best fit wins; ties go to the earlier family and the lower
 * quality. Fits worse than MAX_FIT_ERROR return null: unknown tables are
 * reported as unknown, never as the nearest guess.
 *
 * The luma table alone is enough to estimate (grayscale JPEGs exist); when
 * a chroma table is present it participates in the fit and sharpens it.
 */
export function estimateJpegQuality(
  tables: SelectedQuantTables,
  families: readonly QuantTableFamily[] = [LIBJPEG_FAMILY],
): JpegQualityEstimate | null {
  const luma = tables.luma
  if (!luma) return null
  const chroma = tables.chroma
  const lumaLimit = luma.precision === 16 ? 32767 : 255
  const chromaLimit = chroma && chroma.precision === 16 ? 32767 : 255
  const coefficients = chroma ? 128 : 64

  let best: JpegQualityEstimate | null = null
  for (const family of families) {
    for (let q = 1; q <= 100; q++) {
      let sum = accumulateError(luma.values, scaleQuantTable(family.luma, q, lumaLimit))
      if (chroma) {
        sum += accumulateError(chroma.values, scaleQuantTable(family.chroma, q, chromaLimit))
      }
      const fitError = sum / coefficients
      if (best === null || fitError < best.fitError) {
        best = { quality: q, exact: fitError === 0, fitError, family: family.name }
      }
    }
  }
  if (best === null || best.fitError > MAX_FIT_ERROR) return null
  return best
}
