import type { RawImage } from '../types.js'

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
 */
export function ssim(a: RawImage, b: RawImage): number {
  void a
  void b
  throw new Error('not implemented yet')
}
