import { describe, expect, it } from 'vitest'
import type { CandidatePoint } from '../../src/rd/types.js'
import { lowerConvexHull } from '../../src/rd/hull.js'

/** Minimal candidate factory. ssim and deltaE are irrelevant to the hull. */
function pt(bytes: number, distortion: number, quality: number | null = 75): CandidatePoint {
  return { format: 'webp', quality, bytes, ssim: 0.99, deltaE: 0.5, distortion, encoder: 'test' }
}

/** Small, fast, seeded PRNG. Deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('lowerConvexHull', () => {
  it('keeps a strictly convex decreasing curve intact, sorted by bytes ascending', () => {
    const points = [pt(100, 0.9), pt(200, 0.5), pt(400, 0.3), pt(800, 0.2)]
    // Slopes: -0.004, -0.002, -0.00025: strictly increasing, all on the hull.
    const hull = lowerConvexHull([...points].reverse())
    expect(hull.map((p) => p.bytes)).toEqual([100, 200, 400, 800])
  })

  it('drops interior points that fail the slope test', () => {
    // (200, 0.8) lies above the segment from (100, 0.9) to (400, 0.3):
    // interpolated value there is 0.7. It can never win for any lambda.
    const hull = lowerConvexHull([pt(100, 0.9), pt(200, 0.8), pt(400, 0.3)])
    expect(hull.map((p) => p.bytes)).toEqual([100, 400])
  })

  it('drops collinear midpoints, keeping the hull minimal', () => {
    const hull = lowerConvexHull([pt(100, 0.9), pt(200, 0.6), pt(300, 0.3)])
    expect(hull.map((p) => p.bytes)).toEqual([100, 300])
  })

  it('returns a single point unchanged', () => {
    const only = pt(500, 0.1)
    const hull = lowerConvexHull([only])
    expect(hull).toEqual([only])
  })

  it('returns an empty array for empty input', () => {
    expect(lowerConvexHull([])).toEqual([])
  })

  it('collapses duplicate byte sizes to the lowest distortion', () => {
    const hull = lowerConvexHull([pt(100, 0.9), pt(100, 0.4), pt(100, 0.7)])
    expect(hull).toHaveLength(1)
    expect(hull[0]?.bytes).toBe(100)
    expect(hull[0]?.distortion).toBe(0.4)
  })

  it('drops non-improving points (more bytes, equal or worse distortion)', () => {
    // (300, 0.5) costs more than (200, 0.5) and buys nothing; (400, 0.6) is
    // strictly worse than (200, 0.5). Neither can win for any lambda >= 0.
    const hull = lowerConvexHull([pt(100, 0.9), pt(200, 0.5), pt(300, 0.5), pt(400, 0.6)])
    expect(hull.map((p) => p.bytes)).toEqual([100, 200])
  })

  it('collapses fully duplicate points to one', () => {
    const hull = lowerConvexHull([pt(100, 0.5), pt(100, 0.5), pt(100, 0.5)])
    expect(hull).toHaveLength(1)
  })

  it('is independent of input order and does not mutate its input', () => {
    const points = [pt(800, 0.2), pt(100, 0.9), pt(400, 0.3), pt(200, 0.8), pt(200, 0.5)]
    const frozen = points.map((p) => ({ ...p }))
    const sortedFirst = lowerConvexHull([...points].sort((a, b) => a.bytes - b.bytes))
    const asGiven = lowerConvexHull(points)
    expect(asGiven).toEqual(sortedFirst)
    expect(points).toEqual(frozen)
  })

  it('rejects non-finite or negative bytes and non-finite distortion', () => {
    expect(() => lowerConvexHull([pt(Number.NaN, 0.5)])).toThrow(/bytes/i)
    expect(() => lowerConvexHull([pt(-10, 0.5)])).toThrow(/bytes/i)
    expect(() => lowerConvexHull([pt(100, Number.POSITIVE_INFINITY)])).toThrow(/distortion/i)
  })

  it('property: pruning never changes the argmin of d + mu * bytes for any mu >= 0', () => {
    // The reason the hull is safe to use at all: for every non-negative
    // slope multiplier, the best point of the full set and the best point of
    // the hull have identical (bytes, distortion). Ties resolve to fewer
    // bytes on both sides.
    const rand = mulberry32(20260725)
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rand() * 10)
      const points: CandidatePoint[] = []
      for (let i = 0; i < n; i++) {
        const bytes = 100 + Math.floor(rand() * 10000)
        points.push(pt(bytes, rand()))
      }
      const hull = lowerConvexHull(points)
      const mus = [0, 1e-6, 1e-4, 1e-2, rand() * 1e-3, 1e6]
      for (const mu of mus) {
        const best = (set: readonly CandidatePoint[]): CandidatePoint => {
          let chosen = set[0] as CandidatePoint
          for (const p of set) {
            const score = p.distortion + mu * p.bytes
            const chosenScore = chosen.distortion + mu * chosen.bytes
            if (score < chosenScore || (score === chosenScore && p.bytes < chosen.bytes)) {
              chosen = p
            }
          }
          return chosen
        }
        const fromAll = best(points)
        const fromHull = best(hull)
        expect(fromHull.bytes, `trial ${trial}, mu ${mu}: bytes`).toBe(fromAll.bytes)
        expect(fromHull.distortion, `trial ${trial}, mu ${mu}: distortion`).toBe(
          fromAll.distortion,
        )
      }
    }
  })
})
