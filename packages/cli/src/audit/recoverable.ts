import type { Container, Headroom } from '@cupel/core'

/**
 * The recoverable-bytes estimate. This is the one number in the audit that
 * is a MODEL rather than a measurement, and it is labelled as such
 * everywhere it is printed, because an audit never encodes anything: it
 * fetches headers and reads what is already there. `cupel write` measures
 * for real, and its numbers are the ones that go in a receipt.
 *
 * Two independent factors, composed multiplicatively because they attack
 * different waste:
 *
 * 1. Oversize. Bytes scale roughly with pixel count, so shipping an image
 *    at four times the area the layout uses wastes roughly three quarters
 *    of it. This is the largest and most reliable term, and it needs the
 *    display dimensions, which only the URL audit has.
 * 2. Format and provenance. A JPEG re-encoded to a modern format at
 *    matched visual quality typically lands well below its original bytes;
 *    a PNG carrying photographic content that was laundered out of a JPEG
 *    is the extreme case, because PNG is storing DCT noise losslessly.
 *
 * Every coefficient below is a documented guess awaiting corpus
 * calibration, the same caveat family as the SSIM floors (issue #7). They
 * are deliberately conservative: an audit that under-promises and then gets
 * beaten by the writer is honest, one that over-promises is marketing.
 */

/** Fractional byte savings expected from a format change alone. */
const FORMAT_FACTOR = {
  /** jpeg -> webp/avif at matched visual quality. */
  jpegModernized: 0.25,
  /** A photographic png is nearly always a mistake; modern lossy crushes it. */
  pngPhotographic: 0.65,
  /** Flat graphics: png -> lossless webp is a real but modest win. */
  pngGraphic: 0.18,
  /** webp -> avif. Narrower, since webp is already modern. */
  webpModernized: 0.15,
  /** Already the best format available. */
  none: 0,
} as const

/**
 * Extra headroom when the quality knob was left high. Quantization step
 * size grows faster than quality falls, so a q95 source has far more slack
 * than a q80 one. Applied on top of the format factor for jpeg sources.
 */
function qualitySlack(estimatedQuality: number | null): number {
  if (estimatedQuality === null) return 0
  if (estimatedQuality >= 95) return 0.3
  if (estimatedQuality >= 90) return 0.2
  if (estimatedQuality >= 85) return 0.1
  return 0
}

/**
 * Blocking score at or above which a lossless container is treated as
 * carrying laundered JPEG pixels. Mirrors LAUNDERED_BLOCKING_SCORE in
 * core's provenance/headroom.ts; duplicated rather than exported because
 * this is a reporting heuristic, not the provenance rule itself.
 */
const LAUNDERED_BLOCKING_SCORE = 1 / 3

export type RecoverableInputs = {
  container: Container
  fileBytes: number
  headroom: Headroom | null
  estimatedOriginalQuality: number | null
  /** Normalized 0..1, from core. null when pixels were not decoded. */
  blockingScore: number | null
  declaredArea: number | null
  /** Rendered area in CSS pixels, when the crawl could estimate it. */
  displayArea: number | null
}

export type RecoverableEstimate = {
  bytes: number
  fraction: number
  /** The terms that produced the number, for the report's footnotes. */
  basis: string[]
}

function formatFactor(input: RecoverableInputs): { factor: number; note: string } {
  switch (input.container) {
    case 'jpeg': {
      const slack = qualitySlack(input.estimatedOriginalQuality)
      const factor = FORMAT_FACTOR.jpegModernized + slack
      const note =
        slack > 0
          ? `jpeg at estimated q${input.estimatedOriginalQuality}: modernizing the format plus the unused quality slack`
          : 'jpeg: modernizing the format at matched visual quality'
      return { factor, note }
    }
    case 'png': {
      const laundered =
        input.blockingScore !== null && input.blockingScore >= LAUNDERED_BLOCKING_SCORE
      return laundered
        ? {
            factor: FORMAT_FACTOR.pngPhotographic,
            note: 'png carrying 8x8 DCT seams: photographic pixels stored losslessly',
          }
        : {
            factor: FORMAT_FACTOR.pngGraphic,
            note: 'png: lossless webp is smaller for flat graphics',
          }
    }
    case 'webp':
      return { factor: FORMAT_FACTOR.webpModernized, note: 'webp: avif is usually smaller again' }
    case 'gif':
      return {
        factor: FORMAT_FACTOR.pngPhotographic,
        note: 'gif: an animated webp is dramatically smaller, but cupel will not flatten it automatically',
      }
    default:
      return {
        factor: FORMAT_FACTOR.none,
        note: `${input.container}: nothing this model can claim`,
      }
  }
}

export function estimateRecoverable(input: RecoverableInputs): RecoverableEstimate {
  const basis: string[] = []

  // Refusal wins over every optimistic term. If there is no headroom left,
  // the honest recoverable figure is zero: the only path to fewer bytes
  // runs through finding a better original, which an audit cannot do.
  if (input.headroom === 'none') {
    return {
      bytes: 0,
      fraction: 0,
      basis: ['headroom none: cupel would refuse to re-encode, so nothing is claimed here'],
    }
  }

  let oversize = 0
  if (input.declaredArea !== null && input.displayArea !== null && input.displayArea > 0) {
    // A little slop is normal and not worth reporting: high-DPI displays
    // legitimately want more pixels than the CSS box.
    const ratio = input.displayArea / input.declaredArea
    if (ratio < 1 / 1.2) {
      oversize = 1 - ratio
      basis.push(
        `oversize: ${Math.round(input.declaredArea).toLocaleString()} px of image for ` +
          `${Math.round(input.displayArea).toLocaleString()} px of layout`,
      )
    }
  }

  const format = formatFactor(input)
  if (format.factor > 0) basis.push(format.note)

  // Composed on what survives the previous term, never summed: resizing
  // first and then re-encoding cannot save more than 100% of the file.
  const fraction = Math.min(0.95, 1 - (1 - oversize) * (1 - format.factor))
  if (input.headroom === 'low' && fraction > 0) {
    basis.push('headroom low: the writer may still refuse, in which case this drops to zero')
  }
  if (basis.length === 0) basis.push('no waste this model can identify')

  return { bytes: Math.round(input.fileBytes * fraction), fraction, basis }
}
