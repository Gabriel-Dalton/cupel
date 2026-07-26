import type { RawImage } from '@cupel/core'
import { clampByte, mulberry32, valueNoise } from './noise'

/**
 * Procedurally generated test specimens for the landing page's measurement
 * table.
 *
 * Everything here is deterministic and platform pure: a seeded PRNG, plain
 * IEEE754 arithmetic, no I/O, no binary fixtures. The landing page runs the
 * real @cupel/core metrics against these images at build time, so the
 * numbers shown on the site are computed by the shipped code, not typed in.
 *
 * The degradations are chosen so each metric has one pair that isolates
 * what it measures:
 * - blockDamaged: every 8x8 block is pulled toward its mean, the signature
 *   blocking.ts exists to detect. (See note below on why partially.)
 * - hueShifted: chroma moves while Rec. 601 luma is preserved, the case
 *   grayscale SSIM is blind to and deltaE exists to catch.
 * - blurred: a separable box blur, which laplacian.ts reads as lost detail.
 * - upscaled: a 2x bilinear enlargement, which spectrum.ts reads as a
 *   spectral cutoff near half the declared Nyquist.
 */

export type SpecimenSet = {
  /** 256x256 seeded reference with natural-ish multi octave detail. */
  reference: RawImage
  /** Reference with every 8x8 block partially flattened toward its mean. */
  blockDamaged: RawImage
  /** Reference with chroma shifted while Rec. 601 luma is held constant. */
  hueShifted: RawImage
  /** Reference under a radius 2 separable box blur. */
  blurred: RawImage
  /** Reference bilinearly upscaled 2x to 512x512. */
  upscaled: RawImage
}

const SIZE = 256
const SEED = 0x5eed

/**
 * Builds the 256x256 reference. Luma is a sum of four value noise octaves
 * (cells 64, 32, 8, 2) over a diagonal gradient, plus fine seeded grain;
 * chroma is a slow two octave field so the image is a colour photograph
 * analogue rather than gray noise. The grain matters: value noise alone
 * decays steeper than the 1/f law photographic content follows, and
 * effectiveResolution would read a grainless synthetic as blurred. Grain
 * gives the spectrum the flat high frequency floor a real sensor does.
 * Values are kept inside [23, 237] so the luma preserving hue shift below
 * never clips against 0 or 255.
 */
function buildReference(): RawImage {
  const rng = mulberry32(SEED)
  const octaves = [
    { field: valueNoise(SIZE, 64, rng), amp: 60 },
    { field: valueNoise(SIZE, 32, rng), amp: 34 },
    { field: valueNoise(SIZE, 8, rng), amp: 22 },
    { field: valueNoise(SIZE, 2, rng), amp: 16 },
  ]
  const chromaA = valueNoise(SIZE, 48, rng)
  const chromaB = valueNoise(SIZE, 24, rng)
  const GRAIN = 20
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      let luma = 96 + 40 * ((x + y) / (2 * (SIZE - 1)))
      for (const { field, amp } of octaves) {
        luma += ((field[i] ?? 0) - 0.5) * amp
      }
      luma = Math.min(212, Math.max(44, luma)) + (rng() - 0.5) * GRAIN
      const ca = ((chromaA[i] ?? 0) - 0.5) * 36
      const cb = ((chromaB[i] ?? 0) - 0.5) * 28
      const o = i * 4
      data[o] = clampByte(luma + ca)
      data[o + 1] = clampByte(luma - 0.4 * ca + 0.3 * cb)
      data[o + 2] = clampByte(luma - cb)
      data[o + 3] = 255
    }
  }
  return { width: SIZE, height: SIZE, data }
}

/**
 * Pulls every 8x8 block 85 percent of the way toward its per channel mean.
 * Partial rather than total flattening keeps the damage in the range a
 * harshly quantized JPEG produces instead of a synthetic mosaic.
 */
