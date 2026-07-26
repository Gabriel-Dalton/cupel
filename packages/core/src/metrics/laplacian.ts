import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'
import { normalizeLongEdge } from '../internal/resample.js'

export type LaplacianResult = {
  /** 95th percentile of per tile Laplacian variance. High means sharp detail exists somewhere. */
  p95: number
  /** Number of tiles that contributed. */
  tilesEvaluated: number
}

/** Long edge every input is normalized to before measuring. Never upscales. */
const NORMALIZED_LONG_EDGE = 1024

/** Tile edge in response pixels. 64 gives a 16x16 grid at the normalized scale. */
const TILE_SIZE = 64

/**
 * Partial edge tiles thinner than this in either dimension are skipped:
 * variance over a sliver is too noisy to trust as a tile statistic.
 */
const MIN_TILE_EDGE = 16

/**
 * Tiled Laplacian variance at a normalized scale. The input is resized so
 * its long edge is 1024 before measuring, so the number is comparable
 * across images of different dimensions. Reports the p95 across tiles
 * rather than the mean, because one sharp region proves the source is
 * sharp even when most of the frame is bokeh.
 *
 * Comparability regime: normalizeLongEdge never upscales, so p95 values
 * are strictly comparable only among images whose long edge is at least
 * 1024; smaller images are measured at their native scale, where the
 * absolute numbers run higher because no resampling attenuates them.
 * Upscale discrimination (2x upscale scoring below its source) therefore
 * exists only below the normalized scale, where the interpolated pixels
 * survive into the measurement; detecting upscaling of large images is
 * the job of spectrum.ts effectiveResolution, not of this metric.
 *
 * Pipeline: normalizeLongEdge(1024), Rec. 601 grayscale, 3x3 Laplacian
 * [0,1,0; 1,-4,1; 0,1,0] over interior pixels only (the 1px border is
 * skipped rather than inventing an edge handling convention), then the
 * response is tiled into 64x64 tiles and each tile's population variance
 * is computed. Partial edge tiles count when at least 16 pixels survive in
 * both dimensions; thinner slivers are skipped. If the whole response is
 * thinner than 16px (inputs smaller than 18x18) the entire response is
 * evaluated as one tile so the metric never returns NaN. The percentile is
 * linear interpolation between closest ranks: index 0.95 * (n - 1) on the
 * ascending sorted variances, the numpy default definition.
 *
 * Throws on inputs smaller than 3x3, and on degenerate aspect ratios where
 * normalization collapses a dimension below 3px (long edge over ~341x the
 * short edge), because a 3x3 kernel is undefined there.
 */
export function laplacianSharpness(img: RawImage): LaplacianResult {
  if (img.width < 3 || img.height < 3) {
    throw new Error(
      `laplacianSharpness: image must be at least 3x3, got ${img.width}x${img.height}`,
    )
  }
  const norm = normalizeLongEdge(img, NORMALIZED_LONG_EDGE)
  if (norm.width < 3 || norm.height < 3) {
    throw new Error(
      `laplacianSharpness: aspect ratio too extreme, ${img.width}x${img.height} normalizes to ${norm.width}x${norm.height}`,
    )
  }

  const { width, height } = norm
  const gray = toGrayscale(norm)

  // Response grid holds one Laplacian value per interior pixel.
  const rw = width - 2
  const rh = height - 2
  const resp = new Float64Array(rw * rh)
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const v =
        (gray[row - width + x] ?? 0) +
        (gray[row + width + x] ?? 0) +
        (gray[row + x - 1] ?? 0) +
        (gray[row + x + 1] ?? 0) -
        4 * (gray[row + x] ?? 0)
      resp[(y - 1) * rw + (x - 1)] = v
    }
  }

  const variances: number[] = []
  for (let ty = 0; ty < rh; ty += TILE_SIZE) {
    const th = Math.min(TILE_SIZE, rh - ty)
    if (th < MIN_TILE_EDGE) continue
    for (let tx = 0; tx < rw; tx += TILE_SIZE) {
      const tw = Math.min(TILE_SIZE, rw - tx)
      if (tw < MIN_TILE_EDGE) continue
      variances.push(tileVariance(resp, rw, tx, ty, tw, th))
    }
  }
  // Inputs whose response grid is thinner than MIN_TILE_EDGE produce no
  // regular tiles at all; measure the whole response as a single tile.
  if (variances.length === 0) {
    variances.push(tileVariance(resp, rw, 0, 0, rw, rh))
  }

  return { p95: percentile95(variances), tilesEvaluated: variances.length }
}

/** Population variance of one rectangular window of the response grid. */
function tileVariance(
  resp: Float64Array,
  rowStride: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number {
  let sum = 0
  let sumSq = 0
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * rowStride + x0
    for (let x = 0; x < w; x++) {
      const v = resp[row + x] ?? 0
      sum += v
      sumSq += v * v
    }
  }
  const n = w * h
  const mean = sum / n
  // E[v^2] - E[v]^2 can dip a hair below zero from float rounding.
  return Math.max(0, sumSq / n - mean * mean)
}

/** Linear interpolation between closest ranks at index 0.95 * (n - 1). */
function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * 0.95
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const vLo = sorted[lo] ?? 0
  const vHi = sorted[hi] ?? vLo
  return vLo + (vHi - vLo) * (idx - lo)
}
