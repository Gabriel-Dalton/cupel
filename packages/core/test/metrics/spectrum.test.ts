import { describe, expect, it } from 'vitest'
import type { RawImage } from '../../src/types.js'
import {
  gaussianBlur,
  makeImage,
  mulberry32,
  noiseImage,
  solid,
  upscale2x,
} from '../helpers/fixtures.js'
import { effectiveResolution, radialPowerSpectrum } from '../../src/metrics/spectrum.js'

// ---------------------------------------------------------------------------
// Local 1/f noise generator (test-only).
//
// Natural photographs follow an approximate 1/f amplitude law (power f^-2),
// spanning three or more decades across the band. The regression tests need
// such an image generated NATIVELY (no resampling anywhere), so we build it
// in the frequency domain with a local FFT that is independent of the code
// under test: white gaussian noise -> forward 2D FFT -> multiply every
// coefficient by 1/max(f, 1/size) (radially symmetric, so conjugate symmetry
// of the real input is preserved and the inverse transform is real) ->
// inverse 2D FFT -> normalize to mean 128 / std 40 -> quantize to Uint8.
// Deterministic via mulberry32 seeds.
// ---------------------------------------------------------------------------

function fftLocal(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j |= bit
    if (i < j) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((invert ? 2 : -2) * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    const half = len >> 1
    for (let start = 0; start < n; start += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half
        const aRe = re[a] ?? 0
        const aIm = im[a] ?? 0
        const bRe = re[b] ?? 0
        const bIm = im[b] ?? 0
        const tRe = bRe * curRe - bIm * curIm
        const tIm = bRe * curIm + bIm * curRe
        re[a] = aRe + tRe
        im[a] = aIm + tIm
        re[b] = aRe - tRe
        im[b] = aIm - tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n
      im[i] = (im[i] ?? 0) / n
    }
  }
}

function fft2dLocal(re: Float64Array, im: Float64Array, n: number, invert: boolean): void {
  const lineRe = new Float64Array(n)
  const lineIm = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    const off = y * n
    for (let x = 0; x < n; x++) {
      lineRe[x] = re[off + x] ?? 0
      lineIm[x] = im[off + x] ?? 0
    }
    fftLocal(lineRe, lineIm, invert)
    for (let x = 0; x < n; x++) {
      re[off + x] = lineRe[x] ?? 0
      im[off + x] = lineIm[x] ?? 0
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      lineRe[y] = re[y * n + x] ?? 0
      lineIm[y] = im[y * n + x] ?? 0
    }
    fftLocal(lineRe, lineIm, invert)
    for (let y = 0; y < n; y++) {
      re[y * n + x] = lineRe[y] ?? 0
      im[y * n + x] = lineIm[y] ?? 0
    }
  }
}

/** Native 1/f-amplitude (power f^-2) grayscale noise, size must be a power of two. */
function naturalImage(size: number, seed: number): RawImage {
  const rand = mulberry32(seed)
  const gauss = (): number => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const n = size
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) re[i] = gauss()
  fft2dLocal(re, im, n, false)
  const fMin = 1 / n
  for (let v = 0; v < n; v++) {
    const fy = v < n / 2 ? v / n : (v - n) / n
    for (let u = 0; u < n; u++) {
      const fx = u < n / 2 ? u / n : (u - n) / n
      const r = Math.sqrt(fx * fx + fy * fy)
      const h = r === 0 ? 0 : 1 / Math.max(r, fMin)
      const idx = v * n + u
      re[idx] = (re[idx] ?? 0) * h
      im[idx] = (im[idx] ?? 0) * h
    }
  }
  fft2dLocal(re, im, n, true)
  let mean = 0
  for (let i = 0; i < n * n; i++) mean += re[i] ?? 0
  mean /= n * n
  let varSum = 0
  for (let i = 0; i < n * n; i++) {
    const d = (re[i] ?? 0) - mean
    varSum += d * d
  }
  const std = Math.sqrt(varSum / (n * n)) || 1
  const data = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const val = Math.round(128 + (((re[i] ?? 0) - mean) / std) * 40)
    const o = i * 4
    data[o] = val
    data[o + 1] = val
    data[o + 2] = val
    data[o + 3] = 255
  }
  return { width: n, height: n, data }
}

/** Uniform noise in [center - amp, center + amp], deterministic. */
function lowContrastNoise(width: number, height: number, seed: number): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => {
    const v = 118 + Math.floor(rand() * 21)
    return [v, v, v, 255]
  })
}

