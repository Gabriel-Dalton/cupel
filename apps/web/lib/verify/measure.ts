import {
  CIE76_JND_DELTA_E,
  DEFAULT_KAPPA,
  areaAverageResize,
  deltaE,
  distortion,
  ssim,
} from '@cupel/core'
import type { LedgerEntryV1, RawImage } from '@cupel/core'
import type { CodecFormat } from '@cupel/codecs-wasm'
import { hashRawImage } from './hash'
import type { DecodeFn, MetricComparison, Remeasurement, VerifyFile } from './types'

/**
 * Re-measurement: the heart of verification. Per BRIEF section 7, `verify`
 * re-reads the shipped output bytes, re-derives the reference from the
 * source, recomputes the metrics, and confirms the recorded numbers. It
 * never re-encodes, which is what makes the check independent of encoder
 * determinism: only decoders are involved, and decoders are bounded.
 */

/**
 * Cross-decoder slack, pinned by verify-measure.test.ts.
 *
 * The recorded numbers may have been measured through a different decoder
 * build than the jSquash wasm codecs this page ships (the CLI decodes with
 * sharp/libvips). The JPEG standard's compliance bounds (ISO/IEC 10918-1)
 * permit conforming IDCT implementations to differ by roughly one code
 * value per sample, and YUV to RGB rounding differs by up to one 8-bit step
 * across libwebp and libaom builds as well. Those differences touch a small
 * fraction of pixels by plus or minus one level, which moves 8x8 windowed
 * mean SSIM by well under 0.002 and mean CIE76 deltaE by well under 0.1 on
 * natural content. A genuinely different encode (even one JPEG quality
 * step) moves both by an order of magnitude more, so these bounds forgive
 * decoders without forgiving substitution. Ledger values are serialized
 * with finite precision too; that rounding is orders of magnitude below
 * these bounds.
 */
export const SSIM_TOLERANCE = 0.002
export const DELTA_E_TOLERANCE = 0.1

/**
 * Distortion is a pure function of the other two metrics,
 * d = (1 - ssim) + kappa * min(deltaE / jnd, 1), so its tolerance is the
 * exact worst-case propagation of theirs, never an independent knob. The
 * ledger does not record kappa; verification assumes the core default.
 */
export const DISTORTION_TOLERANCE =
  SSIM_TOLERANCE + DEFAULT_KAPPA * (DELTA_E_TOLERANCE / CIE76_JND_DELTA_E)

const FORMAT_ALIASES: Record<string, CodecFormat> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
}

/** Maps a ledger format string onto a decodable wasm codec, or null. */
export function supportedFormat(format: string): CodecFormat | null {
  return FORMAT_ALIASES[format.toLowerCase()] ?? null
}

/**
 * Re-derives the reference the writer measured against: the decoded source
 * at the recorded reference dimensions. Identity when the dimensions
 * already agree, area average downscale otherwise. Returns null when either
 * axis would need upscaling: fabricating pixels the source does not carry
 * is refused, on both axes, and the caller reports that refusal.
 */
export function deriveReference(source: RawImage, target: { w: number; h: number }): RawImage | null {
  if (target.w === source.width && target.h === source.height) {
    return { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) }
  }
  if (target.w > source.width || target.h > source.height) return null
  return areaAverageResize(source, target.w, target.h)
}

function unverifiable(notes: string[]): Remeasurement {
  return { verdict: 'unverifiable', notes, metrics: null, referenceHashMatch: null }
}

function compare(
  metric: MetricComparison['metric'],
  recorded: number,
  measured: number,
  tolerance: number,
): MetricComparison {
  return {
    metric,
    recorded,
    measured,
    tolerance,
    withinTolerance: Math.abs(measured - recorded) <= tolerance,
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function remeasure(
  entry: LedgerEntryV1,
  output: VerifyFile,
  source: VerifyFile,
  decode: DecodeFn,
): Promise<Remeasurement> {
  const recorded = entry.metrics
  const outputInfo = entry.output
  if (!recorded || !outputInfo) {
    return unverifiable(['This entry records no output metrics to re-measure.'])
  }

  const outFormat = supportedFormat(outputInfo.format)
  if (!outFormat) {
    return unverifiable([
      `Recorded output format "${outputInfo.format}" cannot be decoded here; this page decodes jpeg, png, webp, and avif.`,
    ])
  }
  const srcFormat = supportedFormat(entry.before.format)
  if (!srcFormat) {
    return unverifiable([
      `Recorded source format "${entry.before.format}" cannot be decoded here; this page decodes jpeg, png, webp, and avif.`,
    ])
  }

  let outImg: RawImage
  try {
    outImg = await decode(outFormat, output.bytes)
  } catch (err) {
    return unverifiable([`The output bytes failed to decode as ${outFormat}: ${describeError(err)}`])
  }
  let srcImg: RawImage
  try {
    srcImg = await decode(srcFormat, source.bytes)
  } catch (err) {
    return unverifiable([`The source bytes failed to decode as ${srcFormat}: ${describeError(err)}`])
  }

  const ref = deriveReference(srcImg, entry.reference)
  if (!ref) {
    return unverifiable([
      `The recorded reference is ${entry.reference.w}x${entry.reference.h} but the decoded source is only ${srcImg.width}x${srcImg.height}.`,
      'Refusing to fabricate pixels the source does not carry.',
    ])
  }
  const referenceHashMatch = (await hashRawImage(ref)) === entry.reference.hash

  if (outImg.width !== ref.width || outImg.height !== ref.height) {
    return {
      verdict: 'fail',
      notes: [
        `The output decodes to ${outImg.width}x${outImg.height}; the recorded reference is ${ref.width}x${ref.height}. This receipt does not describe these bytes.`,
      ],
      metrics: null,
      referenceHashMatch,
    }
  }

  const measuredSsim = ssim(ref, outImg)
  const measuredDeltaE = deltaE(ref, outImg).mean
  const measuredDistortion = distortion(measuredSsim, measuredDeltaE)
  const metrics: MetricComparison[] = [
    compare('ssim', recorded.ssim, measuredSsim, SSIM_TOLERANCE),
    compare('deltaE', recorded.deltaE, measuredDeltaE, DELTA_E_TOLERANCE),
    compare('distortion', recorded.distortion, measuredDistortion, DISTORTION_TOLERANCE),
  ]
  const allWithin = metrics.every((m) => m.withinTolerance)

  if (allWithin) {
    return {
      verdict: 'pass',
      metrics,
      referenceHashMatch,
      notes: referenceHashMatch
        ? ['The re-derived reference matches the recorded reference hash.']
        : [
            'The re-derived reference does not hash to the recorded reference (a resampler or orientation difference is the likely cause); the recorded numbers were still reproduced within tolerance.',
          ],
    }
  }
  if (!referenceHashMatch) {
    // An out-of-tolerance number is only evidence against the shipped file
    // when the reference it was measured against is provably the recorded
    // one. Refusing to guess which side is wrong is the honest verdict.
    return {
      verdict: 'unverifiable',
      metrics,
      referenceHashMatch,
      notes: [
        'The re-measured numbers disagree with the receipt, but the re-derived reference also fails to hash to the recorded reference, so the disagreement may come from reference derivation rather than from the shipped file.',
      ],
    }
  }
  return {
    verdict: 'fail',
    metrics,
    referenceHashMatch,
    notes: ['The re-measured numbers disagree with the receipt beyond the documented decoder tolerance.'],
  }
}
