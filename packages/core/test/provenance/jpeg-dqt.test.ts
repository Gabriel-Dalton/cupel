import { describe, expect, it } from 'vitest'
import {
  ANNEX_K_CHROMA,
  ANNEX_K_LUMA,
  LIBJPEG_FAMILY,
  estimateJpegQuality,
  parseJpeg,
  scaleQuantTable,
  selectQuantTables,
  type JpegQuantTable,
  type SelectedQuantTables,
} from '../../src/provenance/jpeg-dqt.js'

// Synthetic JPEG segment builders. Everything below is generated in code so
// the repo carries no binary fixtures. The builders write DQT values in the
// stream's zigzag order and the tests hold their own independent copies of
// the zigzag map, the Annex K tables, and the libjpeg scaling formula, so a
// wrong constant in the source cannot silently vindicate itself.

/** Zigzag position k maps to natural (row major) index TEST_ZIGZAG[k]. */
const TEST_ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

/** Annex K luminance table, natural order, independent copy. */
const TEST_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

/** Annex K chrominance table, natural order, independent copy. */
const TEST_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]

/**
 * Independent copy of libjpeg's quality scaling: integer division semantics
 * included (jpeg_quality_scaling uses C integer division for q < 50), clamp
 * to [1, limit] where limit is 255 baseline or 32767 for 16-bit tables.
 */
function testScale(base: readonly number[], quality: number, limit = 255): number[] {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const s = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q
  return base.map((b) => {
    const v = Math.floor((b * s + 50) / 100)
    return Math.min(limit, Math.max(1, v))
  })
}

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]
}

type DqtSpec = { id: number; precision?: 8 | 16; values: readonly number[] }

/** One DQT segment holding one or more tables back to back. */
function dqtSegment(tables: DqtSpec[]): number[] {
  const payload: number[] = []
  for (const t of tables) {
    const pq = (t.precision ?? 8) === 16 ? 1 : 0
    payload.push((pq << 4) | t.id)
    for (let k = 0; k < 64; k++) {
      const v = t.values[TEST_ZIGZAG[k] ?? 0] ?? 0
      if (pq === 1) payload.push((v >> 8) & 0xff, v & 0xff)
      else payload.push(v & 0xff)
    }
  }
  return seg(0xdb, payload)
}

type SofComp = { id: number; h: number; v: number; tq: number }

function sofSegment(marker: number, width: number, height: number, comps: SofComp[]): number[] {
  const payload: number[] = [
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    comps.length,
  ]
  for (const c of comps) payload.push(c.id, (c.h << 4) | c.v, c.tq)
  return seg(marker, payload)
}

const THREE_COMPONENTS_420: SofComp[] = [
  { id: 1, h: 2, v: 2, tq: 0 },
  { id: 2, h: 1, v: 1, tq: 1 },
  { id: 3, h: 1, v: 1, tq: 1 },
]

function sosSegment(): number[] {
  return seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
}

function jpegBytes(...parts: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat()])
}

/** A complete synthetic header: DQT (both tables), SOF0 4:2:0, SOS. */
function standardJpeg(quality: number): Uint8Array {
  return jpegBytes(
    dqtSegment([
      { id: 0, values: testScale(TEST_LUMA, quality) },
      { id: 1, values: testScale(TEST_CHROMA, quality) },
    ]),
    sofSegment(0xc0, 640, 480, THREE_COMPONENTS_420),
    sosSegment(),
    [0x12, 0x34, 0x56], // fake entropy coded data, must never be parsed
  )
}

function tableOf(values: readonly number[], id = 0, precision: 8 | 16 = 8): JpegQuantTable {
  return { id, precision, values: Uint16Array.from(values) }
}

function selected(luma: readonly number[], chroma: readonly number[] | null): SelectedQuantTables {
  return { luma: tableOf(luma, 0), chroma: chroma ? tableOf(chroma, 1) : null }
}

