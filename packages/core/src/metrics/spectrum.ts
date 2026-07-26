import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'

export type EffectiveResolutionResult = {
  declared: { w: number; h: number }
  /**
   * The resolution implied by where spectral energy actually stops, in
   * original pixels. Never exceeds certifiedUpTo: when the declared long
   * edge is larger than the analysis plane, detail finer than the plane
   * cannot be observed, so effective saturates there (see certifiedUpTo).
   */
  effective: { w: number; h: number }
  /**
   * Spectral cutoff as a fraction of the declared Nyquist, in (0, 1].
   * A native image is near 1.0. An image upscaled 2x rolls off near 0.5.
   * When the declared long edge exceeds the analysis plane this is capped
   * by construction at (plane / longEdge), so a saturated measurement never
   * reads as "native"; compare effective against certifiedUpTo instead.
   */
  cutoffRatio: number
  /**
   * The largest effective resolution this analysis could have certified.
   * Equals declared when the long edge fits the analysis plane (at most
   * 1024). For larger images the plane is a prefiltered reduction, so the
   * metric can only certify detail up to the plane size: certifiedUpTo is
   * declared scaled by (plane / longEdge). If effective == certifiedUpTo
   * and certifiedUpTo < declared, the image carries at least this much
   * real detail and possibly more; it must NOT be read as upscaled.
   */
  certifiedUpTo: { w: number; h: number }
}

/**
 * Analysis plane sizes. The plane is always square (radial averaging
 * assumes rough isotropy anyway) and a power of two so the radix-2 FFT
 * applies. The size adapts to the declared long edge D: 256 for D <= 256,
 * 512 for D <= 512, 1024 otherwise. Adapting matters because a fixed plane
 * smaller than the image destroys the upscale signature: the knee of a 2x
 * upscale of E-pixel content sits at analysis ratio E / plane, and once
 * the plane is much smaller than E the knee lands outside the band or
 * inside resampling artifacts. The 1024 cap bounds FFT cost; its price is
 * saturation for larger images, made explicit via certifiedUpTo.
 *
 * Useful identity: after resampling the long edge from D to plane A, real
 * content that stops at E original pixels stops at analysis ratio E / A
 * regardless of D (spatial frequencies scale by D / A, and content spans
 * fraction E / D of the declared band, so (E / D) * (D / A) = E / A).
 * Therefore effectiveLongEdge = rAnalysis * A, and cutoffRatio =
 * effectiveLongEdge / D is comparable across declared sizes.
 */
const MAX_ANALYSIS_SIZE = 1024

function analysisSizeFor(longEdge: number): number {
  if (longEdge <= 256) return 256
  if (longEdge <= 512) return 512
  return MAX_ANALYSIS_SIZE
}

/** Radial frequency bins from r = 0 (DC) to r = 0.5 (Nyquist). */
const BINS = 64

/** Inputs smaller than this carry too few samples for a meaningful spectrum. */
const MIN_DIMENSION = 16

/**
 * The cutoff threshold works on the WHITENED spectrum W[b] = P[b] * f_b^2
 * (f_b the bin center frequency), not on raw power. Natural photographic
 * spectra follow an approximate 1/f^2 power law spanning three or more
 * decades across the band, so any threshold relative to the raw peak cuts
 * them long before Nyquist and flags native photographs as upscaled.
 * Multiplying each bin by f^2 flattens that law to an approximately
 * constant profile, turns flat synthetic noise into a rising profile, and
 * leaves the collapse above a genuine upscale knee as the only thing that
 * still falls: a single relative threshold then works for both spectrum
 * families. The exponent 2 is centered on the natural-image law.
 *
 * WHITENED_EPSILON is the fraction of the whitened reference maximum a bin
 * must exceed to count as real content. Calibration, measured on the
 * fixtures in test/metrics/spectrum.test.ts at epsilon 0.4, guard 3:
 *   flat noise 256 native:               cutoffRatio 1.000 (need > 0.8)
 *   low contrast noise (128 +/- 10):     cutoffRatio 1.000 (need > 0.8)
 *   1/f natural noise 256, six seeds:    cutoffRatio 1.000 (need > 0.75)
 *   2x bilinear upscale 128 -> 256:      cutoffRatio 0.563..0.594 (truth 0.5)
 *   2x upscale declared 400/512/1024:    effective/declared 0.520/0.594/0.578
 *   noise 800x600 (plane 1024):          effective 800x600 (need long >= 600)
 *   noise 1536x1024 (saturating):        effective 1024x683 = certifiedUpTo
 *   gaussian blur sigma 0.5/0.6/0.8/2.0: 1.000/1.000/0.672/0.266 (non increasing)
 * Every epsilon in the measured sweep [0.2, 0.5] satisfies every case; 0.4
 * puts the 2x upscale cutoffs nearest their truth of 0.5 while leaving the
 * natural 1/f plateau about 1.6x above the threshold at its weakest bin.
 * Below the window the sinc^2 imaging tail that bilinear 2x upscaling
 * leaves above the knee (raw power 1e-3 to 1e-1 of the plateau, decaying
 * with r) survives the threshold and pushes upscale cutoffs high; above it
 * the attenuated-but-genuine content that bilinear resampling to the plane
 * leaves near the top of the band gets cut and native images read as
 * upscaled.
 */
