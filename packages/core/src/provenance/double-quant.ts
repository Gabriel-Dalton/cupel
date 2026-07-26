import type { RawImage } from '../types.js'
import { toGrayscale } from '../internal/luma.js'
import { JPEG_ZIGZAG } from './jpeg-dqt.js'

/**
 * Double-quantization detection for generation counting (Popescu and
 * Farid, 2004). If a JPEG was decoded and re-encoded at a different
 * quality, each DCT band was quantized twice with different steps, and the
 * histogram of the CURRENT quantization indices shows periodic peaks and
 * gaps: index u is reachable only as round(q1 * m / q2), so when q1 > q2
 * whole runs of u values are empty while others double up.
 *
 * The detector recomputes the luma DCT from decoded pixels (block grid
 * assumed at the JPEG origin), divides each of the first 15 AC bands by
 * its CURRENT quantization step (from the file's own DQT, which the caller
 * parses), histograms the integer indices, and scores each band's
 * histogram for periodicity via the DFT of its detrended profile.
 *
 * Everything this module emits is EVIDENCE with stated uncertainty, never
 * a verdict (BRIEF 4.2, types.ts). Known blind spots, by construction:
 * re-encoding at the SAME quality is invisible (the quantizer is
 * idempotent), a first generation FINER than the second aliases into the
 * comb and is mostly invisible, and a never-compressed source is
 * indistinguishable from a single clean encode. generations: 1 therefore
 * means "no evidence of more than the container's own encode".
 */

export type DoubleQuantBand = {
  /** Zigzag position of the AC band, 1..15. */
  zigzagIndex: number
  /** Natural (row major) index of the band in the quant table. */
  naturalIndex: number
  /** The current quantization step used to bin this band. */
  step: number
  /** Coefficients whose |index| landed in [1, HISTOGRAM_BINS]. */
  samples: number
  /** Peak to median power ratio of the detrended histogram spectrum. */
  periodicity: number
  /** periodicity >= PERIODICITY_THRESHOLD. */
  periodic: boolean
}

export type DoubleQuantResult = {
  /**
   * 1: no double-quantization signature (single generation, as far as the
   * evidence goes). 2: periodic structure across multiple bands, at least
   * two generations. null: undetermined (too little data, or scattered
   * weak periodicity that supports neither reading).
   */
  generations: number | null
  /** Rough 0..1 weight of the evidence. 0 when generations is null. */
  confidence: number
  /** Bands with enough populated histogram mass to score. */
  bandsAnalyzed: number
  periodicBands: number
  bands: DoubleQuantBand[]
  /** Human readable reasons. Always populated. */
  evidence: string[]
}

/** First 15 AC bands in zigzag order carry almost all usable signal. */
const NUM_BANDS = 15

/** Histogram covers quantization indices |u| in 1..40. */
const HISTOGRAM_BINS = 40

/** A band needs this many in-range nonzero coefficients to be scored. */
const MIN_SAMPLES = 128

/** Below this many full 8x8 blocks the whole analysis is refused. */
const MIN_BLOCKS = 64

/** Bands below this count leave the generation question unanswered. */
const MIN_USABLE_BANDS = 3

/**
 * Peak to median power ratio above which a band's histogram is called
 * periodic. The score works on log(1 + count): an exponentially decaying
 * histogram is nearly linear there, so the moving-average detrend removes
 * it almost completely (raw counts leave a cliff residual at the first
 * bins of steep bands and shelf artifacts that scored up to 25 on single
 * generation fixtures), while comb gaps swing the log profile by several
 * units regardless of absolute counts. Calibration on the fixtures in
 * test/provenance/double-quant.test.ts (512px planes, 4096 blocks, 10
 * seeds): across 50 single-generation runs at qualities 75..98 (750 band
 * scores) the maximum was 33.7 and the 99th percentile 21.8, while for
 * coarse-then-fine double quantization at five quality pairs the FOURTH
 * highest band score per run was never below 82. 50 sits mid-gap: a 1.5x
 * margin above the single-generation maximum and below the weakest double
 * signal that the >= 2 periodic bands rule needs.
 */
const PERIODICITY_THRESHOLD = 50

/**
 * Spectrum bins 1 and 2 (periods above ~13 index bins) are excluded from
 * the peak search: residual envelope after detrending lives there, and no
 * plausible quality pair produces a step ratio that slow.
 */
const MIN_SPECTRUM_BIN = 3

/**
 * At least this many bands must independently cross PERIODICITY_THRESHOLD
 * to call a second generation. The count is deliberately NOT a fraction of
 * the usable bands: on real photographic content the re-quantization comb
 * only survives in the low AC bands that keep histogram mass after the
 * first quantization (sharp-encoded 60 to 90 re-encodes show 3 of 15 bands
 * periodic at scores 100..380 while the high bands sit at noise level),
 * and demanding agreement from bands that physically cannot carry the
 * signal rejected exactly the cases the analysis exists to catch. Exactly
 * one crossing is reported as undetermined rather than single generation:
 * no measured single-generation band ever crossed, so one crossing is
 * genuinely ambiguous.
 */
