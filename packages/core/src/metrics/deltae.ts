import type { RawImage } from '../types.js'

export type DeltaEResult = {
  /** Mean CIE76 deltaE across all pixels. */
  mean: number
  /** 95th percentile CIE76 deltaE across all pixels. */
  p95: number
}

/**
 * Per pixel CIE76 deltaE between two same sized images, through
 * sRGB to linear to XYZ to Lab with the D65 white point. Exists because
 * grayscale SSIM is blind to chroma only shifts, which is exactly where
 * aggressive chroma subsampling hides.
 */
export function deltaE(a: RawImage, b: RawImage): DeltaEResult {
  void a
  void b
  throw new Error('not implemented yet')
}
