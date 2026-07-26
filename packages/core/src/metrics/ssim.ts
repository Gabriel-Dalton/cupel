import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'

/**
 * Windowed grayscale SSIM over 8x8 blocks.
 *
 * Spec note: the kickoff protocol says a reference implementation would be
 * handed over before this file is written. It never was, so this implements
 * the standard formulation instead: Rec. 601 grayscale, non overlapping 8x8
 * windows (partial windows at the right and bottom edges included), uniform
 * window weighting, Wang et al. constants C1 = (0.01 * 255)^2 and
 * C2 = (0.03 * 255)^2, final score is the unweighted mean over windows.
 * If a reference implementation arrives later and disagrees, reconciling the
 * two is a deliberate, documented change (see GOVERNANCE.md on metrics).
 *
 * Per window statistics are population statistics (divide by N). The
 * numerator and denominator of each SSIM factor are deliberately built from
 * the same expression shapes: for identical inputs, muA equals muB and
 * varA equals varB equals cov bit for bit, and in IEEE754 doubles
 * 2 * muA * muB equals muA * muA + muB * muB exactly (scaling by 2 is exact),
 * so ssim(img, img) returns exactly 1.0, not 0.9999...
 */

const WINDOW = 8
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

export function ssim(a: RawImage, b: RawImage): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `ssim: dimension mismatch, got ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    )
  }
  const { width, height } = a
  const ga = toGrayscale(a)
  const gb = toGrayscale(b)

  let total = 0
  let windows = 0
  for (let wy = 0; wy < height; wy += WINDOW) {
    for (let wx = 0; wx < width; wx += WINDOW) {
      const bw = Math.min(WINDOW, width - wx)
      const bh = Math.min(WINDOW, height - wy)
      const n = bw * bh

      let sumA = 0
      let sumB = 0
      let sumAA = 0
      let sumBB = 0
      let sumAB = 0
      for (let y = 0; y < bh; y++) {
        const row = (wy + y) * width + wx
        for (let x = 0; x < bw; x++) {
          const va = ga[row + x] ?? 0
          const vb = gb[row + x] ?? 0
          sumA += va
          sumB += vb
          sumAA += va * va
          sumBB += vb * vb
          sumAB += va * vb
        }
      }

      const muA = sumA / n
      const muB = sumB / n
      // varA, varB, and cov share one expression shape so identical inputs
      // yield bit identical values (see the precision note above).
      const varA = sumAA / n - muA * muA
      const varB = sumBB / n - muB * muB
      const cov = sumAB / n - muA * muB

      // Both denominator factors are strictly positive: C1 bounds the first
      // away from zero, and C2 dwarfs any negative variance residue that
      // floating point cancellation could produce (magnitude below 1e-9).
      const numerator = (2 * muA * muB + C1) * (2 * cov + C2)
      const denominator = (muA * muA + muB * muB + C1) * (varA + varB + C2)
      total += numerator / denominator
      windows++
    }
  }
  // Sum of exact 1.0 terms is the exact window count, so the identity case
  // survives this division too.
  return total / windows
}
