import { describe, expect, it } from 'vitest'
import type { AllocationImage, CandidatePoint } from '../../src/rd/types.js'
import { DEFAULT_FLOORS, allocate, applyFloor } from '../../src/rd/allocate.js'

function pt(
  bytes: number,
  distortion: number,
  ssim = 0.995,
  format: CandidatePoint['format'] = 'webp',
): CandidatePoint {
  return { format, quality: 75, bytes, ssim, deltaE: 0.2, distortion, encoder: 'test' }
}

function img(id: string, weight: number, points: CandidatePoint[]): AllocationImage {
  return { id, weight, hull: points }
}

describe('allocate: lambda mode', () => {
  it('at lambda 0 picks the minimum distortion point of every image', () => {
    const images = [
      img('a', 1, [pt(100, 0.9), pt(200, 0.5), pt(400, 0.1)]),
      img('b', 3, [pt(50, 0.7), pt(600, 0.2)]),
    ]
    const res = allocate(images, { lambda: 0 })
    expect(res.lambda).toBe(0)
    expect(res.choices.get('a')?.bytes).toBe(400)
    expect(res.choices.get('b')?.bytes).toBe(600)
  })

  it('at a huge lambda picks the minimum byte point of every image', () => {
    const images = [
      img('a', 1, [pt(100, 0.9), pt(200, 0.5), pt(400, 0.1)]),
      img('b', 3, [pt(50, 0.7), pt(600, 0.2)]),
    ]
    const res = allocate(images, { lambda: 1e9 })
    expect(res.choices.get('a')?.bytes).toBe(100)
    expect(res.choices.get('b')?.bytes).toBe(50)
  })

  it('selects the hull point where the marginal rate crosses lambda', () => {
    // Rates for this hull: (0.9 - 0.3) / 200 = 0.003, then
    // (0.3 - 0.1) / 400 = 0.0005. Lambda between the two rates buys the
    // first upgrade but not the second.
    const hull = [pt(100, 0.9), pt(300, 0.3), pt(700, 0.1)]
    expect(allocate([img('a', 1, hull)], { lambda: 0.01 }).choices.get('a')?.bytes).toBe(100)
    expect(allocate([img('a', 1, hull)], { lambda: 0.001 }).choices.get('a')?.bytes).toBe(300)
    expect(allocate([img('a', 1, hull)], { lambda: 0.0001 }).choices.get('a')?.bytes).toBe(700)
  })

  it('weight scales the crossing: heavier images hold quality longer', () => {
    const hull = [pt(100, 0.9), pt(300, 0.3), pt(700, 0.1)]
    // Weight 10 multiplies both rates by 10 (0.03 and 0.005), so the same
    // lambda that stripped the light image to 300 buys everything here.
    const res = allocate([img('heavy', 10, hull), img('light', 1, hull)], { lambda: 0.001 })
    expect(res.choices.get('heavy')?.bytes).toBe(700)
    expect(res.choices.get('light')?.bytes).toBe(300)
  })

  it('breaks the exact tie at the crossing toward fewer bytes', () => {
    // All values are exact in binary: rate = 0.25 / 128 = 2^-9, and the two
    // scores at lambda = 2^-9 are both exactly 0.75. The tie must go to the
    // smaller point, deterministically.
    const hull = [pt(128, 0.5), pt(256, 0.25)]
    const rate = (0.5 - 0.25) / (256 - 128)
    expect(rate).toBe(2 ** -9)
    expect(allocate([img('a', 1, hull)], { lambda: rate }).choices.get('a')?.bytes).toBe(128)
    expect(allocate([img('a', 1, hull)], { lambda: rate / 2 }).choices.get('a')?.bytes).toBe(256)
    expect(allocate([img('a', 1, hull)], { lambda: rate * 1.0001 }).choices.get('a')?.bytes).toBe(
      128,
    )
  })

  it('gives a zero weight image its minimum byte point at any lambda', () => {
    const hull = [pt(100, 0.9), pt(400, 0.1)]
    expect(allocate([img('a', 0, hull)], { lambda: 0 }).choices.get('a')?.bytes).toBe(100)
    expect(allocate([img('a', 0, hull)], { lambda: 1e-6 }).choices.get('a')?.bytes).toBe(100)
  })
})

