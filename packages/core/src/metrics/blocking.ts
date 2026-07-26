import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'

export type BlockingResult = {
  /** Boundary to interior gradient energy ratio across columns at x = 8k. */
  horizontal: number
  /** Boundary to interior gradient energy ratio across rows at y = 8k. */
  vertical: number
  /** Combined score. Meaningfully above 1.0 indicates JPEG heritage. */
  combined: number
}

/**
 * Ratio stabilizer in luma levels per pixel. Far below the smallest gradient
 * an 8 bit image can express (1 level), so it never distorts a real
 * measurement. Its only job is to define the 0/0 case: a perfectly flat
 * image has zero energy at both boundary and interior positions, carries no
 * evidence either way, and lands on exactly 1.0 (neutral).
 */
const EPS = 1e-6

/**
 * Minimum extent for a meaningful ratio on one axis. At 17 px the axis has
 * at least two boundary positions (8 and 16) plus a full block of interior
 * positions on each side of the first boundary, so no single row or column
 * can determine the score alone. Below this the axis is reported as 1.0
 * (neutral), because the boundary/interior split is not statistically
 * meaningful.
 */
const MIN_EXTENT = 17

/**
 * Boundary to interior gradient ratio along one axis. A gradient sample at
 * position p compares the pixel pair (p - 1, p), so a boundary sample at
 * p % 8 === 0 straddles the seam between two adjacent 8x8 blocks.
 */
function axisRatio(g: Float64Array, width: number, height: number, horizontal: boolean): number {
  let boundarySum = 0
  let boundaryCount = 0
  let interiorSum = 0
  let interiorCount = 0
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 1; x < width; x++) {
        const d = Math.abs((g[row + x] ?? 0) - (g[row + x - 1] ?? 0))
        if (x % 8 === 0) {
          boundarySum += d
          boundaryCount++
        } else {
          interiorSum += d
          interiorCount++
        }
      }
    }
  } else {
    for (let y = 1; y < height; y++) {
      const row = y * width
      const prevRow = row - width
      for (let x = 0; x < width; x++) {
        const d = Math.abs((g[row + x] ?? 0) - (g[prevRow + x] ?? 0))
        if (y % 8 === 0) {
          boundarySum += d
          boundaryCount++
        } else {
          interiorSum += d
          interiorCount++
        }
      }
    }
  }
  // Unreachable when the MIN_EXTENT guard has run, kept as a hard backstop
  // so the function can never divide by a zero count.
  if (boundaryCount === 0 || interiorCount === 0) return 1
  const boundaryMean = boundarySum / boundaryCount
  const interiorMean = interiorSum / interiorCount
  // Symmetric epsilon: flat images (0/0) resolve to exactly 1.0, while a
  // hard-quantized image (interior exactly 0, boundary large) still scores
  // very high instead of dividing by zero.
  return (boundaryMean + EPS) / (interiorMean + EPS)
}

/**
 * 8x8 block boundary energy. Mean absolute gradient measured across pixel
 * positions that fall on 8x8 block boundaries, divided by the same measure
 * at interior positions. Survives format conversion, which is what exposes
 * PNGs that were laundered from JPEGs.
 *
 * Operates on the native pixel grid, never on a resized copy: JPEG block
 * boundaries live at fixed 8 px multiples of the original grid, and any
 * resample would smear boundary energy into interior positions and destroy
 * the signal this metric exists to measure.
 *
 * Axes shorter than MIN_EXTENT (17 px) return 1.0 (neutral) for that axis,
 * and a perfectly flat image returns exactly 1.0 on both axes; see the
 * constants above for the reasoning.
 */
export function blockingScore(img: RawImage): BlockingResult {
  const { width, height } = img
  const g = toGrayscale(img)
  const horizontal = width < MIN_EXTENT ? 1 : axisRatio(g, width, height, true)
  const vertical = height < MIN_EXTENT ? 1 : axisRatio(g, width, height, false)
  return { horizontal, vertical, combined: (horizontal + vertical) / 2 }
}
