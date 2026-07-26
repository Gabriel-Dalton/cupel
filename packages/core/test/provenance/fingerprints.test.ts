import { describe, expect, it } from 'vitest'
import {
  FINGERPRINT_REGISTRY,
  MOZJPEG_FAMILY,
  identifyEncoder,
  quantSignature,
  type FingerprintEntry,
} from '../../src/provenance/fingerprints.js'
import {
  ANNEX_K_CHROMA,
  ANNEX_K_LUMA,
  scaleQuantTable,
  type JpegQuantTable,
  type SelectedQuantTables,
} from '../../src/provenance/jpeg-dqt.js'

// The Annex K constants and the scaling formula are pinned by independent
// copies in jpeg-dqt.test.ts, so reusing the exports here cannot hide a
// wrong constant. The mozjpeg table below is this file's own independent
// copy so the registry entry and the test cannot share a typo.

/**
 * ImageMagick's quantization table by Nicolas Robidoux (coders/jpeg.c),
 * adopted by mozjpeg as quant table index 3 and used as its cjpeg default.
 * mozjpeg applies the same table to luma and chroma. Natural order.
 */
const TEST_MOZJPEG_TABLE = [
  16, 16, 16, 18, 25, 37, 56, 85, 16, 17, 20, 27, 34, 40, 53, 75, 16, 20, 24, 31, 43, 62, 91, 135,
  18, 27, 31, 40, 53, 74, 106, 156, 25, 34, 43, 53, 69, 94, 131, 189, 37, 40, 62, 74, 94, 124, 169,
  238, 56, 53, 91, 106, 131, 169, 226, 311, 85, 75, 135, 156, 189, 238, 311, 418,
]

function tableOf(values: ArrayLike<number>, id = 0, precision: 8 | 16 = 8): JpegQuantTable {
  return { id, precision, values: Uint16Array.from(values as number[]) }
}

function selected(luma: ArrayLike<number>, chroma: ArrayLike<number> | null): SelectedQuantTables {
  return { luma: tableOf(luma, 0), chroma: chroma ? tableOf(chroma, 1) : null }
}

describe('identifyEncoder', () => {
  it('identifies scaled Annex K tables as libjpeg across qualities', () => {
    for (const q of [30, 50, 75, 90, 95]) {
      const match = identifyEncoder(
        selected(scaleQuantTable(ANNEX_K_LUMA, q), scaleQuantTable(ANNEX_K_CHROMA, q)),
      )
      expect(match?.name, `quality ${q}`).toBe('libjpeg')
      expect(match?.quality, `quality ${q}`).toBe(q)
    }
  })

  it('identifies from the luma table alone (grayscale JPEG)', () => {
    const match = identifyEncoder(selected(scaleQuantTable(ANNEX_K_LUMA, 85), null))
    expect(match?.name).toBe('libjpeg')
    expect(match?.quality).toBe(85)
  })

  it('identifies the mozjpeg ImageMagick table pair', () => {
    for (const q of [65, 80]) {
      const match = identifyEncoder(
        selected(scaleQuantTable(TEST_MOZJPEG_TABLE, q), scaleQuantTable(TEST_MOZJPEG_TABLE, q)),
      )
      expect(match?.name, `quality ${q}`).toBe('mozjpeg')
      expect(match?.quality, `quality ${q}`).toBe(q)
    }
  })

  it('returns null for a near miss, never the nearest guess', () => {
    const luma = Array.from(scaleQuantTable(ANNEX_K_LUMA, 80))
    luma[5] = (luma[5] ?? 1) + 1
    const match = identifyEncoder(selected(luma, scaleQuantTable(ANNEX_K_CHROMA, 80)))
    expect(match).toBeNull()
  })

  it('returns null for alien tables', () => {
    expect(identifyEncoder(selected(Array(64).fill(13), Array(64).fill(13)))).toBeNull()
  })

  it('a chroma table that does not match defeats a matching luma table', () => {
    const match = identifyEncoder(selected(scaleQuantTable(ANNEX_K_LUMA, 75), Array(64).fill(13)))
    expect(match).toBeNull()
  })

  it('returns null when saturated tables are ambiguous across families', () => {
    // Quality 1 clamps every entry of every base table to 255, so the
    // observed tables match more than one registry entry. Ambiguous
    // evidence must not become a verdict.
    const q1 = scaleQuantTable(ANNEX_K_LUMA, 1)
    expect(Array.from(q1).every((v) => v === 255)).toBe(true)
    expect(identifyEncoder(selected(q1, scaleQuantTable(ANNEX_K_CHROMA, 1)))).toBeNull()
  })

  it('returns null when there is no luma table', () => {
    expect(identifyEncoder({ luma: null, chroma: null })).toBeNull()
  })

  it('accepts a custom registry and matches its entries', () => {
    const doubled = Array.from(ANNEX_K_LUMA, (v) => v * 2)
    const entry: FingerprintEntry = {
      name: 'vendor-x',
      family: { name: 'vendor-x', luma: doubled, chroma: ANNEX_K_CHROMA },
      notes: 'synthetic test family',
    }
    const match = identifyEncoder(
      selected(scaleQuantTable(doubled, 70), scaleQuantTable(ANNEX_K_CHROMA, 70)),
      [entry],
    )
    expect(match?.name).toBe('vendor-x')
    expect(match?.quality).toBe(70)
  })
})

