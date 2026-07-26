/**
 * Scalar distortion for one candidate encode, per BRIEF section 3.3:
 *
 *   d = (1 - ssim) + kappa * min(deltaE / 2.3, 1)
 *
 * The deltaE term exists because grayscale SSIM is blind to chroma-only
 * shifts, which is exactly where aggressive AVIF chroma subsampling hides.
 * It is normalized by the rough CIE76 just-noticeable-difference threshold
 * (2.3) and saturates at 1 so a catastrophic chroma error contributes at
 * most kappa and can never dominate the SSIM term without bound.
 */

/** Rough just-noticeable-difference threshold for CIE76 deltaE. */
export const CIE76_JND_DELTA_E = 2.3

/** Default chroma term weight, per BRIEF section 3.3. */
export const DEFAULT_KAPPA = 0.5

/**
 * Derives the (bytes, distortion) y-axis value from the two measured
 * metrics. ssim must lie in [-1, 1]: windowed SSIM means can dip below zero
 * on adversarial content, so slightly negative values are legal, but values
 * outside the mathematical range indicate a broken caller. deltaE is a mean
 * CIE76 value and must be non-negative. kappa must be a non-negative finite
 * weight.
 */
export function distortion(ssim: number, deltaE: number, kappa: number = DEFAULT_KAPPA): number {
  if (!Number.isFinite(ssim) || ssim < -1 || ssim > 1) {
    throw new Error(`distortion: ssim must be a finite value in [-1, 1], got ${ssim}`)
  }
  if (!Number.isFinite(deltaE) || deltaE < 0) {
    throw new Error(`distortion: deltaE must be a finite non-negative value, got ${deltaE}`)
  }
  if (!Number.isFinite(kappa) || kappa < 0) {
    throw new Error(`distortion: kappa must be a finite non-negative value, got ${kappa}`)
  }
  return 1 - ssim + kappa * Math.min(deltaE / CIE76_JND_DELTA_E, 1)
}