describe('parseJpeg marker walk', () => {
  it('returns null for non JPEG bytes', () => {
    expect(parseJpeg(new Uint8Array(0))).toBeNull()
    expect(parseJpeg(Uint8Array.from([0xff]))).toBeNull()
    // PNG signature
    expect(parseJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull()
    // JPEG SOI in the middle does not count
    expect(parseJpeg(Uint8Array.from([0x00, 0xff, 0xd8, 0xff, 0xdb]))).toBeNull()
  })

  it('de-zigzags DQT values back to natural order', () => {
    // Natural order table 1..64: after the builder writes it in zigzag
    // stream order the parser must hand back exactly 1..64 again.
    const natural = Array.from({ length: 64 }, (_, i) => i + 1)
    const info = parseJpeg(jpegBytes(dqtSegment([{ id: 0, values: natural }]), sosSegment()))
    expect(info).not.toBeNull()
    expect(Array.from(info?.tables[0]?.values ?? [])).toEqual(natural)
  })

  it('parses two tables from a single DQT segment', () => {
    const info = parseJpeg(standardJpeg(75))
    expect(info?.tables).toHaveLength(2)
    expect(info?.tables[0]?.id).toBe(0)
    expect(info?.tables[1]?.id).toBe(1)
    expect(Array.from(info?.tables[0]?.values ?? [])).toEqual(testScale(TEST_LUMA, 75))
    expect(Array.from(info?.tables[1]?.values ?? [])).toEqual(testScale(TEST_CHROMA, 75))
  })

  it('collects tables across multiple DQT segments', () => {
    const info = parseJpeg(
      jpegBytes(
        dqtSegment([{ id: 0, values: testScale(TEST_LUMA, 60) }]),
        dqtSegment([{ id: 1, values: testScale(TEST_CHROMA, 60) }]),
        sofSegment(0xc0, 100, 50, THREE_COMPONENTS_420),
        sosSegment(),
      ),
    )
    expect(info?.tables).toHaveLength(2)
    expect(Array.from(info?.tables[1]?.values ?? [])).toEqual(testScale(TEST_CHROMA, 60))
  })

  it('parses 16-bit (Pq=1) tables big endian', () => {
    // Quality 5 without the baseline clamp produces values above 255, which
    // is exactly what 16-bit tables exist for.
    const values = testScale(TEST_LUMA, 5, 32767)
    expect(Math.max(...values)).toBeGreaterThan(255)
    const info = parseJpeg(
      jpegBytes(dqtSegment([{ id: 0, precision: 16, values }]), sosSegment()),
    )
    expect(info?.tables[0]?.precision).toBe(16)
    expect(Array.from(info?.tables[0]?.values ?? [])).toEqual(values)
  })

  it('last definition wins when a table id is redefined', () => {
    const first = testScale(TEST_LUMA, 40)
    const second = testScale(TEST_LUMA, 80)
    const info = parseJpeg(
      jpegBytes(
        dqtSegment([{ id: 0, values: first }]),
        dqtSegment([{ id: 0, values: second }]),
        sosSegment(),
      ),
    )
    expect(info?.tables).toHaveLength(1)
    expect(Array.from(info?.tables[0]?.values ?? [])).toEqual(second)
  })

  it('reads dimensions, bit depth, and components from SOF0', () => {
    const info = parseJpeg(standardJpeg(75))
    expect(info?.width).toBe(640)
    expect(info?.height).toBe(480)
    expect(info?.bitDepth).toBe(8)
    expect(info?.progressive).toBe(false)
    expect(info?.components).toHaveLength(3)
    expect(info?.components[0]).toEqual({ id: 1, h: 2, v: 2, quantTableId: 0 })
  })

  it('flags SOF2 as progressive', () => {
    const info = parseJpeg(
      jpegBytes(sofSegment(0xc2, 32, 32, THREE_COMPONENTS_420), sosSegment()),
    )
    expect(info?.progressive).toBe(true)
  })

  it('derives chroma subsampling from sampling factors', () => {
    const subsampling = (comps: SofComp[]) =>
      parseJpeg(jpegBytes(sofSegment(0xc0, 64, 64, comps), sosSegment()))?.chromaSubsampling
    expect(subsampling(THREE_COMPONENTS_420)).toBe('4:2:0')
    expect(
      subsampling([
        { id: 1, h: 2, v: 1, tq: 0 },
        { id: 2, h: 1, v: 1, tq: 1 },
        { id: 3, h: 1, v: 1, tq: 1 },
      ]),
    ).toBe('4:2:2')
    expect(
      subsampling([
        { id: 1, h: 1, v: 1, tq: 0 },
        { id: 2, h: 1, v: 1, tq: 1 },
        { id: 3, h: 1, v: 1, tq: 1 },
      ]),
    ).toBe('4:4:4')
    // Grayscale carries no chroma at all.
    expect(subsampling([{ id: 1, h: 1, v: 1, tq: 0 }])).toBe('none')
    // 4:4:0 style factors are real but outside the declared vocabulary:
    // report the honest null, never the nearest guess.
    expect(
      subsampling([
        { id: 1, h: 1, v: 2, tq: 0 },
        { id: 2, h: 1, v: 1, tq: 1 },
        { id: 3, h: 1, v: 1, tq: 1 },
      ]),
    ).toBeNull()
  })

  it('skips APPn and COM segments it does not understand', () => {
    const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 2, 0, 0, 1, 0, 1, 0, 0])
    const comment = seg(0xfe, [0x68, 0x69])
    const info = parseJpeg(
      jpegBytes(app0, comment, dqtSegment([{ id: 0, values: testScale(TEST_LUMA, 85) }]), sosSegment()),
    )
    expect(info?.tables).toHaveLength(1)
    expect(info?.truncated).toBe(false)
  })

  it('tolerates 0xFF fill bytes before a marker', () => {
    const info = parseJpeg(
      jpegBytes([0xff, 0xff, 0xff], dqtSegment([{ id: 0, values: testScale(TEST_LUMA, 85) }]), sosSegment()),
    )
    expect(info?.tables).toHaveLength(1)
  })

  it('survives truncation mid segment and reports it', () => {
    const whole = standardJpeg(75)
    // Cut inside the DQT payload: far enough in to have the SOI and the DQT
    // marker header, not far enough for the full table.
    const cut = whole.slice(0, 20)
    const info = parseJpeg(cut)
    expect(info).not.toBeNull()
    expect(info?.truncated).toBe(true)
    expect(info?.tables).toHaveLength(0)
  })

  it('survives a declared segment length that overruns the buffer', () => {
    const bogus = jpegBytes([0xff, 0xdb, 0xff, 0xff, 0x00])
    const info = parseJpeg(bogus)
    expect(info).not.toBeNull()
    expect(info?.truncated).toBe(true)
  })

  it('a header parsed to SOS is not truncated', () => {
    expect(parseJpeg(standardJpeg(30))?.truncated).toBe(false)
  })
})

