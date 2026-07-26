// M3 acceptance test (KICKOFF session notes): double-quantization detection
// must be validated against a real codec, not only against synthetic
// coefficient fixtures, because it is very easy to write detection code
// that returns plausible numbers while measuring nothing. Every JPEG here
// is produced by sharp (mozjpeg via libvips) at test time; the repo carries
// no binary fixtures.
import { describe, expect, it } from 'vitest'
import type { RawImage } from '@cupel/core'
import {
  analyzeProvenance,
  detectDoubleQuantization,
  estimateJpegQuality,
  identifyEncoder,
  parseJpeg,
  selectQuantTables,
} from '@cupel/core'
import { sharpCodec } from '../src/index.js'

/** Small, fast, seeded PRNG. Deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Photo-like fixture: overlapping sinusoids plus seeded noise, kept away
 * from the 0/255 clamp. The noise gives every AC band real histogram mass
 * (a smooth gradient would starve the detector), the sinusoids keep the
 * spectrum photographic rather than white.
 */
function photoLike(size: number, seed: number): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const structure = 60 * Math.sin(x / 17) * Math.cos(y / 23) + 30 * Math.sin((x + y) / 9)
      const v = 128 + structure + (rand() - 0.5) * 60
      const o = (y * size + x) * 4
      data[o] = v + 10 * Math.sin(x / 31)
      data[o + 1] = v
      data[o + 2] = v - 10 * Math.cos(y / 41)
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

const codec = sharpCodec('jpeg')
const source = photoLike(512, 77)

async function encodeOnce(quality: number): Promise<Uint8Array> {
  return codec.encode(source, { quality })
}

async function reEncode(firstQuality: number, secondQuality: number): Promise<Uint8Array> {
  const decoded = await codec.decode(await encodeOnce(firstQuality))
  return codec.encode(decoded, { quality: secondQuality })
}

function lumaTableOf(bytes: Uint8Array): Uint16Array {
  const info = parseJpeg(bytes)
  expect(info).not.toBeNull()
  const luma = info ? selectQuantTables(info).luma : null
  expect(luma).not.toBeNull()
  return luma?.values ?? new Uint16Array(64)
}

describe('sharp-encoded JPEG headers', () => {
  it('parses tables, subsampling, and dimensions from real bytes', async () => {
    const info = parseJpeg(await encodeOnce(85))
    expect(info).not.toBeNull()
    expect(info?.tables).toHaveLength(2)
    expect(info?.width).toBe(512)
    expect(info?.height).toBe(512)
    expect(info?.progressive).toBe(false)
    expect(info?.chromaSubsampling).toBe('4:2:0')
    expect(info?.truncated).toBe(false)
  })

  it('recovers the encode quality within 2 points across the range', async () => {
    for (const q of [60, 75, 85, 92]) {
      const info = parseJpeg(await encodeOnce(q))
      expect(info).not.toBeNull()
      if (!info) continue
      const estimate = estimateJpegQuality(selectQuantTables(info))
      expect(estimate, `quality ${q}`).not.toBeNull()
      expect(Math.abs((estimate?.quality ?? 0) - q), `quality ${q}`).toBeLessThanOrEqual(2)
    }
  })

  it('fingerprints sharp (mozjpeg via libvips) as libjpeg-tabled', async () => {
    // libvips keeps mozjpeg's default table index at the Annex K tables,
    // so the honest fingerprint is the libjpeg lineage, not 'mozjpeg'.
    const info = parseJpeg(await encodeOnce(80))
    expect(info).not.toBeNull()
    if (!info) return
    expect(identifyEncoder(selectQuantTables(info))?.name).toBe('libjpeg')
  })
})

describe('double quantization against a real codec (mandatory acceptance)', () => {
  it('a single-generation JPEG yields generations 1', async () => {
    for (const q of [75, 85]) {
      const bytes = await encodeOnce(q)
      const decoded = await codec.decode(bytes)
      const result = detectDoubleQuantization(decoded, lumaTableOf(bytes))
      expect(result.generations, `quality ${q}`).toBe(1)
      expect(result.periodicBands, `quality ${q}`).toBe(0)
      expect(result.evidence.length).toBeGreaterThan(0)
    }
  })

  it('a decode-then-re-encode at different quality yields generations >= 2', async () => {
    for (const [q1, q2] of [
      [60, 90],
      [75, 95],
    ] as Array<[number, number]>) {
      const bytes = await reEncode(q1, q2)
      const decoded = await codec.decode(bytes)
      const result = detectDoubleQuantization(decoded, lumaTableOf(bytes))
      expect(result.generations, `${q1} -> ${q2}`).not.toBeNull()
      expect(result.generations ?? 0, `${q1} -> ${q2}`).toBeGreaterThanOrEqual(2)
      expect(result.periodicBands, `${q1} -> ${q2}`).toBeGreaterThanOrEqual(2)
      expect(result.confidence, `${q1} -> ${q2}`).toBeGreaterThan(0)
    }
  })

  it('pins the documented blind spot: fine-then-coarse re-encodes are invisible', async () => {
    // Re-encoding a q85 file at q60 coarsens every step; the surviving
    // comb aliases below the analysis resolution and the file reads as a
    // clean single generation at q60. Documented in double-quant.ts. If
    // detection ever improves enough to catch this, update the docs there
    // and flip this expectation.
    const bytes = await reEncode(85, 60)
    const decoded = await codec.decode(bytes)
    const result = detectDoubleQuantization(decoded, lumaTableOf(bytes))
    expect(result.generations).toBe(1)
  })
})

describe('analyzeProvenance end to end on real JPEG bytes', () => {
  it('a healthy single-generation q85 JPEG keeps normal headroom', async () => {
    const bytes = await encodeOnce(85)
    const record = analyzeProvenance({
      container: 'jpeg',
      image: await codec.decode(bytes),
      bytes,
    })
    expect(record.estimatedOriginalQuality).toBe(85)
    expect(record.encoderFingerprint).toBe('libjpeg')
    expect(record.chromaSubsampling).toBe('4:2:0')
    expect(record.generations).toBe(1)
    expect(record.declaredResolution).toEqual({ w: 512, h: 512 })
    expect(record.headroom).toBe('normal')
    expect(record.evidence.length).toBeGreaterThan(0)
  })

  it('a q70 JPEG has low headroom', async () => {
    const bytes = await encodeOnce(70)
    const record = analyzeProvenance({
      container: 'jpeg',
      image: await codec.decode(bytes),
      bytes,
    })
    expect(record.estimatedOriginalQuality).toBe(70)
    expect(record.headroom).toBe('low')
  })

  it('a re-encoded JPEG is refused headroom despite a high current quality', async () => {
    const bytes = await reEncode(60, 90)
    const record = analyzeProvenance({
      container: 'jpeg',
      image: await codec.decode(bytes),
      bytes,
    })
    expect(record.estimatedOriginalQuality).toBe(90)
    expect(record.generations ?? 0).toBeGreaterThanOrEqual(2)
    expect(record.headroom).toBe('none')
    expect(record.evidence.join(' ')).toMatch(/generation/i)
  })
})
