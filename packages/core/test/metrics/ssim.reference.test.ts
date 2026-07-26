import { describe, expect, it } from 'vitest'
import { ssim } from '../../src/metrics/ssim.js'
import type { RawImage } from '../../src/types.js'
import { gaussianBlur, noiseImage, solid } from '../helpers/fixtures.js'

/**
 * Reference anchoring for the shipped SSIM variant.
 *
 * The shipped metric is NOT standard Wang et al. SSIM (11x11 gaussian
 * sliding window); it is a non-overlapping 8x8 uniform-window variant, so
 * published SSIM reference numbers do not apply to it. These tests pin the
 * variant's numeric scale permanently, two ways:
 *
 *  1. A solid pair whose score is derivable by hand, asserted against the
 *     hand-derived literal.
 *  2. Multi-window fixtures asserted against an independent implementation
 *     written below with deliberately different expression shapes (two-pass
 *     mean-then-central-moments, integer-ratio luma, luminance and
 *     contrast-structure factors computed as separate ratios). Agreement to
 *     1e-12 pins the window scheme: any change to window size, overlap,
 *     weighting, or edge handling breaks these assertions.
 */

/**
 * Independent SSIM reference. Same definition as src/metrics/ssim.ts (8x8
 * non-overlapping windows, partials included, population statistics, Wang
 * constants) but every expression is shaped differently on purpose:
 *
 *  - Luma via exact integer arithmetic (299r + 587g + 114b) / 1000 instead
 *    of 0.299r + 0.587g + 0.114b.
 *  - Two-pass moments: means first, then central moments accumulated as
 *    products of deviations, instead of the one-pass E[x^2] - E[x]^2 form.
 *  - Per-window score as luminance * contrast-structure, two separate
 *    ratios, instead of one fused numerator over one fused denominator.
 *
 * If the two implementations agree to 1e-12 it is because they compute the
 * same mathematical definition, not because they share code paths.
 */
function referenceSsim(a: RawImage, b: RawImage): number {
  const C1 = 6.5025 // (0.01 * 255)^2 = 2.55^2, derived by hand
  const C2 = 58.5225 // (0.03 * 255)^2 = 7.65^2, derived by hand
  const WIN = 8
  const { width, height } = a

  const luma = (img: RawImage): number[] => {
    const out: number[] = []
    for (let i = 0; i < img.width * img.height; i++) {
      const o = i * 4
      const r = img.data[o] ?? 0
      const g = img.data[o + 1] ?? 0
      const bl = img.data[o + 2] ?? 0
      out.push((299 * r + 587 * g + 114 * bl) / 1000)
    }
    return out
  }
  const la = luma(a)
  const lb = luma(b)

  const scores: number[] = []
  for (let wy = 0; wy < height; wy += WIN) {
    for (let wx = 0; wx < width; wx += WIN) {
      const bw = Math.min(WIN, width - wx)
      const bh = Math.min(WIN, height - wy)
      const n = bw * bh

      // Pass 1: means.
      let ma = 0
      let mb = 0
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (wy + y) * width + (wx + x)
          ma += la[i] ?? 0
          mb += lb[i] ?? 0
        }
      }
      ma /= n
      mb /= n

      // Pass 2: central moments from explicit deviations.
      let varA = 0
      let varB = 0
      let cov = 0
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (wy + y) * width + (wx + x)
          const da = (la[i] ?? 0) - ma
          const db = (lb[i] ?? 0) - mb
          varA += da * da
          varB += db * db
          cov += da * db
        }
      }
      varA /= n
      varB /= n
      cov /= n

      const luminance = (2 * ma * mb + C1) / (ma * ma + mb * mb + C1)
      const contrastStructure = (2 * cov + C2) / (varA + varB + C2)
      scores.push(luminance * contrastStructure)
    }
  }
  let sum = 0
  for (const s of scores) sum += s
  return sum / scores.length
}

describe('ssim reference anchoring', () => {
  it('matches the hand-derived score for a solid 100 vs solid 120 pair', () => {
    // Rec. 601 luma of gray(100) is 0.299*100 + 0.587*100 + 0.114*100,
    // which is exactly 100 in IEEE754 doubles (verified: the three products
    // sum to 100 exactly, likewise 120 for gray(120)). Every 8x8 window is
    // constant, so muA = 100, muB = 120, varA = varB = cov = 0 exactly, and
    // each window scores
    //
    //   (2*100*120 + C1) * (0 + C2)     (24000 + 6.5025) * 58.5225
    //   ---------------------------  =  --------------------------
    //   (100^2 + 120^2 + C1) * (C2)     (24400 + 6.5025) * 58.5225
    //
    //   = 24006.5025 / 24406.5025  (approximately 0.983610925)
    //
    // with C1 = 6.5025 and C2 = 58.5225. All windows are identical so the
    // mean over windows is the same value.
    const EXPECTED = 24006.5025 / 24406.5025
    const got = ssim(solid(32, 32, [100, 100, 100]), solid(32, 32, [120, 120, 120]))
    expect(Math.abs(got - EXPECTED)).toBeLessThan(1e-12)
  })

  it('agrees with the independent reference on a 20x20 pair (9 windows, partials)', () => {
    // 20 = 8 + 8 + 4 per axis: a 3x3 window grid where the right column and
    // bottom row are partial windows, so this pins partial-window handling
    // (edge windows use their true pixel count, no padding).
    const a = noiseImage(20, 20, 123)
    const b = gaussianBlur(a, 1.2)
    const got = ssim(a, b)
    const ref = referenceSsim(a, b)
    expect(got).toBeGreaterThan(0)
    expect(got).toBeLessThan(1)
    expect(Math.abs(got - ref)).toBeLessThan(1e-12)
  })

  it('agrees with the independent reference on a 16x16 pair (exactly 4 full windows)', () => {
    const a = noiseImage(16, 16, 7)
    const b = noiseImage(16, 16, 8)
    const got = ssim(a, b)
    const ref = referenceSsim(a, b)
    expect(got).toBeGreaterThan(-1)
    expect(got).toBeLessThan(1)
    expect(Math.abs(got - ref)).toBeLessThan(1e-12)
  })
})
