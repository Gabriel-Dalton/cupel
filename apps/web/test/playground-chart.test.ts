import { describe, expect, it } from 'vitest'
import { buildChartGeometry, niceTicks, type ChartInputPoint } from '../lib/playground/chart'

/**
 * The hand-rolled SVG chart is a pure geometry function: candidate points in,
 * pixel positions, hull path, and labelled axis ticks out. The React layer
 * only draws what this module computes, so the math is provable here.
 */

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

function point(key: string, bytes: number, distortion: number, onHull = false): ChartInputPoint {
  return { key, bytes, distortion, onHull }
}

describe('niceTicks', () => {
  it('spans zero to a round ceiling at or above the maximum', () => {
    expect(niceTicks(97)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000])
  })

  it('produces exact decimal ticks for small ranges', () => {
    expect(niceTicks(0.043)).toEqual([0, 0.01, 0.02, 0.03, 0.04, 0.05])
  })

  it('degenerates to [0, 1] for a zero or negative maximum', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(-3)).toEqual([0, 1])
  })

  it('holds its invariants across random magnitudes', () => {
    const rng = mulberry32(0x7ea5)
    for (let i = 0; i < 200; i++) {
      const max = Math.pow(10, rng() * 12 - 4) * (0.5 + rng())
      const ticks = niceTicks(max)
      expect(ticks[0], `max=${max}`).toBe(0)
      expect(ticks[ticks.length - 1], `max=${max}`).toBeGreaterThanOrEqual(max)
      expect(ticks.length, `max=${max}`).toBeGreaterThanOrEqual(3)
      expect(ticks.length, `max=${max}`).toBeLessThanOrEqual(9)
      for (let t = 1; t < ticks.length; t++) {
        expect(ticks[t], `max=${max}`).toBeGreaterThan(ticks[t - 1] ?? Number.POSITIVE_INFINITY)
      }
    }
  })
})

describe('buildChartGeometry', () => {
  const sample = [
    point('a', 10_000, 0.08, true),
    point('b', 25_000, 0.05),
    point('c', 40_000, 0.02, true),
    point('d', 90_000, 0.004, true),
    point('e', 120_000, 0.003),
  ]

  it('maps bytes rightward and distortion upward (smaller y for more distortion)', () => {
    const geo = buildChartGeometry(sample)
    const byKey = new Map(geo.points.map((p) => [p.key, p]))
    const a = byKey.get('a')
    const d = byKey.get('d')
    expect(a).toBeDefined()
    expect(d).toBeDefined()
    if (!a || !d) return
    expect(d.x).toBeGreaterThan(a.x)
    // More distortion sits higher on the chart, which is a smaller SVG y.
    expect(a.y).toBeLessThan(d.y)
  })

  it('keeps every point inside the plot rectangle', () => {
    const geo = buildChartGeometry(sample)
    for (const p of geo.points) {
      expect(p.x).toBeGreaterThanOrEqual(geo.plot.left)
      expect(p.x).toBeLessThanOrEqual(geo.plot.right)
      expect(p.y).toBeGreaterThanOrEqual(geo.plot.top)
      expect(p.y).toBeLessThanOrEqual(geo.plot.bottom)
    }
  })

  it('threads the hull path through the hull points only, in byte order', () => {
    const geo = buildChartGeometry(sample)
    expect(geo.hullPath.startsWith('M')).toBe(true)
    // Three hull points: one M and two L segments.
    expect(geo.hullPath.match(/L/g)).toHaveLength(2)
  })

  it('emits no hull path with fewer than two hull points', () => {
    const geo = buildChartGeometry([point('a', 10, 0.5, true), point('b', 20, 0.4)])
    expect(geo.hullPath).toBe('')
  })

  it('labels x ticks in bytes with units', () => {
    const geo = buildChartGeometry(sample)
    expect(geo.xTicks.length).toBeGreaterThanOrEqual(3)
    for (const tick of geo.xTicks) {
      expect(tick.label).toMatch(/ (B|kB|MB|GB)$/)
      expect(tick.pos).toBeGreaterThanOrEqual(geo.plot.left)
      expect(tick.pos).toBeLessThanOrEqual(geo.plot.right)
    }
  })

  it('keeps y tick positions inside the plot and labels them tersely', () => {
    const geo = buildChartGeometry(sample)
    for (const tick of geo.yTicks) {
      expect(tick.pos).toBeGreaterThanOrEqual(geo.plot.top)
      expect(tick.pos).toBeLessThanOrEqual(geo.plot.bottom)
      expect(tick.label).not.toMatch(/0000000/)
    }
  })

  it('survives a single point with zero distortion without NaN anywhere', () => {
    const geo = buildChartGeometry([point('only', 50_000, 0, true)])
    for (const p of geo.points) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    for (const t of [...geo.xTicks, ...geo.yTicks]) {
      expect(Number.isFinite(t.pos)).toBe(true)
    }
  })

  it('handles the empty sweep start state', () => {
    const geo = buildChartGeometry([])
    expect(geo.points).toEqual([])
    expect(geo.hullPath).toBe('')
    expect(geo.xTicks.length).toBeGreaterThan(0)
  })
})