const WHITENED_EPSILON = 0.4

/**
 * The reference maximum for the threshold ignores the lowest bins, where
 * the whitening approximation is systematically biased: within bin 1 and
 * bin 2 the true frequency spans a factor of 2 to 3 while whitening
 * multiplies the whole bin by its center frequency squared, so a steep
 * natural spectrum (1/f^2 and steeper) overshoots there by several tenths
 * of a decade, and those annuli hold only a handful of DFT cells to
 * average the estimate down. Bins below the guard can still be the
 * reported cutoff; they just cannot set the reference level.
 */
const LOW_BIN_GUARD = 3

/**
 * Below this absolute power in every non-DC bin the image is treated as
 * having no spatial content at all (a solid fill windows to exactly zero).
 */
const NO_CONTENT_EPSILON = 1e-6

/**
 * Resample every row of a float plane from srcW to outW samples.
 * When shrinking (srcW > outW) this is a proper area average: each output
 * sample integrates the source over [tx, tx + 1] * srcW / outW with
 * fractional weights at the interval edges. That prefilter is what kills
 * aliasing; plain bilinear at scale < 0.5 folds high frequency content
 * back across the whole band and makes an upscaled large image look
 * native. When stretching (srcW < outW) it is bilinear with the same half
 * pixel convention as internal/resample.ts, kept in float so the analysis
 * input is not re-quantized to 8 bits.
 */
function resampleRows(src: Float64Array, srcW: number, height: number, outW: number): Float64Array {
  if (srcW === outW) return src
  const out = new Float64Array(outW * height)
  const ratio = srcW / outW
  if (srcW > outW) {
    for (let y = 0; y < height; y++) {
      const srcOff = y * srcW
      const outOff = y * outW
      for (let tx = 0; tx < outW; tx++) {
        const left = tx * ratio
        const right = left + ratio
        const last = Math.min(Math.ceil(right), srcW)
        let acc = 0
        for (let i = Math.floor(left); i < last; i++) {
          acc += (src[srcOff + i] ?? 0) * (Math.min(i + 1, right) - Math.max(i, left))
        }
        out[outOff + tx] = acc / ratio
      }
    }
    return out
  }
  const x0 = new Int32Array(outW)
  const x1 = new Int32Array(outW)
  const fx = new Float64Array(outW)
  for (let tx = 0; tx < outW; tx++) {
    const sx = Math.min(Math.max((tx + 0.5) * ratio - 0.5, 0), srcW - 1)
    const lo = Math.floor(sx)
    x0[tx] = lo
    x1[tx] = Math.min(lo + 1, srcW - 1)
    fx[tx] = sx - lo
  }
  for (let y = 0; y < height; y++) {
    const srcOff = y * srcW
    const outOff = y * outW
    for (let tx = 0; tx < outW; tx++) {
      const a = src[srcOff + (x0[tx] ?? 0)] ?? 0
      const b = src[srcOff + (x1[tx] ?? 0)] ?? 0
      out[outOff + tx] = a + (b - a) * (fx[tx] ?? 0)
    }
  }
  return out
}

/** Column-wise counterpart of resampleRows: srcH rows resampled to outH. */
function resampleCols(src: Float64Array, width: number, srcH: number, outH: number): Float64Array {
  if (srcH === outH) return src
  const out = new Float64Array(width * outH)
  const ratio = srcH / outH
  if (srcH > outH) {
    for (let ty = 0; ty < outH; ty++) {
      const top = ty * ratio
      const bottom = top + ratio
      const last = Math.min(Math.ceil(bottom), srcH)
      const outOff = ty * width
      const first = Math.floor(top)
      for (let x = 0; x < width; x++) {
        let acc = 0
        for (let i = first; i < last; i++) {
          acc += (src[i * width + x] ?? 0) * (Math.min(i + 1, bottom) - Math.max(i, top))
        }
        out[outOff + x] = acc / ratio
      }
    }
    return out
  }
  for (let ty = 0; ty < outH; ty++) {
    const sy = Math.min(Math.max((ty + 0.5) * ratio - 0.5, 0), srcH - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, srcH - 1)
    const fy = sy - y0
    const outOff = ty * width
    for (let x = 0; x < width; x++) {
      const a = src[y0 * width + x] ?? 0
      const b = src[y1 * width + x] ?? 0
      out[outOff + x] = a + (b - a) * fy
    }
  }
  return out
}

/**
 * Resample a single channel float plane to the square analysis size,
 * separably: rows first, then columns. Each axis independently uses the
 * area average when shrinking and bilinear when stretching, so a 3000x800
 * input is prefiltered in x and stretched in y, both correctly.
 */