describe('selectQuantTables', () => {
  it('maps components to their tables through SOF', () => {
    const info = parseJpeg(standardJpeg(75))
    expect(info).not.toBeNull()
    if (!info) return
    const tables = selectQuantTables(info)
    expect(Array.from(tables.luma?.values ?? [])).toEqual(testScale(TEST_LUMA, 75))
    expect(Array.from(tables.chroma?.values ?? [])).toEqual(testScale(TEST_CHROMA, 75))
  })

  it('falls back to table ids 0 and 1 when SOF is missing', () => {
    const info = parseJpeg(
      jpegBytes(
        dqtSegment([
          { id: 0, values: testScale(TEST_LUMA, 50) },
          { id: 1, values: testScale(TEST_CHROMA, 50) },
        ]),
      ),
    )
    expect(info).not.toBeNull()
    if (!info) return
    const tables = selectQuantTables(info)
    expect(tables.luma?.id).toBe(0)
    expect(tables.chroma?.id).toBe(1)
  })

  it('grayscale yields luma only', () => {
    const info = parseJpeg(
      jpegBytes(
        dqtSegment([{ id: 0, values: testScale(TEST_LUMA, 50) }]),
        sofSegment(0xc0, 32, 32, [{ id: 1, h: 1, v: 1, tq: 0 }]),
        sosSegment(),
      ),
    )
    expect(info).not.toBeNull()
    if (!info) return
    const tables = selectQuantTables(info)
    expect(tables.luma).not.toBeNull()
    expect(tables.chroma).toBeNull()
  })
})

