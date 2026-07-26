import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'

export type EffectiveResolutionResult = {
  declared: { w: number; h: number }
  /** The resolution implied by where spectral energy actually stops. */
  effective: { w: number; h: number }
  /**
   * Spectral cutoff as a fraction of Nyquist, in (0, 1]. A native image is
   * near 1.0. An image upscaled 2x rolls off near 0.5.
   */
  cutoffRatio: number
}

/**
 * Every image is analyzed at this fixed square size, ignoring aspect ratio.
 * Radial averaging assumes rough isotropy anyway, and the fixed power-of-two
 * size keeps the radix-2 FFT applicable and fast.
 */
const ANALYSIS_SIZE = 256

/** Radial frequency bins from r = 0 (DC) to r = 0.5 (Nyquist). */
const BINS = 64

/** Inputs smaller than this carry too few samples for a meaningful spectrum. */
const MIN_DIMENSION = 16

/**
 * Cutoff threshold as a fraction of the peak non-DC bin. Chosen so the
 * sinc^2 shaped tail that bilinear 2x upscaling leaves above the original
 * Nyquist (roughly 1e-3 to 1e-1 of the plateau between ratio 0.5 and 0.8)
 * falls below threshold near ratio 0.6, while a flat native spectrum stays
 * above it everywhere.
 */
const PEAK_EPSILON = 0.05

/**
 * The noise floor is the median of the top 15 percent of bins by radius.
 * A bin must exceed FLOOR_MULTIPLE times that floor to count as signal.
 */
const TAIL_BINS = Math.ceil(BINS * 0.15)
const FLOOR_MULTIPLE = 2

/**
 * The floor estimate is only meaningful when the tail has actually
 * collapsed. Capping the threshold at half the peak guarantees a flat
 * spectrum (native noise, where floor and peak coincide) still reports a
 * near-Nyquist cutoff instead of finding no bin above its own level.
 */
const THRESHOLD_CAP = 0.5

/**
 * Below this absolute power in every non-DC bin the image is treated as
 * having no spatial content at all (a solid fill windows to exactly zero).
 */
const NO_CONTENT_EPSILON = 1e-6

/**
 * Bilinear resample of a single channel float plane to a square of the
 * given size. Same half pixel convention as internal/resample.ts, but kept
 * in float so the analysis input is not re-quantized to 8 bits.
 */
function resizeGrayscale(
  src: Float64Array,
  width: number,
  height: number,
  size: number,
): Float64Array {
  if (width === size && height === size) return src
  const out = new Float64Array(size * size)
  const xRatio = width / size
  const yRatio = height / size
  for (let ty = 0; ty < size; ty++) {
    const sy = Math.min(Math.max((ty + 0.5) * yRatio - 0.5, 0), height - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = sy - y0
    for (let tx = 0; tx < size; tx++) {
      const sx = Math.min(Math.max((tx + 0.5) * xRatio - 0.5, 0), width - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, width - 1)
      const fx = sx - x0
      const p00 = src[y0 * width + x0] ?? 0
      const p10 = src[y0 * width + x1] ?? 0
      const p01 = src[y1 * width + x0] ?? 0
      const p11 = src[y1 * width + x1] ?? 0
      const top = p00 + (p10 - p00) * fx
      const bottom = p01 + (p11 - p01) * fx
      out[ty * size + tx] = top + (bottom - top) * fy
    }
  }
  return out
}

/**
 * In place iterative radix-2 Cooley-Tukey FFT. Length must be a power of
 * two; ANALYSIS_SIZE guarantees that here. Unnormalized (no 1/N factor),
 * which is fine because every consumer of the spectrum is scale relative.
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j |= bit
    if (i < j) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    const half = len >> 1
    for (let start = 0; start < n; start += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half
        const aRe = re[a] ?? 0
        const aIm = im[a] ?? 0
        const bRe = re[b] ?? 0
        const bIm = im[b] ?? 0
        const tRe = bRe * curRe - bIm * curIm
        const tIm = bRe * curIm + bIm * curRe
        re[a] = aRe + tRe
        im[a] = aIm + tIm
        re[b] = aRe - tRe
        im[b] = aIm - tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** 2D FFT: row-wise passes then column-wise passes over an n by n plane. */
function fft2d(re: Float64Array, im: Float64Array, n: number): void {
  const lineRe = new Float64Array(n)
  const lineIm = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    const off = y * n
    for (let x = 0; x < n; x++) {
      lineRe[x] = re[off + x] ?? 0
      lineIm[x] = im[off + x] ?? 0
    }
    fftInPlace(lineRe, lineIm)
    for (let x = 0; x < n; x++) {
      re[off + x] = lineRe[x] ?? 0
      im[off + x] = lineIm[x] ?? 0
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      lineRe[y] = re[y * n + x] ?? 0
      lineIm[y] = im[y * n + x] ?? 0
    }
    fftInPlace(lineRe, lineIm)
    for (let y = 0; y < n; y++) {
      re[y * n + x] = lineRe[y] ?? 0
      im[y * n + x] = lineIm[y] ?? 0
    }
  }
}

