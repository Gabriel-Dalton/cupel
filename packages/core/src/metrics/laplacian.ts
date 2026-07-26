import type { RawImage } from '../types.js'

export type LaplacianResult = {
  /** 95th percentile of per tile Laplacian variance. High means sharp detail exists somewhere. */
  p95: number
  /** Number of tiles that contributed. */
  tilesEvaluated: number
}

/**
 * Tiled Laplacian variance at a normalized scale. The input is resized so
 * its long edge is 1024 before measuring, so the number is comparable
 * across images of different dimensions. Reports the p95 across tiles
 * rather than the mean, because one sharp region proves the source is
 * sharp even when most of the frame is bokeh.
 */
export function laplacianSharpness(img: RawImage): LaplacianResult {
  void img
  throw new Error('not implemented yet')
}
