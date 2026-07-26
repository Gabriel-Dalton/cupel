import { describe, expect, it } from 'vitest'
import {
  detectDoubleQuantization,
  forwardDct8x8,
  inverseDct8x8,
} from '../../src/provenance/double-quant.js'
import { scaleQuantTable, ANNEX_K_LUMA } from '../../src/provenance/jpeg-dqt.js'
import type { RawImage } from '../../src/types.js'
import { mulberry32 } from '../helpers/fixtures.js'

// The fixtures below synthesize JPEG-style quantization directly in the
// coefficient domain: sample plausible DCT coefficients, quantize them once
// (or twice at different tables), inverse transform, and round to pixels.
// That is exactly what a JPEG encode-decode cycle does to the luma plane,
// minus entropy coding, which carries no signal. The sharp-encoded
// integration test in packages/codecs-node/test/provenance-doublequant.test.ts
// closes the loop against a real codec; this file pins the math.

/** Laplacian (double exponential) sample with the given scale. */
function laplacian(rand: () => number, scale: number): number {
  const u = rand()
  const magnitude = -Math.log(1 - rand()) * scale
  return u < 0.5 ? -magnitude : magnitude
}

/**
 * Per-band coefficient scale, decaying with zigzag index the way natural
 * image spectra do. Large enough that the first 15 AC bands stay populated
 * after quantization at the test qualities.
 */
function bandScale(zigzagIndex: number): number {
  return 90 / (1 + 0.3 * zigzagIndex)
}

/** Zigzag map, independent copy (natural index at zigzag position k). */
const ZZ = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

function quantizeInPlace(coeffs: Float64Array, steps: ArrayLike<number>): void {
  for (let i = 0; i < 64; i++) {
    const q = steps[i] ?? 1
    coeffs[i] = Math.round((coeffs[i] ?? 0) / q) * q
  }
}

/**
 * Builds a grayscale RGBA image whose luma plane went through one or two
 * generations of JPEG-style quantization. steps1 null means single
 * generation (quantized only by steps2, the "current file" table).
 */
function quantizedImage(
  size: number,
  seed: number,
  steps1: ArrayLike<number> | null,
  steps2: ArrayLike<number>,
): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  const coeffs = new Float64Array(64)
  for (let by = 0; by < size; by += 8) {
    for (let bx = 0; bx < size; bx += 8) {
      coeffs[0] = (rand() - 0.5) * 400
      for (let k = 1; k < 64; k++) {
        coeffs[ZZ[k] ?? 0] = laplacian(rand, bandScale(k))
      }
      if (steps1) quantizeInPlace(coeffs, steps1)
      quantizeInPlace(coeffs, steps2)
      const pixels = inverseDct8x8(coeffs)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = Math.round(128 + (pixels[y * 8 + x] ?? 0))
          const o = ((by + y) * size + (bx + x)) * 4
          data[o] = v
          data[o + 1] = v
          data[o + 2] = v
          data[o + 3] = 255
        }
      }
    }
  }
  return { width: size, height: size, data }
}

const T90 = scaleQuantTable(ANNEX_K_LUMA, 90)
const T60 = scaleQuantTable(ANNEX_K_LUMA, 60)

describe('dct 8x8', () => {
  it('a constant block transforms to a lone DC coefficient', () => {
    const block = new Float64Array(64).fill(37)
    const coeffs = forwardDct8x8(block)
    expect(coeffs[0]).toBeCloseTo(8 * 37, 8)
    for (let i = 1; i < 64; i++) {
      expect(Math.abs(coeffs[i] ?? 1)).toBeLessThan(1e-9)
    }
  })

  it('inverse(forward(x)) reproduces x', () => {
    const rand = mulberry32(11)
    const block = Float64Array.from({ length: 64 }, () => (rand() - 0.5) * 255)
    const back = inverseDct8x8(forwardDct8x8(block))
    for (let i = 0; i < 64; i++) {
      expect(back[i]).toBeCloseTo(block[i] ?? 0, 8)
    }
  })

  it('is orthonormal up to the JPEG 1/4 convention (energy preserved)', () => {
    const rand = mulberry32(23)
    const block = Float64Array.from({ length: 64 }, () => (rand() - 0.5) * 100)
    const coeffs = forwardDct8x8(block)
    const spatial = block.reduce((s, v) => s + v * v, 0)
    const spectral = coeffs.reduce((s, v) => s + v * v, 0)
    expect(spectral).toBeCloseTo(spatial, 6)
  })
})

describe('detectDoubleQuantization', () => {
  it('a single-generation image reads as one generation', () => {
    for (const seed of [1, 42, 1234]) {
      const img = quantizedImage(512, seed, null, T90)
      const result = detectDoubleQuantization(img, T90)
      expect(result.generations, `seed ${seed}`).toBe(1)
      expect(result.bandsAnalyzed, `seed ${seed}`).toBeGreaterThanOrEqual(8)
      expect(result.evidence.length).toBeGreaterThan(0)
    }
  })

  it('a coarse-then-fine double quantization reads as two generations', () => {
    // First generation at quality 60 (coarse steps), second at quality 90
    // (fine steps): the classic detectable direction. The second table is
    // what the file's DQT would carry.
    for (const seed of [1, 42, 1234]) {
      const img = quantizedImage(512, seed, T60, T90)
      const result = detectDoubleQuantization(img, T90)
      expect(result.generations, `seed ${seed}`).not.toBeNull()
      expect(result.generations ?? 0, `seed ${seed}`).toBeGreaterThanOrEqual(2)
      expect(result.periodicBands, `seed ${seed}`).toBeGreaterThanOrEqual(2)
      expect(result.confidence, `seed ${seed}`).toBeGreaterThan(0)
      expect(result.evidence.length).toBeGreaterThan(0)
    }
  })

  it('an image that was never quantized reads as one generation', () => {
    // Continuous coefficients with a plausible table: no comb structure at
    // all. The detector cannot tell "never compressed" from "compressed
    // exactly once", and must say 1, not 2.
    const rand = mulberry32(7)
    const size = 512
    const data = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i++) {
      const v = Math.floor(rand() * 256)
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    const result = detectDoubleQuantization({ width: size, height: size, data }, T90)
    expect(result.generations).toBe(1)
  })

  it('returns null with evidence when the image has too few blocks', () => {
    const img = quantizedImage(32, 3, T60, T90)
    const result = detectDoubleQuantization(img, T90)
    expect(result.generations).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.evidence.join(' ')).toMatch(/block/i)
  })

  it('reports per-band detail consistent with the supplied table', () => {
    const img = quantizedImage(512, 5, T60, T90)
    const result = detectDoubleQuantization(img, T90)
    expect(result.bands.length).toBeGreaterThan(0)
    for (const band of result.bands) {
      expect(band.zigzagIndex).toBeGreaterThanOrEqual(1)
      expect(band.zigzagIndex).toBeLessThanOrEqual(15)
      expect(band.step).toBe(T90[ZZ[band.zigzagIndex] ?? 0])
      expect(band.samples).toBeGreaterThan(0)
    }
    expect(result.bandsAnalyzed).toBe(result.bands.length)
    expect(result.periodicBands).toBe(result.bands.filter((b) => b.periodic).length)
  })

  it('identical tables across generations are declared undetectable by design', () => {
    // Re-encoding at the same quality leaves no double-quant signature:
    // round(round(c/q)*q/q)*q is idempotent. The detector must report 1,
    // which is exactly why generations is EVIDENCE, never a verdict.
    const img = quantizedImage(512, 9, T90, T90)
    const result = detectDoubleQuantization(img, T90)
    expect(result.generations).toBe(1)
  })
})
