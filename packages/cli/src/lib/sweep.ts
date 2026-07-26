import { deltaE, distortion, ssim } from '@cupel/core'
import type { CandidatePoint, Container, RawImage } from '@cupel/core'
import { sharpCodec } from '@cupel/codecs-node'
import type { CodecFormat } from '@cupel/codecs-node'

/**
 * The per-image sweep from BRIEF section 3.1: every allowed format at every
 * rung of the quality ladder, each encode measured against the reference,
 * producing the curve that allocation and the no-op guard both need. Hull
 * pruning happens later in core; this module's only job is honest measured
 * points.
 *
 * Each encode's bytes are retained alongside its measurement so the writer
 * can write exactly the buffer that was measured, without a second encode.
 */

/** BRIEF 3.1: q40 to q95 in steps of 5. Matches the playground's ladder. */
export const QUALITY_LADDER: readonly number[] = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]

/**
 * Formats swept by default. png is included as a lossless option because a
 * laundered PNG of a photo is often beaten badly by anything else, and the
 * comparison is what makes that visible.
 */
export const SWEEP_FORMATS: readonly CodecFormat[] = ['jpeg', 'webp', 'avif', 'png']

export type SweepOptions = {
  formats?: readonly CodecFormat[]
  ladder?: readonly number[]
  /** Skips the (slow) avif rungs. */
  fast?: boolean
}

/** A measured point plus the exact bytes that produced it. */
export type MeasuredCandidate = {
  point: CandidatePoint
  /** null for the keep-original anchor, whose bytes are already on disk. */
  bytes: Uint8Array | null
}

export function candidateKey(point: CandidatePoint): string {
  return `${point.format}@${point.quality ?? 'lossless'}`
}

/**
 * Measures one candidate: encode, decode what was encoded, and compare the
 * decoded result against the reference. Measuring the decoded bytes rather
 * than the pre-encode pixels is the whole point; it is what the metrics in
 * the ledger mean, and it is what `verify` reproduces later without
 * re-encoding anything.
 */
async function measurePoint(
  reference: RawImage,
  format: CodecFormat,
  quality: number | null,
): Promise<MeasuredCandidate | null> {
  const codec = sharpCodec(format)
  try {
    const encoded = await codec.encode(reference, quality === null ? {} : { quality })
    const decoded = await codec.decode(encoded)
    if (decoded.width !== reference.width || decoded.height !== reference.height) return null
    const s = ssim(reference, decoded)
    const e = deltaE(reference, decoded).mean
    return {
      point: {
        format,
        quality,
        bytes: encoded.length,
        ssim: s,
        deltaE: e,
        distortion: distortion(s, e),
        encoder: codec.id,
      },
      bytes: encoded,
    }
  } catch {
    // A format that cannot carry this image (or is missing from this sharp
    // build) drops out of the sweep. Not an error: the remaining formats
    // still produce a curve.
    return null
  }
}

/**
 * The keep-original anchor. ssim 1 and distortion 0 by definition, since the
 * original is being compared with itself, and its real byte count. The
 * decision engine needs this point to state savings and to run the no-op
 * guard, so a sweep without it can only ever say "encode something".
 */
export function keepOriginalPoint(container: Container, originalBytes: number): CandidatePoint {
  return {
    format: 'keep-original',
    quality: null,
    bytes: originalBytes,
    ssim: 1,
    deltaE: 0,
    distortion: 0,
    encoder: `original ${container} bytes`,
  }
}

export async function sweepMeasured(
  reference: RawImage,
  container: Container,
  originalBytes: number,
  opts: SweepOptions = {},
): Promise<MeasuredCandidate[]> {
  const requested = opts.formats ?? SWEEP_FORMATS
  const formats = opts.fast ? requested.filter((f) => f !== 'avif') : requested
  const ladder = opts.ladder ?? QUALITY_LADDER
  const measured: MeasuredCandidate[] = [
    { point: keepOriginalPoint(container, originalBytes), bytes: null },
  ]

  for (const format of formats) {
    // png ignores the quality knob entirely, so it contributes exactly one
    // point rather than twelve identical ones.
    const rungs = format === 'png' ? [null] : ladder
    for (const quality of rungs) {
      const point = await measurePoint(reference, format, quality)
      if (point) measured.push(point)
    }
  }
  return measured
}

/** Points only, for callers that do not need the buffers. */
export async function sweep(
  reference: RawImage,
  container: Container,
  originalBytes: number,
  opts: SweepOptions = {},
): Promise<CandidatePoint[]> {
  return (await sweepMeasured(reference, container, originalBytes, opts)).map((m) => m.point)
}
