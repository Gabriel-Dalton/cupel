import { describe, expect, it } from 'vitest'
import {
  analyzeProvenance,
  resolveHeadroom,
  softnessVerdict,
} from '../../src/provenance/headroom.js'
import { inverseDct8x8 } from '../../src/provenance/double-quant.js'
import { scaleQuantTable, ANNEX_K_LUMA, ANNEX_K_CHROMA } from '../../src/provenance/jpeg-dqt.js'
import {
  blockQuantize8,
  gaussianBlur,
  horizontalGradient,
  mulberry32,
  noiseImage,
  upscale2x,
} from '../helpers/fixtures.js'
import type { RawImage } from '../../src/types.js'

// Synthetic JPEG headers, compact re-statement of the builders that
// jpeg-dqt.test.ts pins in full. Independent copies stay in that file; here
// the builders only need to produce headers the (already verified) parser
// accepts. Byte fixtures are generated in code: no binaries in the repo.

const ZZ = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]
}

function dqtSegment(tables: Array<{ id: number; values: ArrayLike<number> }>): number[] {
  const payload: number[] = []
  for (const t of tables) {
    payload.push(t.id)
    for (let k = 0; k < 64; k++) payload.push(Number(t.values[ZZ[k] ?? 0] ?? 0) & 0xff)
  }
  return seg(0xdb, payload)
}

function sofSegment(width: number, height: number): number[] {
  return seg(0xc0, [
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ])
}

function jpegHeader(
  width: number,
  height: number,
  luma: ArrayLike<number>,
  chroma: ArrayLike<number>,
): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    ...dqtSegment([
      { id: 0, values: luma },
      { id: 1, values: chroma },
    ]),
    ...sofSegment(width, height),
    ...seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
  ])
}

function standardHeader(width: number, height: number, quality: number): Uint8Array {
  return jpegHeader(
    width,
    height,
    scaleQuantTable(ANNEX_K_LUMA, quality),
    scaleQuantTable(ANNEX_K_CHROMA, quality),
  )
}