describe('FINGERPRINT_REGISTRY', () => {
  it('ships libjpeg and mozjpeg entries with notes', () => {
    const names = FINGERPRINT_REGISTRY.map((e) => e.name)
    expect(names).toContain('libjpeg')
    expect(names).toContain('mozjpeg')
    for (const entry of FINGERPRINT_REGISTRY) {
      expect(entry.notes.length).toBeGreaterThan(0)
      expect(entry.family.luma).toHaveLength(64)
      expect(entry.family.chroma).toHaveLength(64)
    }
  })

  it('registry names are unique', () => {
    const names = FINGERPRINT_REGISTRY.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('the mozjpeg entry matches the independent table copy', () => {
    expect(Array.from(MOZJPEG_FAMILY.luma as ArrayLike<number>)).toEqual(TEST_MOZJPEG_TABLE)
    expect(Array.from(MOZJPEG_FAMILY.chroma as ArrayLike<number>)).toEqual(TEST_MOZJPEG_TABLE)
  })
})

describe('quantSignature', () => {
  it('is deterministic for equal tables', () => {
    const a = tableOf(scaleQuantTable(ANNEX_K_LUMA, 75))
    const b = tableOf(scaleQuantTable(ANNEX_K_LUMA, 75))
    expect(quantSignature(a)).toBe(quantSignature(b))
  })

  it('differs when any value differs', () => {
    const base = Array.from(scaleQuantTable(ANNEX_K_LUMA, 75))
    const tweaked = [...base]
    tweaked[63] = (tweaked[63] ?? 1) + 1
    expect(quantSignature(tableOf(tweaked))).not.toBe(quantSignature(tableOf(base)))
  })

  it('differs across precision even for equal values', () => {
    const values = scaleQuantTable(ANNEX_K_LUMA, 75)
    expect(quantSignature(tableOf(values, 0, 8))).not.toBe(quantSignature(tableOf(values, 0, 16)))
  })

  it('is ignorant of the table id (the signature keys content, not slot)', () => {
    const values = scaleQuantTable(ANNEX_K_CHROMA, 60)
    expect(quantSignature(tableOf(values, 0))).toBe(quantSignature(tableOf(values, 1)))
  })

  it('is eight lowercase hex characters', () => {
    expect(quantSignature(tableOf(ANNEX_K_LUMA))).toMatch(/^[0-9a-f]{8}$/)
  })
})
