/**
 * The playground's sweep plan: which encodes to run, in which order.
 *
 * Pure data derived from encoder capabilities. The worker feeds it the real
 * capabilities from @cupel/codecs-wasm; the tests feed it both those and
 * synthetic ones. Nothing here touches a codec, the DOM, or the filesystem.
 */

export type SweepFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Sweep order. Cheap encoders first so the curve fills in fast; avif last
 * because a single threaded wasm AV1 encode is the slow tail of the sweep
 * (BRIEF section 15 names progressive fill as the mitigation).
 */
export const SWEEP_FORMATS: readonly SweepFormat[] = ['jpeg', 'webp', 'png', 'avif']

/** The capabilities shape advertised by every @cupel Encoder. */
export type FormatCapabilities = {
  qualityRange: readonly [number, number]
  lossless: boolean
}

export type SweepStep = {
  format: SweepFormat
  /** null for lossless steps. */
  quality: number | null
  lossless: boolean
  /** Unique human readable name, e.g. 'webp q40' or 'png lossless'. */
  label: string
}

/** The quality ladder from BRIEF section 3.1: q40 to q95 in steps of 5. */
export const QUALITY_LADDER: readonly number[] = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]

/**
 * avif gets a coarser ladder, q40 to q90 in steps of 10. In single threaded
 * wasm each avif encode of a 1024 px reference takes seconds, and six points
 * still shape the hull; the CLI will run the full ladder natively.
 */
export const AVIF_QUALITY_LADDER: readonly number[] = [40, 50, 60, 70, 80, 90]

/**
 * Formats whose lossless mode is deliberately not swept. avif advertises
 * lossless, but a lossless AV1 encode is by far the slowest candidate in the
 * browser and nearly always loses to png on bytes, so measuring it spends
 * the visitor's time on a point that cannot win.
 */
const SKIP_LOSSLESS: ReadonlySet<SweepFormat> = new Set(['avif'])

/**
 * Builds the sweep plan for one image from the encoders' own capability
 * declarations. Per format: the lossy ladder (clamped into the advertised
 * quality range; lossless-only formats advertise [0, 0] and get no ladder),
 * then one lossless point when the format supports it and is not skipped.
 */
export function buildSweepPlan(caps: Record<SweepFormat, FormatCapabilities>): SweepStep[] {
  const plan: SweepStep[] = []
  for (const format of SWEEP_FORMATS) {
    const { qualityRange, lossless } = caps[format]
    const [lo, hi] = qualityRange
    // A lossy quality knob exists only when the range spans real values.
    if (hi > lo && hi >= 1) {
      const ladder = format === 'avif' ? AVIF_QUALITY_LADDER : QUALITY_LADDER
      for (const quality of ladder) {
        if (quality < lo || quality > hi) continue
        plan.push({ format, quality, lossless: false, label: `${format} q${quality}` })
      }
    }
    if (lossless && !SKIP_LOSSLESS.has(format)) {
      plan.push({ format, quality: null, lossless: true, label: `${format} lossless` })
    }
  }
  return plan
}
