import type { CandidatePoint } from './types.js'

/**
 * Lower convex hull of the (bytes, distortion) scatter, per BRIEF section
 * 3.2. Only points on this hull can ever be selected by any lambda, so the
 * interior is discarded before allocation. This is the same trick H.264 and
 * HEVC encoders use for mode decision.
 *
 * Guarantees on the returned array:
 * - sorted by bytes strictly ascending,
 * - distortion strictly decreasing (a point that costs more bytes without
 *   reducing distortion can never win for any lambda >= 0, given the
 *   allocator's fewer-bytes tie-break),
 * - slopes dDistortion / dBytes strictly increasing (collinear midpoints
 *   are dropped, keeping the hull minimal),
 * - duplicate byte sizes collapse to the lowest distortion point.
 *
 * The input may arrive in any order and is not mutated. The load-bearing
 * property, checked in the test suite: for every mu >= 0, the argmin of
 * distortion + mu * bytes over the hull has exactly the same (bytes,
 * distortion) as the argmin over the full input set, ties resolved toward
 * fewer bytes on both sides.
 */
export function lowerConvexHull(points: readonly CandidatePoint[]): CandidatePoint[] {
  for (const p of points) {
    if (!Number.isFinite(p.bytes) || p.bytes < 0) {
      throw new Error(`lowerConvexHull: bytes must be finite and non-negative, got ${p.bytes}`)
    }
    if (!Number.isFinite(p.distortion)) {
      throw new Error(`lowerConvexHull: distortion must be finite, got ${p.distortion}`)
    }
  }
  if (points.length === 0) return []

  // Bytes ascending; for equal bytes the lowest distortion first, so the
  // duplicate-bytes collapse below keeps the right point.
  const sorted = [...points].sort((a, b) => a.bytes - b.bytes || a.distortion - b.distortion)

  // Keep only points that strictly improve distortion over every cheaper
  // point. This collapses duplicate byte sizes (the sort put the best one
  // first) and drops non-improving points in one pass.
  const improving: CandidatePoint[] = []
  let bestSoFar = Number.POSITIVE_INFINITY
  for (const p of sorted) {
    if (p.distortion < bestSoFar) {
      improving.push(p)
      bestSoFar = p.distortion
    }
  }

  // Monotone chain over the strictly decreasing curve. A point is popped
  // when the incoming point makes it lie on or above the segment between
  // its neighbors (cross product <= 0 covers both interior and collinear).
  const hull: CandidatePoint[] = []
  for (const p of improving) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2] as CandidatePoint
      const a = hull[hull.length - 1] as CandidatePoint
      const cross =
        (a.bytes - o.bytes) * (p.distortion - o.distortion) -
        (a.distortion - o.distortion) * (p.bytes - o.bytes)
      if (cross <= 0) hull.pop()
      else break
    }
    hull.push(p)
  }
  return hull
}