const MIN_PERIODIC_BANDS = 2

/** cos((2x + 1) u pi / 16) for u * 8 + x, shared by both transforms. */
const DCT_COS = (() => {
  const t = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      t[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16)
    }
  }
  return t
})()

const INV_SQRT2 = Math.SQRT1_2

/**
 * JPEG forward 2D DCT-II of one 8x8 block (row major, 64 values):
 * F(u,v) = 1/4 C(u) C(v) sum f(x,y) cos((2x+1)u pi/16) cos((2y+1)v pi/16),
 * computed separably. A constant block of value c transforms to DC = 8c.
 */
export function forwardDct8x8(block: Float64Array): Float64Array {
  const tmp = new Float64Array(64)
  // Rows: tmp[y][u] = 1/2 C(u) sum_x block[y][x] cos((2x+1)u pi/16)
  for (let y = 0; y < 8; y++) {
    const row = y * 8
    for (let u = 0; u < 8; u++) {
      let acc = 0
      for (let x = 0; x < 8; x++) {
        acc += (block[row + x] ?? 0) * (DCT_COS[u * 8 + x] ?? 0)
      }
      tmp[row + u] = 0.5 * (u === 0 ? INV_SQRT2 : 1) * acc
    }
  }
  // Columns: out[v][u] = 1/2 C(v) sum_y tmp[y][u] cos((2y+1)v pi/16)
  const out = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let acc = 0
      for (let y = 0; y < 8; y++) {
        acc += (tmp[y * 8 + u] ?? 0) * (DCT_COS[v * 8 + y] ?? 0)
      }
      out[v * 8 + u] = 0.5 * (v === 0 ? INV_SQRT2 : 1) * acc
    }
  }
  return out
}

/** Exact inverse of forwardDct8x8. */
export function inverseDct8x8(coeffs: Float64Array): Float64Array {
  const tmp = new Float64Array(64)
  // Columns first: tmp[y][u] = 1/2 sum_v C(v) coeffs[v][u] cos((2y+1)v pi/16)
  for (let u = 0; u < 8; u++) {
    for (let y = 0; y < 8; y++) {
      let acc = 0
      for (let v = 0; v < 8; v++) {
        acc += (v === 0 ? INV_SQRT2 : 1) * (coeffs[v * 8 + u] ?? 0) * (DCT_COS[v * 8 + y] ?? 0)
      }
      tmp[y * 8 + u] = 0.5 * acc
    }
  }
  const out = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let acc = 0
      for (let u = 0; u < 8; u++) {
        acc += (u === 0 ? INV_SQRT2 : 1) * (tmp[y * 8 + u] ?? 0) * (DCT_COS[u * 8 + x] ?? 0)
      }
      out[y * 8 + x] = 0.5 * acc
    }
  }
  return out
}

/**
 * Periodicity of one folded index histogram (counts for |u| = 1..40).
 * The histogram is taken to log(1 + count), where the near-exponential
 * decay every band shows becomes near-linear and is removed almost
 * entirely by a radius-2 moving-average detrend, while comb gaps (bins a
 * double quantizer cannot reach) swing the profile by several log units.
 * The power spectrum of the residual is then scanned: a comb concentrates
 * power at its fundamental and harmonics, sampling noise spreads it
 * evenly. The score is peak power over median power across spectrum bins
 * MIN_SPECTRUM_BIN..HISTOGRAM_BINS/2.
 */
function periodicityScore(hist: Float64Array): number {
  const n = HISTOGRAM_BINS
  const logCounts = new Float64Array(n)
  for (let k = 0; k < n; k++) logCounts[k] = Math.log(1 + (hist[k] ?? 0))
  const residual = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const lo = Math.max(0, k - 2)
    const hi = Math.min(n - 1, k + 2)
    let mean = 0
    for (let i = lo; i <= hi; i++) mean += logCounts[i] ?? 0
    residual[k] = (logCounts[k] ?? 0) - mean / (hi - lo + 1)
  }
  const half = n / 2
  const power: number[] = []
  for (let f = MIN_SPECTRUM_BIN; f <= half; f++) {
    let re = 0
    let im = 0
    for (let k = 0; k < n; k++) {
      const angle = (-2 * Math.PI * f * k) / n
      re += (residual[k] ?? 0) * Math.cos(angle)
      im += (residual[k] ?? 0) * Math.sin(angle)
    }
    power.push(re * re + im * im)
  }
  const sorted = [...power].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const peak = sorted[sorted.length - 1] ?? 0
  if (median <= 0) return peak > 0 ? Number.POSITIVE_INFINITY : 0
  return peak / median
}

