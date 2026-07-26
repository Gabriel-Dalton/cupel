import { distortion, lowerConvexHull } from '@cupel/core'
import type { CandidatePoint, OutputFormat } from '@cupel/core'

/**
 * Curve assembly: measured encodes in, CandidatePoints and the surviving
 * frontier out. The hull comes from @cupel/core's lowerConvexHull, the same
 * code the CLI will run, which is the whole point of the playground: the
 * numbers on screen are computed by the shipped library.
 */

export type MeasuredEncode = {
  format: OutputFormat
  quality: number | null
  bytes: number
  ssim: number
  /** Mean CIE76 deltaE against the reference. */
  deltaE: number
  encoder: string
}

/** Builds a CandidatePoint, deriving distortion with the core formula. */
export function toCandidatePoint(m: MeasuredEncode): CandidatePoint {
  return {
    format: m.format,
    quality: m.quality,
    bytes: m.bytes,
    ssim: m.ssim,
    deltaE: m.deltaE,
    distortion: distortion(m.ssim, m.deltaE),
    encoder: m.encoder,
  }
}

/**
 * Stable identity for a point on this sweep's curve. Each format contributes
 * at most one null-quality point (its lossless encode, or the kept source),
 * so format plus quality is unique across the plan.
 */
export function pointKey(p: Pick<CandidatePoint, 'format' | 'quality'>): string {
  return `${p.format}:${p.quality === null ? 'lossless' : `q${p.quality}`}`
}

export type AssembledCurve = {
  /** Lower convex hull, bytes ascending, straight from @cupel/core. */
  hull: CandidatePoint[]
  /** pointKey of every hull member, for O(1) membership checks in the UI. */
  hullKeys: ReadonlySet<string>
}

/** Prunes the scatter to the frontier that any budget could ever select. */
export function assembleCurve(points: readonly CandidatePoint[]): AssembledCurve {
  const hull = lowerConvexHull(points)
  return { hull, hullKeys: new Set(hull.map(pointKey)) }
}

/**
 * The default selection: the knee of the frontier, the point of diminishing
 * returns. Both axes are normalized to [0, 1] first (bytes and distortion
 * live on wildly different scales), then the hull point farthest from the
 * chord between the frontier's endpoints wins. Ties, straight-line hulls,
 * and two-point hulls resolve toward lower distortion: when the curve gives
 * no reason to spend less, safeguard fidelity.
 */
export function kneePoint(hull: readonly CandidatePoint[]): CandidatePoint | null {
  const first = hull[0]
  const last = hull[hull.length - 1]
  if (!first) return null
  if (hull.length === 1) return first
  if (!last) return null

  const byteSpan = last.bytes - first.bytes || 1
  const distortionSpan = first.distortion - last.distortion || 1

  // Chord endpoints in normalized space: (0, 1) and (1, 0) by construction
  // (the hull is bytes ascending, distortion descending). Distance from the
  // chord x + y = 1 is |x + y - 1| / sqrt(2); the constant factor cannot
  // change the argmax, so it is dropped. Distances within EPSILON count as
  // ties so IEEE754 dust on a collinear hull cannot pick a corner that is
  // not there; on a tie the later point wins, and later means lower
  // distortion.
  const EPSILON = 1e-9
  let best: CandidatePoint = last
  let bestDistance = 0
  for (const p of hull) {
    const x = (p.bytes - first.bytes) / byteSpan
    const y = (p.distortion - last.distortion) / distortionSpan
    const d = Math.abs(x + y - 1)
    if (d >= bestDistance - EPSILON) {
      best = p
      bestDistance = Math.max(bestDistance, d)
    }
  }
  return best
}

/**
 * Fraction of the original file's bytes a candidate saves. Negative when the
 * candidate is larger. Null when the original size is unknown, so the UI
 * shows nothing rather than a made-up number.
 */
export function fractionSaved(bytes: number, originalBytes: number): number | null {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return null
  return 1 - bytes / originalBytes
}
