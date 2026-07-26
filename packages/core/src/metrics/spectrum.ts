import type { RawImage } from '../types.js'

export type EffectiveResolutionResult = {
  declared: { w: number; h: number }
  /** The resolution implied by where spectral energy actually stops. */
  effective: { w: number; h: number }
  /**
   * Spectral cutoff as a fraction of Nyquist, in (0, 1]. A native image is
   * near 1.0. An image upscaled 2x rolls off near 0.5.
   */
  cutoffRatio: number
}

/**
 * Radially averaged power spectrum of the grayscale image. Returned as one
 * energy value per radial frequency bin, DC first, Nyquist last.
 */
export function radialPowerSpectrum(img: RawImage): Float64Array {
  void img
  throw new Error('not implemented yet')
}

/**
 * Finds the radial frequency where spectral energy falls below a noise
 * floor and converts it to the pixel dimensions the image really carries.
 * An image declared at 2400px whose spectrum rolls off at the equivalent
 * of 900px was upscaled, and the extra pixels are pure cost.
 */
export function effectiveResolution(img: RawImage): EffectiveResolutionResult {
  void img
  throw new Error('not implemented yet')
}
