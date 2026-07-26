import { describe, expect, it } from 'vitest'
import { deltaE } from '../../src/metrics/deltae.js'
import { ssim } from '../../src/metrics/ssim.js'
import { toGrayscale } from '../../src/internal/luma.js'
import { equalLumaPair, makeImage, noiseImage, solid } from '../helpers/fixtures.js'

// ssim is owned by a sibling task and may still be a throwing stub while this
// suite is written. The ssim assertion below is skipped until it lands, so
// this suite stays green independently; the luma check proves the same point.
const ssimReady = (() => {
  try {
    ssim(solid(8, 8, [0, 0, 0]), solid(8, 8, [0, 0, 0]))
    return true
  } catch {
    return false
  }
})()

describe('deltaE', () => {
  it('is exactly zero for an identical noise image', () => {
    const img = noiseImage(16, 16, 42)
    const res = deltaE(img, img)
    expect(res.mean).toBe(0)
    expect(res.p95).toBe(0)
  })

  it('is exactly zero for an identical solid', () => {
    const img = solid(8, 8, [123, 45, 67])
    const res = deltaE(img, img)
    expect(res.mean).toBe(0)
    expect(res.p95).toBe(0)
  })

  // THE JUSTIFICATION TEST: two solids with (nearly) identical Rec. 601 luma
  // but very different hue. Grayscale metrics see almost nothing, deltaE must
  // see a lot. This pair is the entire reason the metric exists.
  it('sees a large difference where luma sees none (justification test)', () => {
    const [a, b] = equalLumaPair(32, 32)

    // Prove the pair really is luma-equal without depending on the ssim
    // implementation: per pixel Rec. 601 luma differs by less than 0.2.
    const la = toGrayscale(a)
    const lb = toGrayscale(b)
    for (let i = 0; i < la.length; i++) {
      expect(Math.abs((la[i] ?? 0) - (lb[i] ?? 0))).toBeLessThan(0.2)
    }

    // The colors are far apart in Lab (measured CIE76 distance is about 58.6).
    expect(deltaE(a, b).mean).toBeGreaterThan(15)
  })

  it.skipIf(!ssimReady)('grayscale ssim is blind to the same pair (justification test)', () => {
    const [a, b] = equalLumaPair(32, 32)
    expect(ssim(a, b)).toBeGreaterThan(0.999)
    expect(deltaE(a, b).mean).toBeGreaterThan(15)
  })

  it('white vs black is deltaE 100 (L 100 vs 0, a and b both near 0)', () => {
    const white = solid(8, 8, [255, 255, 255])
    const black = solid(8, 8, [0, 0, 0])
    const res = deltaE(white, black)
    expect(Math.abs(res.mean - 100)).toBeLessThan(0.5)
  })

  it('D65 sanity: white is the reference white and grays stay on the L axis', () => {
    const white = solid(8, 8, [255, 255, 255])
    expect(deltaE(white, white).mean).toBe(0)
    expect(deltaE(white, white).p95).toBe(0)

    // Expected L of sRGB (119,119,119), derived from the published formulas:
    //   s = 119/255 = 0.466667
    //   linear = ((s + 0.055) / 1.055)^2.4 = 0.184475
    //   gray means Y/Yn = linear (matrix Y row sums to 1), which is > (6/29)^3
    //   f = cbrt(0.184475) = 0.569262
    //   L = 116 * f - 16 = 50.0344, a and b vanish because X/Xn = Y/Yn = Z/Zn
    const expectedGrayL = 50.0344
    const gray = solid(8, 8, [119, 119, 119])
    // With a and b near zero the distance collapses to pure dL.
    const expected = 100 - expectedGrayL
    expect(Math.abs(deltaE(white, gray).mean - expected)).toBeLessThan(0.5)
  })

  it('throws on dimension mismatch', () => {
    expect(() => deltaE(solid(8, 8, [0, 0, 0]), solid(8, 9, [0, 0, 0]))).toThrow()
    expect(() => deltaE(solid(8, 8, [0, 0, 0]), solid(9, 8, [0, 0, 0]))).toThrow()
  })

  it('p95 far exceeds mean when exactly 10 percent of pixels differ strongly', () => {
    // 10x10 image, top row (10 of 100 pixels) flips black to white, rest equal.
    const base = solid(10, 10, [0, 0, 0])
    const spiked = makeImage(10, 10, (_x, y) => (y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
    const res = deltaE(base, spiked)
    // Mean is diluted by the 90 identical pixels, p95 lands on a spiked pixel.
    expect(res.mean).toBeGreaterThan(0)
    expect(res.p95).toBeGreaterThan(5 * res.mean)
  })

  it('p95 is close to mean for a uniform difference', () => {
    const a = solid(10, 10, [50, 50, 50])
    const b = solid(10, 10, [80, 80, 80])
    const res = deltaE(a, b)
    expect(res.mean).toBeGreaterThan(0)
    expect(res.p95).toBeCloseTo(res.mean, 6)
  })

  it('ignores alpha', () => {
    const a = solid(8, 8, [10, 200, 30], 255)
    const b = solid(8, 8, [10, 200, 30], 0)
    const res = deltaE(a, b)
    expect(res.mean).toBe(0)
    expect(res.p95).toBe(0)
  })
})
