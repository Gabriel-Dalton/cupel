import type { RawImage } from '../types.js'

export type BlockingResult = {
  /** Boundary to interior gradient energy ratio across columns at x = 8k. */
  horizontal: number
  /** Boundary to interior gradient energy ratio across rows at y = 8k. */
  vertical: number
  /** Combined score. Meaningfully above 1.0 indicates JPEG heritage. */
  combined: number
}

/**
 * 8x8 block boundary energy. Mean absolute gradient measured across pixel
 * positions that fall on 8x8 block boundaries, divided by the same measure
 * at interior positions. Survives format conversion, which is what exposes
 * PNGs that were laundered from JPEGs.
 */
export function blockingScore(img: RawImage): BlockingResult {
  void img
  throw new Error('not implemented yet')
}