function toAnalysisPlane(
  src: Float64Array,
  width: number,
  height: number,
  size: number,
): Float64Array {
  return resampleCols(resampleRows(src, width, height, size), size, height, size)
}

/**
 * In place iterative radix-2 Cooley-Tukey FFT. Length must be a power of
 * two; the analysis sizes guarantee that here. Unnormalized (no 1/N
 * factor), which is fine because every consumer of the spectrum is scale
 * relative.
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
 * energy value per radial frequency bin, always 64 bins, DC first and
 * Nyquist last, regardless of the analysis plane size.
 *
 * Pipeline: grayscale, resample to the adaptive square analysis plane
 * (area averaged when shrinking, bilinear when stretching, aspect ratio
 * deliberately ignored, see analysisSizeFor), subtraction of the window
 * weighted mean so the DC coefficient is exactly zero, a 2D Hann window
 * (outer product of the symmetric 1D Hann) to suppress edge discontinuity
 * leakage, self-implemented radix-2 FFT, then power (re^2 + im^2) averaged
 * into 64 bins by normalized radial frequency r = sqrt(fx^2 + fy^2) with
 * fx, fy in cycles per sample in [-0.5, 0.5). Corner frequencies beyond
 * the Nyquist radius (r > 0.5) are excluded. Values are unnormalized DFT
 * power: they scale with the plane size and are meaningful only relative
 * to each other within one call.
 */
export function radialPowerSpectrum(img: RawImage): Float64Array {
  const { width, height } = img
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new Error(
      `radialPowerSpectrum: image ${width}x${height} is too small, need at least 16x16`,
    )
  }
  const n = analysisSizeFor(Math.max(width, height))
  const gray = toAnalysisPlane(toGrayscale(img), width, height, n)

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
 * Finds the radial frequency where spectral energy stops and converts it
 * to the pixel dimensions the image really carries. An image declared at
 * 2400px whose spectrum rolls off at the equivalent of 900px was upscaled,
 * and the extra pixels are pure cost.
 *
 * Cutoff detection: whiten the spectrum (W[b] = P[b] * fb^2, see
 * WHITENED_EPSILON for why), then take the highest radius bin whose
 * whitened power exceeds WHITENED_EPSILON times the whitened maximum over
 * bins at or above LOW_BIN_GUARD, reported as that bin's upper edge ratio
 * so a full spectrum yields exactly 1.0 on the analysis plane. That analysis-plane ratio is then
 * rescaled by (plane / longEdge) into a fraction of the declared Nyquist
 * (see the identity at analysisSizeFor) and clamped to 1. A single
 * continuous rule replaces the old max(floor, peak epsilon) capped
 * threshold whose regime switches made the cutoff jump discontinuously
 * under smoothly increasing blur.
 *
 * Convention for images with no content (every non-DC bin at essentially
 * zero power): the minimum ratio 1/BINS, unscaled.
 */
export function effectiveResolution(img: RawImage): EffectiveResolutionResult {
  const spectrum = radialPowerSpectrum(img)
  const declared = { w: img.width, h: img.height }
  const longEdge = Math.max(declared.w, declared.h)
  const analysis = analysisSizeFor(longEdge)
  const certifyScale = Math.min(1, analysis / longEdge)
  const result = (cutoffRatio: number): EffectiveResolutionResult => ({
    declared,
    effective: {
      w: Math.round(declared.w * cutoffRatio),
      h: Math.round(declared.h * cutoffRatio),
    },
    cutoffRatio,
    certifiedUpTo: {
      w: Math.round(declared.w * certifyScale),
      h: Math.round(declared.h * certifyScale),
    },
  })

  let rawPeak = 0
  for (let b = 1; b < BINS; b++) {
    rawPeak = Math.max(rawPeak, spectrum[b] ?? 0)
  }
  if (rawPeak <= NO_CONTENT_EPSILON) {
    return result(1 / BINS)
  }

  // Whitened spectrum. (b + 0.5) is proportional to the bin center
  // frequency; constant factors cancel in the relative comparison.
  const whitened = new Float64Array(BINS)
  let whitenedMax = 0
  for (let b = 1; b < BINS; b++) {
    const fb = b + 0.5
    const w = (spectrum[b] ?? 0) * fb * fb
    whitened[b] = w
    if (b >= LOW_BIN_GUARD && w > whitenedMax) whitenedMax = w
  }
  const threshold = WHITENED_EPSILON * whitenedMax

  // The bin that set the reference maximum always exceeds the threshold
  // itself, so the scan always terminates with a bin in [1, BINS - 1].
  let cutoffBin = 1
  for (let b = BINS - 1; b >= 1; b--) {
    if ((whitened[b] ?? 0) > threshold) {
      cutoffBin = b
      break
    }
  }
  const rAnalysis = (cutoffBin + 1) / BINS
  return result(Math.min(1, (rAnalysis * analysis) / longEdge))
}