describe('allocate: budget mode', () => {
  // Image a: one upgrade of 100 bytes at rate (0.5 - 0.25) / 100 = 0.0025.
  // Image b: one upgrade of 200 bytes at rate (0.5 - 0.125) / 200 = 0.001875.
  // Achievable totals: 200 (nothing), 300 (a upgraded), 500 (both).
  const rateA = (0.5 - 0.25) / (200 - 100)
  const rateB = (0.5 - 0.125) / (300 - 100)
  const images = (): AllocationImage[] => [
    img('a', 1, [pt(100, 0.5), pt(200, 0.25)]),
    img('b', 1, [pt(100, 0.5), pt(300, 0.125)]),
  ]

  it('resolves lambda 0 when the budget covers the best of everything', () => {
    const res = allocate(images(), { budgetBytes: 500 })
    expect(res.lambda).toBe(0)
    expect(res.totalBytes).toBe(500)
    expect(res.choices.get('a')?.bytes).toBe(200)
    expect(res.choices.get('b')?.bytes).toBe(300)
  })

  it('with equal weights and a generous budget matches per-image threshold mode', () => {
    // BRIEF section 13: the allocator must degenerate into picking each
    // image's minimum distortion point when the budget does not bind.
    const res = allocate(images(), { budgetBytes: 1e9 })
    const threshold = allocate(images(), { lambda: 0 })
    expect(res.choices).toEqual(threshold.choices)
  })

  it('steps down to the largest achievable total under the budget', () => {
    for (const budget of [499, 400, 300]) {
      const res = allocate(images(), { budgetBytes: budget })
      expect(res.lambda, `budget ${budget}`).toBe(rateB)
      expect(res.totalBytes, `budget ${budget}`).toBe(300)
      expect(res.choices.get('a')?.bytes).toBe(200)
      expect(res.choices.get('b')?.bytes).toBe(100)
    }
    for (const budget of [299, 200]) {
      const res = allocate(images(), { budgetBytes: budget })
      expect(res.lambda, `budget ${budget}`).toBe(rateA)
      expect(res.totalBytes, `budget ${budget}`).toBe(200)
    }
  })

  it('reports a lambda that reproduces the same allocation in lambda mode', () => {
    const byBudget = allocate(images(), { budgetBytes: 499 })
    const byLambda = allocate(images(), { lambda: byBudget.lambda })
    expect(byLambda.choices).toEqual(byBudget.choices)
    expect(byLambda.totalBytes).toBe(byBudget.totalBytes)
    expect(byLambda.totalDistortion).toBe(byBudget.totalDistortion)
  })

  it('returns the minimum byte allocation when even that exceeds the budget', () => {
    // Floors and keep-original points can make any budget infeasible. The
    // documented behavior is best effort: the minimum byte allocation, with
    // the smallest lambda that produces it, and totalBytes visibly over
    // budget so the caller can detect the overrun.
    const res = allocate(images(), { budgetBytes: 199 })
    expect(res.totalBytes).toBe(200)
    expect(res.totalBytes).toBeGreaterThan(199)
    expect(res.lambda).toBe(rateA)
    expect(res.choices.get('a')?.bytes).toBe(100)
    expect(res.choices.get('b')?.bytes).toBe(100)
  })

  it('totals are the sum of chosen bytes and weighted distortion', () => {
    const res = allocate(
      [
        img('a', 2, [pt(100, 0.5), pt(200, 0.25)]),
        img('b', 3, [pt(100, 0.5), pt(300, 0.125)]),
      ],
      { budgetBytes: 500 },
    )
    expect(res.totalBytes).toBe(200 + 300)
    expect(res.totalDistortion).toBe(2 * 0.25 + 3 * 0.125)
  })
})

describe('allocate: floors', () => {
  it('exposes the brief defaults, pending issue #7 recalibration', () => {
    expect(DEFAULT_FLOORS).toEqual({ globalMinSsim: 0.97, aboveFoldMinSsim: 0.99 })
  })

  it('filters candidates before hulling, never patching afterward', () => {
    // The low ssim point (100 bytes) dominates the unfiltered hull, hiding
    // the 400 byte point in its shadow. Filtering first must resurface the
    // 400 byte point; filtering the pre-built hull instead would leave only
    // keep-original. Selecting 400 proves the filter ran before the hull.
    const points = [
      pt(100, 0.12, 0.9),
      pt(400, 0.2, 0.98),
      pt(1000, 0, 1, 'keep-original'),
    ]
    const floors = { globalMinSsim: 0.97, aboveFoldMinSsim: 0.99 }
    const withFloors = allocate([img('a', 1, points)], { lambda: 0.001, floors })
    expect(withFloors.choices.get('a')?.bytes).toBe(400)
    const withoutFloors = allocate([img('a', 1, points)], { lambda: 0.001 })
    expect(withoutFloors.choices.get('a')?.bytes).toBe(100)
  })

  it('keeps points exactly at the floor', () => {
    const points = [pt(100, 0.1, 0.97), pt(1000, 0, 1, 'keep-original')]
    const res = allocate([img('a', 1, points)], {
      lambda: 1,
      floors: { globalMinSsim: 0.97, aboveFoldMinSsim: 0.99 },
    })
    expect(res.choices.get('a')?.bytes).toBe(100)
  })

  it('throws when the floor empties a hull, pointing at keep-original', () => {
    const points = [pt(100, 0.1, 0.9), pt(200, 0.05, 0.95)]
    expect(() =>
      allocate([img('a', 1, points)], {
        lambda: 0,
        floors: { globalMinSsim: 0.97, aboveFoldMinSsim: 0.99 },
      }),
    ).toThrow(/keep-original/)
  })

  it('a keep-original point at ssim 1 survives any legal floor', () => {
    const points = [pt(100, 0.1, 0.5), pt(1000, 0, 1, 'keep-original')]
    const res = allocate([img('a', 1, points)], {
      lambda: 0,
      floors: { globalMinSsim: 1, aboveFoldMinSsim: 1 },
    })
    expect(res.choices.get('a')?.bytes).toBe(1000)
  })
})