/**
 * Radially averaged power spectrum of the grayscale image. Returned as one
 * energy value per radial frequency bin, DC first, Nyquist last.
 *
 * Pipeline: grayscale, bilinear resize to a fixed 256x256 analysis plane
 * (aspect ratio is deliberately ignored, see ANALYSIS_SIZE), subtraction of
 * the window weighted mean so the DC coefficient is exactly zero, a 2D Hann
 * window (outer product of the symmetric 1D Hann) to suppress edge
 * discontinuity leakage, self-implemented radix-2 FFT, then power
 * (re^2 + im^2) averaged into 64 bins by normalized radial frequency
 * r = sqrt(fx^2 + fy^2) with fx, fy in cycles per sample in [-0.5, 0.5).
 * Corner frequencies beyond the Nyquist radius (r > 0.5) are excluded.
 * Values are unnormalized DFT power, meaningful only relative to each other.
 */
export function radialPowerSpectrum(img: RawImage): Float64Array {
  const { width, height } = img
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new Error(
      `radialPowerSpectrum: image ${width}x${height} is too small, need at least 16x16`,
    )
  }
  const n = ANALYSIS_SIZE
  const gray = resizeGrayscale(toGrayscale(img), width, height, n)

  const hann = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }

  // Subtracting the plain mean leaves a small DC residue once the window is
  // applied. Subtracting the window weighted mean instead makes the DC
  // coefficient exactly zero: sum(w * (x - mu_w)) = 0 by construction.
  let weightSum = 0
  let weightedValueSum = 0
  for (let y = 0; y < n; y++) {
    const wy = hann[y] ?? 0
    for (let x = 0; x < n; x++) {
      const w = wy * (hann[x] ?? 0)
      weightSum += w
      weightedValueSum += w * (gray[y * n + x] ?? 0)
    }
  }
  const mean = weightSum > 0 ? weightedValueSum / weightSum : 0

  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let y = 0; y < n; y++) {
    const wy = hann[y] ?? 0
    for (let x = 0; x < n; x++) {
      re[y * n + x] = ((gray[y * n + x] ?? 0) - mean) * wy * (hann[x] ?? 0)
    }
  }
  fft2d(re, im, n)

  const sums = new Float64Array(BINS)
  const counts = new Uint32Array(BINS)
  const half = n / 2
  for (let v = 0; v < n; v++) {
    const fy = v < half ? v / n : (v - n) / n
    for (let u = 0; u < n; u++) {
      const fx = u < half ? u / n : (u - n) / n
      const r = Math.sqrt(fx * fx + fy * fy)
      if (r > 0.5) continue
      // Bin b covers r in [b, b + 1) * (0.5 / BINS); r = 0.5 exactly joins
      // the last bin.
      let b = Math.floor((r / 0.5) * BINS)
      if (b >= BINS) b = BINS - 1
      const rr = re[v * n + u] ?? 0
      const ii = im[v * n + u] ?? 0
      sums[b] = (sums[b] ?? 0) + rr * rr + ii * ii
      counts[b] = (counts[b] ?? 0) + 1
    }
  }
  const out = new Float64Array(BINS)
  for (let b = 0; b < BINS; b++) {
    const c = counts[b] ?? 0
    out[b] = c > 0 ? (sums[b] ?? 0) / c : 0
  }
  return out
}

/**
 * Finds the radial frequency where spectral energy falls below a noise
 * floor and converts it to the pixel dimensions the image really carries.
 * An image declared at 2400px whose spectrum rolls off at the equivalent
 * of 900px was upscaled, and the extra pixels are pure cost.
 *
 * Cutoff detection: the noise floor is the median of the TAIL_BINS highest
 * radius bins; the threshold is max(FLOOR_MULTIPLE * floor, PEAK_EPSILON *
 * peak non-DC bin), capped at THRESHOLD_CAP * peak so a flat spectrum can
 * never be entirely below its own floor estimate. The cutoff is the highest
 * radius bin above threshold, reported as that bin's upper edge ratio, so a
 * full spectrum yields exactly 1.0. Convention for images with no content
 * (every non-DC bin at essentially zero power): the minimum ratio 1/BINS.
 */
export function effectiveResolution(img: RawImage): EffectiveResolutionResult {
  const spectrum = radialPowerSpectrum(img)
  const declared = { w: img.width, h: img.height }
  const result = (cutoffRatio: number): EffectiveResolutionResult => ({
    declared,
    effective: {
      w: Math.round(declared.w * cutoffRatio),
      h: Math.round(declared.h * cutoffRatio),
    },
    cutoffRatio,
  })

  let peak = 0
  for (let b = 1; b < BINS; b++) {
    peak = Math.max(peak, spectrum[b] ?? 0)
  }
  if (peak <= NO_CONTENT_EPSILON) {
    return result(1 / BINS)
  }

  const tail: number[] = []
  for (let b = BINS - TAIL_BINS; b < BINS; b++) {
    tail.push(spectrum[b] ?? 0)
  }
  tail.sort((a, b) => a - b)
  const mid = tail.length >> 1
  const floor =
    tail.length % 2 === 1 ? (tail[mid] ?? 0) : ((tail[mid - 1] ?? 0) + (tail[mid] ?? 0)) / 2

  const threshold = Math.min(
    Math.max(FLOOR_MULTIPLE * floor, PEAK_EPSILON * peak),
    THRESHOLD_CAP * peak,
  )

  // The peak bin itself always exceeds the capped threshold, so the scan
  // always terminates with a bin in [1, BINS - 1].
  let cutoffBin = 1
  for (let b = BINS - 1; b >= 1; b--) {
    if ((spectrum[b] ?? 0) > threshold) {
      cutoffBin = b
      break
    }
  }
  return result((cutoffBin + 1) / BINS)
}
