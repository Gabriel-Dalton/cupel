import { describe, expect, it } from 'vitest'
import { distortion, lowerConvexHull } from '@cupel/core'
import type { CandidatePoint } from '@cupel/core'
import { wasmCodec } from '@cupel/codecs-wasm'
import {
  assembleCurve,
  fractionSaved,
  kneePoint,
  pointKey,
  toCandidatePoint,
} from '../lib/playground/assemble'
import {
  SWEEP_FORMATS,
  buildSweepPlan,
  type FormatCapabilities,
  type SweepFormat,
} from '../lib/playground/plan'

/**
 * Curve assembly: turning measured encodes into CandidatePoints, pruning to
 * the lower convex hull with the same @cupel/core code the CLI will use, and
 * picking a default selection at the knee of the frontier.
 */

function pt(bytes: number, d: number, quality: number | null = 75): CandidatePoint {
  return { format: 'webp', quality, bytes, ssim: 0.99, deltaE: 0.5, distortion: d, encoder: 't' }
}

describe('toCandidatePoint', () => {
  it('derives distortion with the core formula and copies every field', () => {
    const p = toCandidatePoint({
      format: 'avif',
      quality: 62,
      bytes: 41208,
      ssim: 0.9931,
      deltaE: 0.71,
      encoder: 'jsquash-avif@2.1.1',
    })
    expect(p.distortion).toBe(distortion(0.9931, 0.71))
    expect(p.format).toBe('avif')
    expect(p.quality).toBe(62)
    expect(p.bytes).toBe(41208)
    expect(p.ssim).toBe(0.9931)
    expect(p.deltaE).toBe(0.71)
    expect(p.encoder).toBe('jsquash-avif@2.1.1')
  })

  it('a perfect roundtrip yields exactly zero distortion', () => {
    const p = toCandidatePoint({
      format: 'png',
      quality: null,
      bytes: 1000,
      ssim: 1,
      deltaE: 0,
      encoder: 'jsquash-png@3.1.1',
    })
    expect(p.distortion).toBe(0)
  })
})

describe('pointKey', () => {
  it('is unique across the whole sweep plan plus the keep-original anchor', () => {
    const caps = {} as Record<SweepFormat, FormatCapabilities>
    for (const format of SWEEP_FORMATS) caps[format] = wasmCodec(format).capabilities
    const plan = buildSweepPlan(caps)
    const keys = plan.map((s) => pointKey({ format: s.format, quality: s.quality }))
    keys.push(pointKey({ format: 'keep-original', quality: null }))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('distinguishes lossless from lossy at the same format', () => {
    expect(pointKey({ format: 'webp', quality: null })).not.toBe(
      pointKey({ format: 'webp', quality: 75 }),
    )
  })
})

describe('assembleCurve', () => {
  it('prunes with @cupel/core lowerConvexHull, not a local variant', () => {
    const points = [pt(100, 0.9), pt(200, 0.8), pt(400, 0.3), pt(800, 0.2), pt(300, 0.85)]
    const { hull } = assembleCurve(points)
    expect(hull).toEqual(lowerConvexHull(points))
  })

  it('reports hull membership as a key set covering exactly the hull', () => {
    const points = [pt(100, 0.9, 40), pt(200, 0.8, 50), pt(400, 0.3, 60), pt(800, 0.2, 70)]
    const { hull, hullKeys } = assembleCurve(points)
    expect(hullKeys.size).toBe(hull.length)
    for (const p of hull) expect(hullKeys.has(pointKey(p))).toBe(true)
    // (200, 0.8) is interior: above the segment from (100, 0.9) to (400, 0.3).
    expect(hullKeys.has(pointKey({ format: 'webp', quality: 50 }))).toBe(false)
  })

  it('handles the empty and single point cases', () => {
    expect(assembleCurve([]).hull).toEqual([])
    const only = pt(500, 0.1)
    expect(assembleCurve([only]).hull).toEqual([only])
  })
})

describe('kneePoint', () => {
  it('finds the corner of an L-shaped frontier', () => {
    // After normalizing both axes to [0, 1], the middle point sits far off
    // the chord between the endpoints: it is the point of diminishing
    // returns, and the sweep's default selection.
    const hull = [pt(0, 1, 40), pt(10, 0.1, 60), pt(100, 0, 95)]
    expect(kneePoint(hull)?.quality).toBe(60)
  })

  it('prefers the lower-distortion end when the frontier is a straight line', () => {
    const hull = [pt(100, 0.9, 40), pt(200, 0.6, 60), pt(300, 0.3, 80)]
    expect(kneePoint(hull)?.quality).toBe(80)
  })

  it('degenerates safely: empty is null, one point is itself, two points pick lower distortion', () => {
    expect(kneePoint([])).toBeNull()
    const only = pt(500, 0.1)
    expect(kneePoint([only])).toBe(only)
    const two = [pt(100, 0.9, 40), pt(400, 0.2, 90)]
    expect(kneePoint(two)?.quality).toBe(90)
  })
})

describe('fractionSaved', () => {
  it('reports the byte fraction saved against the original', () => {
    expect(fractionSaved(25_000, 100_000)).toBe(0.75)
  })

  it('goes negative when the candidate is larger than the original', () => {
    expect(fractionSaved(120_000, 100_000)).toBeCloseTo(-0.2, 12)
  })

  it('returns null when the original size is unknown or zero', () => {
    expect(fractionSaved(100, 0)).toBeNull()
    expect(fractionSaved(100, -5)).toBeNull()
  })
})