describe('radialPowerSpectrum', () => {
  it('returns 64 finite, non negative bins for noise', () => {
    const spec = radialPowerSpectrum(noiseImage(256, 256, 7))
    expect(spec.length).toBe(64)
    for (let b = 0; b < spec.length; b++) {
      const v = spec[b] ?? Number.NaN
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('has near zero DC after mean subtraction, peak at the grating frequency', () => {
    // A horizontal grating at 0.25 cycles/sample puts all of its energy near
    // bin 32 and nothing near DC, so bin 0 isolates the mean subtraction:
    // without it, the mean of 128 would make bin 0 dominate everything.
    const grating = makeImage(256, 256, (x) => {
      const v = Math.round(128 + 100 * Math.sin(2 * Math.PI * 0.25 * x))
      return [v, v, v, 255]
    })
    const spec = radialPowerSpectrum(grating)
    let peak = 0
    let peakBin = 0
    for (let b = 0; b < spec.length; b++) {
      const v = spec[b] ?? 0
      if (v > peak) {
        peak = v
        peakBin = b
      }
    }
    expect(peak).toBeGreaterThan(0)
    expect(peakBin).toBeGreaterThanOrEqual(30)
    expect(peakBin).toBeLessThanOrEqual(34)
    expect(spec[0] ?? 0).toBeLessThan(peak * 1e-3)
  })

  it('accepts non square, non power of two input via the analysis resample', () => {
    const spec = radialPowerSpectrum(noiseImage(200, 100, 3))
    expect(spec.length).toBe(64)
    for (let b = 0; b < spec.length; b++) {
      expect(Number.isFinite(spec[b] ?? Number.NaN)).toBe(true)
    }
    // The adaptive plane (512 here) still yields exactly 64 bins.
    expect(radialPowerSpectrum(noiseImage(300, 200, 3)).length).toBe(64)
  })

  it('throws on images smaller than 16x16', () => {
    expect(() => radialPowerSpectrum(noiseImage(8, 8, 1))).toThrow()
  })
})

describe('effectiveResolution', () => {
  it('reports near full spectrum occupancy for native noise', () => {
    const res = effectiveResolution(noiseImage(256, 256, 42))
    expect(res.declared).toEqual({ w: 256, h: 256 })
    expect(res.cutoffRatio).toBeGreaterThan(0.8)
    expect(res.certifiedUpTo).toEqual({ w: 256, h: 256 })
  })

  it('reports near full occupancy for low contrast native noise', () => {
    // Amplitude ~10 around 128. The spectrum is flat but three orders of
    // magnitude weaker than full range noise; the relative threshold must
    // not care about absolute level.
    const res = effectiveResolution(lowContrastNoise(256, 256, 9))
    expect(res.cutoffRatio).toBeGreaterThan(0.8)
  })

  it('does not flag native natural 1/f spectra as upscaled', () => {
    // Regression for the peak-relative threshold bug: real photographs
    // follow a ~1/f amplitude law whose power spans 3+ decades across the
    // band, and a threshold relative to the raw peak bin cut them near
    // ratio 0.08 despite genuine content in every bin. See naturalImage
    // above for the construction (native 1/f field, no resampling).
    for (const seed of [1, 7, 42]) {
      const res = effectiveResolution(naturalImage(256, seed))
      expect(res.cutoffRatio, `seed ${seed}`).toBeGreaterThan(0.75)
    }
  })

  it('detects a 2x bilinear upscale as roughly half the declared resolution', () => {
    // KICKOFF-mandated acceptance test. Measured at the shipped constants:
    // cutoffRatio 0.5625 (seed 1) and 0.5781 (seeds 7, 42), truth 0.5.
    for (const seed of [1, 7, 42]) {
      const base = noiseImage(128, 128, seed)
      const up = upscale2x(base)
      const res = effectiveResolution(up)
      expect(res.declared).toEqual({ w: 256, h: 256 })
      expect(res.cutoffRatio, `seed ${seed}`).toBeGreaterThanOrEqual(0.35)
      expect(res.cutoffRatio, `seed ${seed}`).toBeLessThanOrEqual(0.65)
      expect(res.effective.w, `seed ${seed}`).toBeGreaterThanOrEqual(90)
      expect(res.effective.w, `seed ${seed}`).toBeLessThanOrEqual(166)
    }
  })

  it('holds truth 0.5 for 2x upscales across declared sizes 400, 512, and 1024', () => {
    // Regression for the fixed 256 plane with unfiltered bilinear
    // downsampling, which aliased a 1024px declared upscale back across
    // the whole band and reported it fully native (cutoffRatio 1.0).
    // The declared long edge now selects the analysis plane, and
    // shrinking to the plane is area averaged. Measured effective long
    // edges: 208 of 400, 304 of 512, 592 of 1024.
    const cases: Array<[number, number]> = [
      [200, 5],
      [256, 5],
      [512, 5],
    ]
    for (const [base, seed] of cases) {
      const declared = base * 2
      const res = effectiveResolution(upscale2x(noiseImage(base, base, seed)))
      expect(res.declared.w, `declared ${declared}`).toBe(declared)
      expect(res.effective.w, `declared ${declared}`).toBeGreaterThanOrEqual(0.3 * declared)
      expect(res.effective.w, `declared ${declared}`).toBeLessThanOrEqual(0.7 * declared)
    }
  }, 60_000)

  it('does not shrink native large images', () => {
    // 800x600 exercises the non square bilinear stretch onto the 1024
    // plane; 1024x1024 lands on the plane exactly. Both fit the plane,
    // so nothing saturates and certifiedUpTo equals declared.
    const a = effectiveResolution(noiseImage(800, 600, 3))
    expect(a.effective.w).toBeGreaterThanOrEqual(0.75 * 800)
    expect(a.certifiedUpTo).toEqual({ w: 800, h: 600 })
    const b = effectiveResolution(noiseImage(1024, 1024, 3))
    expect(b.effective.w).toBeGreaterThanOrEqual(0.75 * 1024)
    expect(b.certifiedUpTo).toEqual({ w: 1024, h: 1024 })
  }, 60_000)

  it('saturates explicitly when the declared long edge exceeds the analysis plane', () => {
    // A native 1536x1024 image is prefiltered down to the 1024 plane, so
    // detail finer than 1024 cannot be observed. The metric reports the
    // certified maximum (effective == certifiedUpTo < declared) instead
    // of claiming either "native" or "upscaled": cutoffRatio is capped
    // at 1024/1536 by construction, and effective == certifiedUpTo means
    // "at least this much detail, possibly more".
    const res = effectiveResolution(noiseImage(1536, 1024, 3))
    expect(res.certifiedUpTo).toEqual({ w: 1024, h: 683 })
    expect(res.effective).toEqual(res.certifiedUpTo)
    expect(res.cutoffRatio).toBeLessThan(1)
    expect(res.cutoffRatio).toBeCloseTo(1024 / 1536, 3)
  }, 60_000)

  it('is non increasing under blur at sigmas 0.5, 0.6, 0.8, 2.0', () => {
    // Regression for the threshold regime switch that made sigma 0.6 report
    // a HIGHER cutoff (0.7188) than sigma 0.5 (0.5625). The exact sigma
    // pair that inverted is asserted here. Ties are legal (both mild blurs
    // keep content above threshold in every bin); the sequence must never
    // increase, and heavy blur must genuinely bite.
    const noise = noiseImage(256, 256, 11)
    const r05 = effectiveResolution(gaussianBlur(noise, 0.5)).cutoffRatio
    const r06 = effectiveResolution(gaussianBlur(noise, 0.6)).cutoffRatio
    const r08 = effectiveResolution(gaussianBlur(noise, 0.8)).cutoffRatio
    const r20 = effectiveResolution(gaussianBlur(noise, 2.0)).cutoffRatio
    expect(r06).toBeLessThanOrEqual(r05)
    expect(r08).toBeLessThanOrEqual(r06)
    expect(r20).toBeLessThanOrEqual(r08)
    expect(r20).toBeLessThan(r05)
  })

  it('returns the no content minimum for a solid image without crashing', () => {
    const res = effectiveResolution(solid(64, 64, [128, 128, 128]))
    expect(res.cutoffRatio).toBeGreaterThan(0)
    expect(res.cutoffRatio).toBeLessThanOrEqual(0.05)
    expect(Number.isFinite(res.effective.w)).toBe(true)
    expect(Number.isFinite(res.effective.h)).toBe(true)
  })

  it('handles a 200x100 image and rejects an 8x8 image', () => {
    const res = effectiveResolution(noiseImage(200, 100, 5))
    expect(res.declared).toEqual({ w: 200, h: 100 })
    expect(res.cutoffRatio).toBeGreaterThan(0)
    expect(res.cutoffRatio).toBeLessThanOrEqual(1)
    expect(() => effectiveResolution(noiseImage(8, 8, 1))).toThrow()
  })
})