/**
 * Detects double quantization on the luma plane. lumaQuantTable is the
 * CURRENT file's luminance table in natural order (from parseJpeg /
 * selectQuantTables); the detector needs it to bin coefficients by the
 * last quantizer actually applied, which sidesteps fragile step
 * estimation. The 8x8 grid is assumed to sit at the image origin, which
 * holds for any decode that was not subsequently cropped.
 */
export function detectDoubleQuantization(
  img: RawImage,
  lumaQuantTable: ArrayLike<number>,
): DoubleQuantResult {
  const blocksX = Math.floor(img.width / 8)
  const blocksY = Math.floor(img.height / 8)
  const blockCount = blocksX * blocksY
  if (blockCount < MIN_BLOCKS) {
    return {
      generations: null,
      confidence: 0,
      bandsAnalyzed: 0,
      periodicBands: 0,
      bands: [],
      evidence: [
        `double quantization: undetermined, only ${blockCount} full 8x8 blocks ` +
          `(minimum ${MIN_BLOCKS})`,
      ],
    }
  }

  const gray = toGrayscale(img)
  const histograms: Float64Array[] = []
  const steps: number[] = []
  for (let k = 1; k <= NUM_BANDS; k++) {
    histograms.push(new Float64Array(HISTOGRAM_BINS))
    steps.push(Math.max(1, Math.round(Number(lumaQuantTable[JPEG_ZIGZAG[k] ?? 0] ?? 1))))
  }

  const block = new Float64Array(64)
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      for (let y = 0; y < 8; y++) {
        const row = (by * 8 + y) * img.width + bx * 8
        for (let x = 0; x < 8; x++) {
          block[y * 8 + x] = (gray[row + x] ?? 0) - 128
        }
      }
      const coeffs = forwardDct8x8(block)
      for (let k = 1; k <= NUM_BANDS; k++) {
        const c = coeffs[JPEG_ZIGZAG[k] ?? 0] ?? 0
        const u = Math.round(c / (steps[k - 1] ?? 1))
        const magnitude = Math.abs(u)
        if (magnitude >= 1 && magnitude <= HISTOGRAM_BINS) {
          const hist = histograms[k - 1]
          if (hist) hist[magnitude - 1] = (hist[magnitude - 1] ?? 0) + 1
        }
      }
    }
  }

  const bands: DoubleQuantBand[] = []
  for (let k = 1; k <= NUM_BANDS; k++) {
    const hist = histograms[k - 1]
    if (!hist) continue
    const samples = hist.reduce((s, v) => s + v, 0)
    if (samples < MIN_SAMPLES) continue
    const periodicity = periodicityScore(hist)
    bands.push({
      zigzagIndex: k,
      naturalIndex: JPEG_ZIGZAG[k] ?? 0,
      step: steps[k - 1] ?? 1,
      samples,
      periodicity,
      periodic: periodicity >= PERIODICITY_THRESHOLD,
    })
  }

  const usable = bands.length
  const periodic = bands.filter((b) => b.periodic).length
  const evidence: string[] = []

  if (usable < MIN_USABLE_BANDS) {
    evidence.push(
      `double quantization: undetermined, only ${usable} of ${NUM_BANDS} AC bands ` +
        `carried enough coefficients to analyze (minimum ${MIN_USABLE_BANDS})`,
    )
    return { generations: null, confidence: 0, bandsAnalyzed: usable, periodicBands: periodic, bands, evidence }
  }

  if (periodic >= MIN_PERIODIC_BANDS) {
    const confidence = Math.min(1, 0.3 + 0.7 * (periodic / usable))
    evidence.push(
      `double quantization: ${periodic} of ${usable} analyzed AC bands show periodic ` +
        `index histograms, consistent with at least two encode generations ` +
        `(confidence ${confidence.toFixed(2)})`,
    )
    return { generations: 2, confidence, bandsAnalyzed: usable, periodicBands: periodic, bands, evidence }
  }

  if (periodic === 0) {
    evidence.push(
      `double quantization: none of ${usable} analyzed AC bands show periodicity, ` +
        `no evidence beyond a single generation (confidence 0.70; same-quality ` +
        `re-encodes and fine-then-coarse histories are invisible to this analysis)`,
    )
    return { generations: 1, confidence: 0.7, bandsAnalyzed: usable, periodicBands: 0, bands, evidence }
  }

  evidence.push(
    `double quantization: undetermined, exactly 1 of ${usable} analyzed AC bands ` +
      `shows periodicity, which supports neither a single nor a repeated encode`,
  )
  return { generations: null, confidence: 0, bandsAnalyzed: usable, periodicBands: periodic, bands, evidence }
}
