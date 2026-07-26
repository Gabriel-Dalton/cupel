import type { RawImage } from '../types.js'

/**
 * Rec. 601 luma from 8 bit sRGB channels. Returned in the 0..255 range as
 * Float64Array, one value per pixel. Alpha is ignored.
 */
export function toGrayscale(img: RawImage): Float64Array {
  const { width, height, data } = img
  const out = new Float64Array(width * height)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    const r = data[o] ?? 0
    const g = data[o + 1] ?? 0
    const b = data[o + 2] ?? 0
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return out
}