/** Coefficient-domain double quantization fixture, as in double-quant.test.ts. */
function quantizedImage(
  size: number,
  seed: number,
  steps1: ArrayLike<number> | null,
  steps2: ArrayLike<number>,
): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  const coeffs = new Float64Array(64)
  const laplacian = (scale: number): number => {
    const sign = rand() < 0.5 ? -1 : 1
    return sign * -Math.log(1 - rand()) * scale
  }
  for (let by = 0; by < size; by += 8) {
    for (let bx = 0; bx < size; bx += 8) {
      coeffs[0] = (rand() - 0.5) * 400
      for (let k = 1; k < 64; k++) coeffs[ZZ[k] ?? 0] = laplacian(90 / (1 + 0.3 * k))
      for (const steps of [steps1, steps2]) {
        if (!steps) continue
        for (let i = 0; i < 64; i++) {
          const q = Number(steps[i] ?? 1)
          coeffs[i] = Math.round((coeffs[i] ?? 0) / q) * q
        }
      }
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

describe('softnessVerdict (regime-aware, issue #4)', () => {
  // Calibration, measured on the procedural fixtures in this file:
  //   native regime (long edge <= 1024, laplacian measures at native scale):
  //     noise 800x600               p95 ~50787  -> sharp
  //     blur sigma 0.8, 800x600     p95 ~946    -> sharp
  //     blur sigma 1.5, 800x600     p95 ~32     -> soft
  //     horizontal gradient         p95 ~0.7    -> soft
  //   normalized regime (long edge > 1024, resampled to 1024, ~3.6x
  //   attenuation for identical statistics, pinned in laplacian.test.ts):
  //     noise 1400x1050             p95 ~11620  -> sharp
  //     blur sigma 1.0, 1400x1050   p95 ~445    -> sharp
  //     blur sigma 2.5, 1400x1050   p95 ~5.9    -> soft
  // Thresholds: sharp >= 500 / soft < 100 native, scaled by the measured
  // 3.6x regime cliff to sharp >= 140 / soft < 28 normalized. The band in
  // between is 'unknown' by design until corpus calibration.
  it('applies native-regime thresholds at long edge <= 1024', () => {
    expect(softnessVerdict(500, 1024)).toBe('sharp')
    expect(softnessVerdict(499, 1024)).toBe('unknown')
    expect(softnessVerdict(100, 800)).toBe('unknown')
    expect(softnessVerdict(99, 800)).toBe('soft')
  })

  it('applies normalized-regime thresholds above long edge 1024', () => {
    expect(softnessVerdict(140, 1025)).toBe('sharp')
    expect(softnessVerdict(139, 2048)).toBe('unknown')
    expect(softnessVerdict(28, 1400)).toBe('unknown')
    expect(softnessVerdict(27, 1400)).toBe('soft')
  })

  it('classifies the calibration fixtures end to end', () => {
    const native = noiseImage(800, 600, 3)
    expect(analyzeProvenance({ container: 'png', image: native }).softness.verdict).toBe('sharp')
    expect(
      analyzeProvenance({ container: 'png', image: gaussianBlur(native, 2.5) }).softness.verdict,
    ).toBe('soft')
    const large = noiseImage(1400, 1050, 3)
    expect(analyzeProvenance({ container: 'png', image: large }).softness.verdict).toBe('sharp')
    expect(
      analyzeProvenance({ container: 'png', image: gaussianBlur(large, 4) }).softness.verdict,
    ).toBe('soft')
  })
})

describe('resolveHeadroom', () => {
  const base = {
    container: 'jpeg' as const,
    generations: null,
    estimatedOriginalQuality: null,
    blockingScore: 0,
  }

  it('two or more generations exhaust headroom', () => {
    const { headroom, reasons } = resolveHeadroom({ ...base, generations: 2 })
    expect(headroom).toBe('none')
    expect(reasons.join(' ')).toMatch(/generation/i)
  })

  it('estimated quality below 60 exhausts headroom', () => {
    expect(resolveHeadroom({ ...base, estimatedOriginalQuality: 59 }).headroom).toBe('none')
  })

  it('estimated quality 60..77 leaves low headroom', () => {
    expect(resolveHeadroom({ ...base, estimatedOriginalQuality: 60 }).headroom).toBe('low')
    expect(resolveHeadroom({ ...base, estimatedOriginalQuality: 77 }).headroom).toBe('low')
  })

  it('quality 78 and up is normal', () => {
    expect(resolveHeadroom({ ...base, estimatedOriginalQuality: 78 }).headroom).toBe('normal')
    expect(resolveHeadroom({ ...base, estimatedOriginalQuality: 95 }).headroom).toBe('normal')
  })

  it('undetermined generations do not rescue a low-quality source', () => {
    // BRIEF 4.5 writes the low rule as "generations == 1 and quality < 78".
    // A JPEG has at least one generation by definition, so a null from the
    // (deliberately noisy) detector is read as "at least 1", never as
    // permission to ignore the quality evidence.
    const { headroom } = resolveHeadroom({
      ...base,
      generations: null,
      estimatedOriginalQuality: 70,
    })
    expect(headroom).toBe('low')
  })

  it('heavy blocking in a lossless container exhausts headroom (laundered JPEG)', () => {
    const { headroom, reasons } = resolveHeadroom({
      ...base,
      container: 'png',
      blockingScore: 0.5,
    })
    expect(headroom).toBe('none')
    expect(reasons.join(' ')).toMatch(/launder|blocking/i)
  })

  it('the same blocking in a jpeg container is its own compression, not laundering', () => {
    expect(resolveHeadroom({ ...base, blockingScore: 0.5 }).headroom).toBe('normal')
  })

  it('multiple exhaustion causes are all reported', () => {
    const { reasons } = resolveHeadroom({
      ...base,
      generations: 3,
      estimatedOriginalQuality: 50,
    })
    expect(reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('clean evidence is normal with a stated reason', () => {
    const { headroom, reasons } = resolveHeadroom(base)
    expect(headroom).toBe('normal')
    expect(reasons.length).toBeGreaterThan(0)
  })
})

describe('analyzeProvenance', () => {
  it('png gradient: a clean lossless source', () => {
    const record = analyzeProvenance({ container: 'png', image: horizontalGradient(400, 300) })
    expect(record.container).toBe('png')
    expect(record.estimatedOriginalQuality).toBeNull()
    expect(record.encoderFingerprint).toBeNull()
    expect(record.generations).toBeNull()
    expect(record.chromaSubsampling).toBeNull()
    expect(record.declaredResolution).toEqual({ w: 400, h: 300 })
    expect(record.upscaled).toBe(false)
    expect(record.blockingScore).toBeLessThan(0.05)
    expect(record.headroom).toBe('normal')
    expect(record.evidence.length).toBeGreaterThan(0)
  })

  it('jpeg at quality 85: quality, fingerprint, subsampling, one generation', () => {
    const image = noiseImage(400, 304, 7)
    const record = analyzeProvenance({
      container: 'jpeg',
      image,
      bytes: standardHeader(400, 304, 85),
    })
    expect(record.estimatedOriginalQuality).toBe(85)
    expect(record.encoderFingerprint).toBe('libjpeg')
    expect(record.chromaSubsampling).toBe('4:2:0')
    expect(record.generations).toBe(1)
    expect(record.headroom).toBe('normal')
    expect(record.softness.verdict).toBe('sharp')
    expect(record.softness.p95Laplacian).toBeGreaterThan(0)
  })

  it('jpeg at quality 70 has low headroom', () => {
    const record = analyzeProvenance({
      container: 'jpeg',
      image: noiseImage(400, 304, 7),
      bytes: standardHeader(400, 304, 70),
    })
    expect(record.estimatedOriginalQuality).toBe(70)
    expect(record.headroom).toBe('low')
  })

  it('jpeg at quality 50 has no headroom', () => {
    const record = analyzeProvenance({
      container: 'jpeg',
      image: noiseImage(400, 304, 7),
      bytes: standardHeader(400, 304, 50),
    })
    expect(record.headroom).toBe('none')
    expect(record.evidence.join(' ')).toMatch(/quality/i)
  })

  it('jpeg with unknown tables reports signatures instead of guesses', () => {
    const alien = Array(64).fill(13)
    const record = analyzeProvenance({
      container: 'jpeg',
      image: noiseImage(400, 304, 7),
      bytes: jpegHeader(400, 304, alien, alien),
    })
    expect(record.estimatedOriginalQuality).toBeNull()
    expect(record.encoderFingerprint).toBeNull()
    expect(record.evidence.join(' ')).toMatch(/[0-9a-f]{8}/)
    // No quality evidence means no quality-based exhaustion.
    expect(record.headroom).toBe('normal')
  })

  it('a double-quantized jpeg is refused headroom even at high declared quality', () => {
    const t60 = scaleQuantTable(ANNEX_K_LUMA, 60)
    const t90 = scaleQuantTable(ANNEX_K_LUMA, 90)
    const image = quantizedImage(512, 42, t60, t90)
    const record = analyzeProvenance({
      container: 'jpeg',
      image,
      bytes: jpegHeader(512, 512, t90, scaleQuantTable(ANNEX_K_CHROMA, 90)),
    })
    expect(record.estimatedOriginalQuality).toBe(90)
    expect(record.generations).not.toBeNull()
    expect(record.generations ?? 0).toBeGreaterThanOrEqual(2)
    expect(record.headroom).toBe('none')
    expect(record.evidence.join(' ')).toMatch(/generation/i)
  })

  it('a png laundered from a jpeg is recognized and refused', () => {
    const record = analyzeProvenance({
      container: 'png',
      image: blockQuantize8(noiseImage(400, 400, 5)),
    })
    expect(record.blockingScore).toBeGreaterThan(0.33)
    expect(record.headroom).toBe('none')
    expect(record.evidence.join(' ')).toMatch(/launder|blocking/i)
  })

  it('an upscaled png is flagged with its effective resolution', () => {
    const record = analyzeProvenance({ container: 'png', image: upscale2x(noiseImage(256, 192, 3)) })
    expect(record.declaredResolution).toEqual({ w: 512, h: 384 })
    expect(record.upscaled).toBe(true)
    expect(record.effectiveResolution).not.toBeNull()
    expect(record.effectiveResolution?.w ?? 0).toBeLessThan(400)
    expect(record.evidence.join(' ')).toMatch(/upscal/i)
    // Upscaling wastes bytes but does not exhaust re-encode headroom.
    expect(record.headroom).toBe('normal')
  })

  it('a native-resolution png is not flagged as upscaled', () => {
    const record = analyzeProvenance({ container: 'png', image: noiseImage(512, 384, 3) })
    expect(record.upscaled).toBe(false)
  })

  it('truncated or missing jpeg bytes degrade to nulls, never throw', () => {
    const image = noiseImage(64, 64, 11)
    for (const bytes of [undefined, Uint8Array.from([0xff, 0xd8]), new Uint8Array(0)]) {
      const record = analyzeProvenance({ container: 'jpeg', image, bytes })
      expect(record.estimatedOriginalQuality).toBeNull()
      expect(record.encoderFingerprint).toBeNull()
      expect(record.evidence.length).toBeGreaterThan(0)
    }
  })

  it('bytes are only interpreted for jpeg containers', () => {
    const record = analyzeProvenance({
      container: 'webp',
      image: noiseImage(64, 64, 11),
      bytes: standardHeader(64, 64, 50),
    })
    expect(record.estimatedOriginalQuality).toBeNull()
    expect(record.headroom).toBe('normal')
  })

  it('a tiny image yields a complete record with honest nulls', () => {
    const record = analyzeProvenance({ container: 'png', image: noiseImage(12, 12, 1) })
    expect(record.effectiveResolution).toBeNull()
    expect(record.upscaled).toBe(false)
    expect(record.declaredResolution).toEqual({ w: 12, h: 12 })
    expect(record.headroom).toBe('normal')
    expect(record.evidence.length).toBeGreaterThan(0)
  })
})