describe('applyFloor', () => {
  it('drops points strictly below the floor and keeps the rest', () => {
    const points = [pt(100, 0.1, 0.9), pt(200, 0.05, 0.97), pt(300, 0.01, 0.99)]
    const kept = applyFloor(points, 0.97)
    expect(kept.map((p) => p.bytes)).toEqual([200, 300])
  })

  it('rejects floors outside [0, 1] and non-finite point ssim', () => {
    expect(() => applyFloor([pt(100, 0.1)], 1.1)).toThrow(/floor/i)
    expect(() => applyFloor([pt(100, 0.1)], -0.1)).toThrow(/floor/i)
    expect(() => applyFloor([pt(100, 0.1, Number.NaN)], 0.9)).toThrow(/ssim/i)
  })
})

describe('allocate: input validation and determinism', () => {
  it('requires exactly one of budgetBytes and lambda', () => {
    const images = [img('a', 1, [pt(100, 0.5)])]
    expect(() => allocate(images, {})).toThrow(/exactly one/i)
    expect(() => allocate(images, { budgetBytes: 100, lambda: 1e-6 })).toThrow(/exactly one/i)
  })

  it('rejects invalid lambda, budget, and weight values', () => {
    const images = [img('a', 1, [pt(100, 0.5)])]
    expect(() => allocate(images, { lambda: -1 })).toThrow(/lambda/i)
    expect(() => allocate(images, { lambda: Number.NaN })).toThrow(/lambda/i)
    expect(() => allocate(images, { budgetBytes: -5 })).toThrow(/budget/i)
    expect(() => allocate(images, { budgetBytes: Number.NaN })).toThrow(/budget/i)
    expect(() => allocate([img('a', -1, [pt(100, 0.5)])], { lambda: 0 })).toThrow(/weight/i)
    expect(() => allocate([img('a', Number.NaN, [pt(100, 0.5)])], { lambda: 0 })).toThrow(
      /weight/i,
    )
  })

  it('rejects duplicate image ids', () => {
    const images = [img('a', 1, [pt(100, 0.5)]), img('a', 1, [pt(200, 0.4)])]
    expect(() => allocate(images, { lambda: 0 })).toThrow(/duplicate/i)
  })

  it('rejects an image with no candidates at all', () => {
    expect(() => allocate([img('a', 1, [])], { lambda: 0 })).toThrow(/no candidate/i)
  })

  it('handles an empty image list', () => {
    const byLambda = allocate([], { lambda: 1e-6 })
    expect(byLambda.totalBytes).toBe(0)
    expect(byLambda.totalDistortion).toBe(0)
    expect(byLambda.choices.size).toBe(0)
    const byBudget = allocate([], { budgetBytes: 100 })
    expect(byBudget.lambda).toBe(0)
  })

  it('accepts an unsorted, unpruned candidate list in the hull field', () => {
    // allocate re-derives the lower convex hull internally, so callers may
    // hand it the full sweep output directly.
    const scrambled = [pt(400, 0.1), pt(100, 0.9), pt(200, 0.5), pt(150, 0.95)]
    const res = allocate([img('a', 1, scrambled)], { lambda: 0 })
    expect(res.choices.get('a')?.bytes).toBe(400)
  })

  it('is deterministic and preserves input order in the choices map', () => {
    const images = (): AllocationImage[] => [
      img('zeta', 1, [pt(100, 0.5), pt(200, 0.25)]),
      img('alpha', 2, [pt(50, 0.7), pt(600, 0.2)]),
    ]
    const first = allocate(images(), { budgetBytes: 700 })
    const second = allocate(images(), { budgetBytes: 700 })
    expect([...first.choices.keys()]).toEqual(['zeta', 'alpha'])
    expect(second).toEqual(first)
  })
})