describe('estimateJpegQuality', () => {
  it('recovers the exact quality for libjpeg tables across the range', () => {
    for (const q of [5, 12, 25, 42, 50, 63, 75, 88, 92, 97]) {
      const estimate = estimateJpegQuality(
        selected(testScale(TEST_LUMA, q), testScale(TEST_CHROMA, q)),
      )
      expect(estimate, `quality ${q}`).not.toBeNull()
      expect(estimate?.quality, `quality ${q}`).toBe(q)
      expect(estimate?.exact, `quality ${q}`).toBe(true)
      expect(estimate?.fitError, `quality ${q}`).toBe(0)
      expect(estimate?.family).toBe('libjpeg')
    }
  })

  it('recovers quality from the luma table alone', () => {
    const estimate = estimateJpegQuality(selected(testScale(TEST_LUMA, 84), null))
    expect(estimate?.quality).toBe(84)
    expect(estimate?.exact).toBe(true)
  })

  it('recovers quality from 16-bit low quality tables', () => {
    const estimate = estimateJpegQuality({
      luma: tableOf(testScale(TEST_LUMA, 10, 32767), 0, 16),
      chroma: tableOf(testScale(TEST_CHROMA, 10, 32767), 1, 16),
    })
    expect(estimate?.quality).toBe(10)
    expect(estimate?.exact).toBe(true)
  })

  it('stays within 2 points for a mildly perturbed variant table', () => {
    // A vendor tweak: a handful of entries nudged by one step. The fit is no
    // longer exact but the recovered quality must stay within the promised
    // 2 point tolerance.
    const luma = testScale(TEST_LUMA, 80)
    const chroma = testScale(TEST_CHROMA, 80)
    for (const i of [3, 17, 30, 55]) luma[i] = (luma[i] ?? 1) + 1
    for (const i of [9, 41]) chroma[i] = (chroma[i] ?? 1) + 1
    const estimate = estimateJpegQuality(selected(luma, chroma))
    expect(estimate).not.toBeNull()
    expect(estimate?.exact).toBe(false)
    expect(Math.abs((estimate?.quality ?? 0) - 80)).toBeLessThanOrEqual(2)
  })

  it('returns null rather than a guess for alien tables', () => {
    // A table nothing like a scaled Annex K set: constant 13 everywhere.
    const estimate = estimateJpegQuality(selected(Array(64).fill(13), Array(64).fill(13)))
    expect(estimate).toBeNull()
  })

  it('returns null when there is no luma table', () => {
    expect(estimateJpegQuality({ luma: null, chroma: null })).toBeNull()
  })

  it('accepts additional table families and reports the winner', () => {
    // A synthetic vendor family: Annex K luma doubled. Passed alongside the
    // default, the estimator must pick the family that actually fits.
    const doubled = TEST_LUMA.map((v) => v * 2)
    const family = { name: 'vendor-x', luma: doubled, chroma: TEST_CHROMA }
    const estimate = estimateJpegQuality(selected(testScale(doubled, 70), testScale(TEST_CHROMA, 70)), [
      LIBJPEG_FAMILY,
      family,
    ])
    expect(estimate?.family).toBe('vendor-x')
    expect(estimate?.quality).toBe(70)
    expect(estimate?.exact).toBe(true)
  })
})

describe('exported constants', () => {
  it('scaleQuantTable matches the independent scaling implementation', () => {
    for (const q of [1, 10, 50, 75, 100]) {
      expect(Array.from(scaleQuantTable(ANNEX_K_LUMA, q))).toEqual(testScale(TEST_LUMA, q))
      expect(Array.from(scaleQuantTable(ANNEX_K_CHROMA, q, 32767))).toEqual(
        testScale(TEST_CHROMA, q, 32767),
      )
    }
  })

  it('ships the Annex K tables in natural order', () => {
    expect(Array.from(ANNEX_K_LUMA)).toEqual(TEST_LUMA)
    expect(Array.from(ANNEX_K_CHROMA)).toEqual(TEST_CHROMA)
    expect(LIBJPEG_FAMILY.name).toBe('libjpeg')
    expect(Array.from(LIBJPEG_FAMILY.luma)).toEqual(TEST_LUMA)
    expect(Array.from(LIBJPEG_FAMILY.chroma)).toEqual(TEST_CHROMA)
  })
})
