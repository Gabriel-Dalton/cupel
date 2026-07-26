// Procedural test fixtures. Everything here is deterministic (seeded) and
// synthesized at test time, so the repo does not accumulate binary blobs.
import type { RawImage } from '../../src/types.js'
import { bilinearResize } from '../../src/internal/resample.js'

/** Small, fast, seeded PRNG. Deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type PixelFn = (x: number, y: number) => [number, number, number, number]

export function makeImage(width: number, height: number, fn: PixelFn): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }
  return { width, height, data }
}

export function clone(img: RawImage): RawImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

export function solid(
  width: number,
  height: number,
  rgb: [number, number, number],
  alpha = 255,
): RawImage {
  return makeImage(width, height, () => [rgb[0], rgb[1], rgb[2], alpha])
}

/** Smooth left to right luminance ramp. The canonical "no blocking" fixture. */
export function horizontalGradient(width: number, height: number): RawImage {
  return makeImage(width, height, (x) => {
    const v = Math.round((x / Math.max(1, width - 1)) * 255)
    return [v, v, v, 255]
  })
}

/** Independent uniform RGB noise. Full spectral occupancy, maximal detail. */
export function noiseImage(width: number, height: number, seed = 1): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => [
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    255,
  ])
}

/** Adds zero mean gaussian noise (Box Muller) to a copy of the image. */
export function addGaussianNoise(img: RawImage, stddev: number, seed = 1): RawImage {
  const rand = mulberry32(seed)
  const out = clone(img)
  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  for (let i = 0; i < out.data.length; i++) {
    if (i % 4 === 3) continue
    out.data[i] = (out.data[i] ?? 0) + gauss() * stddev
  }
  return out
}

/** Separable gaussian blur with clamped edges. Applied to all four channels. */
export function gaussianBlur(img: RawImage, sigma: number): RawImage {
  if (sigma <= 0) return clone(img)
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float64Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = w
    sum += w
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = (kernel[i] ?? 0) / sum

  const { width, height } = img
  const pass = (src: Float64Array, horizontal: boolean): Float64Array => {
    const dst = new Float64Array(src.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let acc = 0
          for (let k = -radius; k <= radius; k++) {
            const sx = horizontal ? Math.min(Math.max(x + k, 0), width - 1) : x
            const sy = horizontal ? y : Math.min(Math.max(y + k, 0), height - 1)
            acc += (src[(sy * width + sx) * 4 + c] ?? 0) * (kernel[k + radius] ?? 0)
          }
          dst[(y * width + x) * 4 + c] = acc
        }
      }
    }
    return dst
  }

  const asFloat = Float64Array.from(img.data)
  const blurred = pass(pass(asFloat, true), false)
  return { width, height, data: new Uint8ClampedArray(blurred.map((v) => Math.round(v))) }
}

/**
 * Replaces every 8x8 block with its per channel mean. Produces the
 * canonical synthetic "JPEG at quality 0" blocking pattern.
 */
export function blockQuantize8(img: RawImage): RawImage {
  const { width, height, data } = img
  const out = new Uint8ClampedArray(data.length)
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      const bw = Math.min(8, width - bx)
      const bh = Math.min(8, height - by)
      const mean = [0, 0, 0, 0]
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const o = ((by + y) * width + (bx + x)) * 4
          for (let c = 0; c < 4; c++) mean[c] = (mean[c] ?? 0) + (data[o + c] ?? 0)
        }
      }
      const n = bw * bh
      for (let c = 0; c < 4; c++) mean[c] = Math.round((mean[c] ?? 0) / n)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const o = ((by + y) * width + (bx + x)) * 4
          for (let c = 0; c < 4; c++) out[o + c] = mean[c] ?? 0
        }
      }
    }
  }
  return { width, height, data: out }
}

/** Bilinear 2x upscale. The extra pixels carry no new information. */
export function upscale2x(img: RawImage): RawImage {
  return bilinearResize(img, img.width * 2, img.height * 2)
}

/**
 * Two solid images with (nearly) identical Rec. 601 luma but very different
 * hue. Grayscale SSIM sees almost nothing; deltaE must see a lot. This pair
 * is the entire justification for the deltaE metric existing.
 */
export function equalLumaPair(width: number, height: number): [RawImage, RawImage] {
  // luma(200,100,100) = 129.90, luma(100,141,150) = 129.77
  return [solid(width, height, [200, 100, 100]), solid(width, height, [100, 141, 150])]
}