function blockQuantize(src: RawImage): RawImage {
  const { width, height } = src
  const data = new Uint8ClampedArray(src.data)
  const MIX = 0.85
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      const bw = Math.min(8, width - bx)
      const bh = Math.min(8, height - by)
      const n = bw * bh
      const mean = [0, 0, 0]
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const o = ((by + y) * width + bx + x) * 4
          mean[0] = (mean[0] ?? 0) + (src.data[o] ?? 0)
          mean[1] = (mean[1] ?? 0) + (src.data[o + 1] ?? 0)
          mean[2] = (mean[2] ?? 0) + (src.data[o + 2] ?? 0)
        }
      }
      for (let c = 0; c < 3; c++) mean[c] = (mean[c] ?? 0) / n
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const o = ((by + y) * width + bx + x) * 4
          for (let c = 0; c < 3; c++) {
            const v = src.data[o + c] ?? 0
            data[o + c] = clampByte(v + ((mean[c] ?? 0) - v) * MIX)
          }
        }
      }
    }
  }
  return { width, height, data }
}

/**
 * Shifts chroma while holding Rec. 601 luma constant: dR = +7 paired with
 * dB = -(0.299 / 0.114) * 7, so 0.299 dR + 0.114 dB = 0 and the grayscale
 * plane SSIM sees is untouched. This is the aggressive chroma subsampling
 * failure mode in miniature, and it is the entire reason deltaE ships.
 */
function hueShift(src: RawImage): RawImage {
  const { width, height } = src
  const data = new Uint8ClampedArray(src.data)
  const DR = 7
  const DB = -(0.299 / 0.114) * DR
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    data[o] = clampByte((src.data[o] ?? 0) + DR)
    data[o + 2] = clampByte((src.data[o + 2] ?? 0) + DB)
  }
  return { width, height, data }
}

/** Separable box blur over RGB, alpha untouched. Radius in pixels. */
function boxBlur(src: RawImage, radius: number): RawImage {
  const { width, height } = src
  const horizontal = new Float64Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k
        if (sx < 0 || sx >= width) continue
        const o = (y * width + sx) * 4
        r += src.data[o] ?? 0
        g += src.data[o + 1] ?? 0
        b += src.data[o + 2] ?? 0
        n++
      }
      const t = (y * width + x) * 3
      horizontal[t] = r / n
      horizontal[t + 1] = g / n
      horizontal[t + 2] = b / n
    }
  }
  const data = new Uint8ClampedArray(src.data)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k
        if (sy < 0 || sy >= height) continue
        const t = (sy * width + x) * 3
        r += horizontal[t] ?? 0
        g += horizontal[t + 1] ?? 0
        b += horizontal[t + 2] ?? 0
        n++
      }
      const o = (y * width + x) * 4
      data[o] = clampByte(r / n)
      data[o + 1] = clampByte(g / n)
      data[o + 2] = clampByte(b / n)
    }
  }
  return { width, height, data }
}

/**
 * 2x bilinear upscale with the half pixel center convention, the ordinary
 * "someone enlarged this for a retina breakpoint" operation. The result
 * declares 512x512 but carries only 256 pixels of detail, which is exactly
 * the signature effectiveResolution converts back into pixels.
 */
function upscale2x(src: RawImage): RawImage {
  const { width, height } = src
  const outW = width * 2
  const outH = height * 2
  const data = new Uint8ClampedArray(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), height - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = sy - y0
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), width - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, width - 1)
      const fx = sx - x0
      const o = (y * outW + x) * 4
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * width + x0) * 4 + c] ?? 0
        const b = src.data[(y0 * width + x1) * 4 + c] ?? 0
        const cc = src.data[(y1 * width + x0) * 4 + c] ?? 0
        const d = src.data[(y1 * width + x1) * 4 + c] ?? 0
        const top = a + (b - a) * fx
        const bottom = cc + (d - cc) * fx
        data[o + c] = clampByte(top + (bottom - top) * fy)
      }
    }
  }
  return { width: outW, height: outH, data }
}

export function buildSpecimens(): SpecimenSet {
  const reference = buildReference()
  return {
    reference,
    blockDamaged: blockQuantize(reference),
    hueShifted: hueShift(reference),
    blurred: boxBlur(reference, 2),
    upscaled: upscale2x(reference),
  }
}
