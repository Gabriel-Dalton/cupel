import { describe, expect, it } from 'vitest'
import { ssim } from '../../src/metrics/ssim.js'
import type { RawImage } from '../../src/types.js'
import {
  clone,
  gaussianBlur,
  horizontalGradient,
  makeImage,
  mulberry32,
  noiseImage,
  solid,
} from '../helpers/fixtures.js'

/**
 * Adds a constant to R, G, B of every pixel, leaving alpha alone. Callers
 * must keep source values far enough from 0 and 255 that the addition never
 * clips, otherwise the "constant offset" premise is broken.
 */
function shift(img: RawImage, delta: number): RawImage {
  const out = clone(img)
  for (let i = 0; i < out.data.length; i++) {
    if (i % 4 === 3) continue
    out.data[i] = (out.data[i] ?? 0) + delta
  }
  return out
}

describe('ssim', () => {
  it('returns exactly 1.0 for an image compared with itself (noise)', () => {
    const img = noiseImage(64, 64, 42)
    expect(ssim(img, img)).toBe(1)
  })

  it('returns exactly 1.0 for an image compared with itself (gradient)', () => {
    const img = horizontalGradient(64, 64)
    expect(ssim(img, img)).toBe(1)
  })

  it('scores a structured image against heavy noise below 0.3', () => {
    const structured = horizontalGradient(64, 64)
    const noise = noiseImage(64, 64, 7)
    expect(ssim(structured, noise)).toBeLessThan(0.3)
  })

  it('is exactly symmetric for a gradient/noise pair', () => {
    const grad = horizontalGradient(64, 64)
    const noise = noiseImage(64, 64, 3)
    expect(ssim(grad, noise)).toBe(ssim(noise, grad))
  })

  it('is exactly symmetric for a blurred pair', () => {
    const base = noiseImage(48, 48, 11)
    const blurred = gaussianBlur(base, 1.2)
    expect(ssim(base, blurred)).toBe(ssim(blurred, base))
  })

  it('decreases strictly monotonically as blur strength grows', () => {
    const base = noiseImage(128, 128, 5)
    const sigmas = [0.5, 1.0, 1.5, 2.0, 3.0]
    const scores = sigmas.map((sigma) => ssim(base, gaussianBlur(base, sigma)))
    for (let i = 1; i < scores.length; i++) {
      const prev = scores[i - 1] ?? Number.NaN
      const curr = scores[i] ?? Number.NaN
      expect(curr).toBeLessThan(prev)
    }
  })

  it('throws a clear error on dimension mismatch', () => {
    const a = solid(8, 8, [10, 20, 30])
    const b = solid(8, 9, [10, 20, 30])
    expect(() => ssim(a, b)).toThrow(/dimension/i)
  })

  it('is invariant to a shared constant offset in the way the definition requires', () => {
    // SSIM's contrast and structure terms depend only on variances and the
    // covariance, and adding the same constant to every pixel leaves those
    // untouched, so they are exactly offset invariant. The luminance term
    // (2*muA*muB + C1) / (muA^2 + muB^2 + C1) is NOT exactly invariant:
    // shifting both means by the same delta changes that ratio whenever
    // muA differs from muB. Exact invariance is therefore a stronger property
    // than the SSIM definition has, and the correct test is that a shared
    // offset moves the score only marginally, not that it moves it not at all.
    // Pixel values are confined to 40..200 so the +20 shift cannot clip.
    const rand = mulberry32(99)
    const a = makeImage(64, 64, () => {
      const v = 40 + Math.floor(rand() * 161)
      return [v, v, v, 255]
    })
    // Blur keeps values inside 40..200 (convex combination), so b shifts
    // cleanly too, and it gives the pair per window mean differences that
    // make the luminance term actually participate in the comparison.
    const b = gaussianBlur(a, 1.0)

    const original = ssim(a, b)
    const shifted = ssim(shift(a, 20), shift(b, 20))

    // Guard that the pair is not degenerate (identical or uncorrelated),
    // otherwise the invariance check would be vacuous.
    expect(original).toBeGreaterThan(0)
    expect(original).toBeLessThan(1)
    expect(Math.abs(shifted - original)).toBeLessThan(0.01)
  })

  it('returns exactly 1.0 for two identical solids (zero variance edge case)', () => {
    // Both variances and the covariance are zero here, so the second SSIM
    // factor collapses to C2 / C2. C2 keeps the division stable and the
    // result must still be exactly 1.
    const a = solid(32, 32, [128, 128, 128])
    const b = solid(32, 32, [128, 128, 128])
    expect(ssim(a, b)).toBe(1)
  })
})
