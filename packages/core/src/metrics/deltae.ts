import type { RawImage } from '../types.js'

export type DeltaEResult = {
  /** Mean CIE76 deltaE across all pixels. */
  mean: number
  /** 95th percentile CIE76 deltaE across all pixels. */
  p95: number
}

// D65 reference white in XYZ, the sRGB standard illuminant.
const XN = 0.95047
const YN = 1.0
const ZN = 1.08883

// Lab transfer function breakpoint, delta = 6/29.
const LAB_DELTA = 6 / 29
const LAB_DELTA_CUBED = LAB_DELTA * LAB_DELTA * LAB_DELTA
const LAB_SLOPE = 1 / (3 * LAB_DELTA * LAB_DELTA)

// 8 bit sRGB to linear, precomputed once. The piecewise IEC 61966-2-1 curve:
// s <= 0.04045 uses the linear toe s / 12.92, above it ((s + 0.055) / 1.055)^2.4.
const SRGB_TO_LINEAR = (() => {
  const table = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const s = i / 255
    table[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return table
})()

function labF(t: number): number {
  return t > LAB_DELTA_CUBED ? Math.cbrt(t) : t * LAB_SLOPE + 4 / 29
}

/**
 * Lab of one pixel, written into out as [L, a, b]. The linear RGB to XYZ
 * matrix is the standard sRGB D65 matrix (IEC 61966-2-1 primaries, the
 * 7 decimal coefficients as tabulated by Bruce Lindbloom); its rows sum to
 * (Xn, 1, Zn), so neutral grays land on the L axis with a = b = 0.
 */
function pixelLab(data: Uint8ClampedArray, offset: number, out: Float64Array): void {
  const r = SRGB_TO_LINEAR[data[offset] ?? 0] ?? 0
  const g = SRGB_TO_LINEAR[data[offset + 1] ?? 0] ?? 0
  const b = SRGB_TO_LINEAR[data[offset + 2] ?? 0] ?? 0
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const fx = labF(x / XN)
  const fy = labF(y / YN)
  const fz = labF(z / ZN)
  out[0] = 116 * fy - 16
  out[1] = 500 * (fx - fy)
  out[2] = 200 * (fy - fz)
}

/**
 * Per pixel CIE76 deltaE between two same sized images, through
 * sRGB to linear to XYZ to Lab with the D65 white point. Exists because
 * grayscale SSIM is blind to chroma only shifts, which is exactly where
 * aggressive chroma subsampling hides.
 *
 * Alpha is ignored. p95 is the value at index min(n - 1, ceil(0.95 * n) - 1)
 * of the ascending sorted per pixel distances, i.e. the smallest value that
 * at least 95 percent of pixels do not exceed.
 */
export function deltaE(a: RawImage, b: RawImage): DeltaEResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`deltaE: dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  const n = a.width * a.height
  if (n === 0) {
    throw new Error('deltaE: empty image')
  }
  const distances = new Float64Array(n)
  const labA = new Float64Array(3)
  const labB = new Float64Array(3)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    pixelLab(a.data, o, labA)
    pixelLab(b.data, o, labB)
    const dL = (labA[0] ?? 0) - (labB[0] ?? 0)
    const dA = (labA[1] ?? 0) - (labB[1] ?? 0)
    const dB = (labA[2] ?? 0) - (labB[2] ?? 0)
    const d = Math.sqrt(dL * dL + dA * dA + dB * dB)
    distances[i] = d
    sum += d
  }
  distances.sort()
  const p95Index = Math.min(n - 1, Math.ceil(0.95 * n) - 1)
  return { mean: sum / n, p95: distances[p95Index] ?? 0 }
}
