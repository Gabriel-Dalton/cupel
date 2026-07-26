import type { RawImage } from '../types.js'

/**
 * Bilinear resize. Good enough for metric normalization (Laplacian tiles,
 * spectrum input); not meant as a production scaler. Pixel centers are
 * aligned (the half pixel convention), so an identity resize returns the
 * same pixels.
 */
export function bilinearResize(img: RawImage, targetWidth: number, targetHeight: number): RawImage {
  const { width, height, data } = img
  if (
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    !Number.isInteger(targetWidth) ||
    !Number.isInteger(targetHeight)
  ) {
    throw new Error(`bilinearResize: invalid target ${targetWidth}x${targetHeight}`)
  }
  if (targetWidth === width && targetHeight === height) {
    return { width, height, data: new Uint8ClampedArray(data) }
  }
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  const xRatio = width / targetWidth
  const yRatio = height / targetHeight
  for (let ty = 0; ty < targetHeight; ty++) {
    const sy = Math.min(Math.max((ty + 0.5) * yRatio - 0.5, 0), height - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = sy - y0
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx = Math.min(Math.max((tx + 0.5) * xRatio - 0.5, 0), width - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, width - 1)
      const fx = sx - x0
      const o = (ty * targetWidth + tx) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * width + x0) * 4 + c] ?? 0
        const p10 = data[(y0 * width + x1) * 4 + c] ?? 0
        const p01 = data[(y1 * width + x0) * 4 + c] ?? 0
        const p11 = data[(y1 * width + x1) * 4 + c] ?? 0
        const top = p00 + (p10 - p00) * fx
        const bottom = p01 + (p11 - p01) * fx
        out[o + c] = top + (bottom - top) * fy
      }
    }
  }
  return { width: targetWidth, height: targetHeight, data: out }
}

/**
 * Resize so the long edge equals longEdge, preserving aspect ratio. Images
 * already at or below the target are returned as a copy, never upscaled.
 */
export function normalizeLongEdge(img: RawImage, longEdge: number): RawImage {
  const { width, height } = img
  const long = Math.max(width, height)
  if (long <= longEdge) {
    return { width, height, data: new Uint8ClampedArray(img.data) }
  }
  const scale = longEdge / long
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return bilinearResize(img, w, h)
}
