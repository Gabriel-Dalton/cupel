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

// ---------------------------------------------------------------------------
// Brute force equivalence. Small seeded random instances (5 images x 6
// candidates) are solved twice: by allocate (hulls, breakpoint bisection) and
// by exhaustive search that never prunes anything. Every quantity lands on an
// exact binary grid (bytes: integers, distortion: multiples of 1/64, weight:
// multiples of 1/8), so distortion sums and byte totals are exact IEEE754
// doubles and every assertion below is exact equality, no tolerances.
//
// Semantics note, load-bearing: budget mode is Lagrangian step-down (see the
// budget-mode suite above: at budget 400 the expected answer is the 300 byte
// allocation, not the 400 byte combination with lower distortion). A uniform
// lambda cannot land inside the integrality gap, so the honest brute force
// checks are (a) per-image selection must match exhaustive argmin over ALL
// unpruned candidates at the resolved lambda, (b) the full budget-mode result
// must match a hull-free reference that sweeps every pairwise rate, and
// (c) the achieved allocation must be knapsack-optimal over ALL unpruned
// candidate combinations within its own byte total, which is the exact
// optimality guarantee Lagrangian allocation provides.
// ---------------------------------------------------------------------------

describe('allocate: brute force equivalence on seeded random instances', () => {
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

  const IMAGES = 5
  const CANDIDATES = 6

  function randomInstance(seed: number): AllocationImage[] {
    const rand = mulberry32(seed)
    const images: AllocationImage[] = []
    for (let i = 0; i < IMAGES; i++) {
      const candidates: CandidatePoint[] = []
      for (let c = 0; c < CANDIDATES; c++) {
        // Bytes are multiples of 25 so duplicates and shared totals occur;
        // distortion sits on the 1/64 grid so exact ties occur.
        candidates.push(pt(25 * (1 + Math.floor(rand() * 40)), Math.floor(rand() * 64) / 64))
      }
      // Occasionally a zero weight image; otherwise 1/8 .. 23/8.
      const weight = i === 0 && rand() < 0.25 ? 0 : Math.floor(1 + rand() * 23) / 8
      images.push(img(`img${i}`, weight, candidates))
    }
    return images
  }

  /**
   * Exhaustive per-image argmin over ALL unpruned candidates, scanning bytes
   * ascending (then distortion ascending) with a strictly-smaller test, so
   * ties resolve toward fewer bytes exactly like the allocator documents.
   *
   * Floating point caveat: within a rounding error of a true crossing, these
   * computed scores resolve unpredictably, so this reference is only used at
   * SAFE lambdas: 0 (scores are exact on this suite's value grid) and points
   * far from every crossing relative to double precision. The behavior
   * exactly at the crossings is pinned separately by the right-continuity
   * check below plus the committed exact-tie test above.
   */
  function refChoice(image: AllocationImage, lambda: number): CandidatePoint {
    const sorted = [...image.hull].sort((a, b) => a.bytes - b.bytes || a.distortion - b.distortion)
    let chosen = sorted[0] as CandidatePoint
    let chosenScore = image.weight * chosen.distortion + lambda * chosen.bytes
    for (const p of sorted) {
      const score = image.weight * p.distortion + lambda * p.bytes
      if (score < chosenScore) {
        chosen = p
        chosenScore = score
      }
    }
    return chosen
  }

  type RefResult = {
    lambda: number
    choices: CandidatePoint[]
    totalBytes: number
    totalDistortion: number
  }

  function refEvaluate(images: readonly AllocationImage[], lambda: number): RefResult {
    const choices = images.map((image) => refChoice(image, lambda))
    let totalBytes = 0
    let totalDistortion = 0
    for (let i = 0; i < images.length; i++) {
      const chosen = choices[i] as CandidatePoint
      totalBytes += chosen.bytes
      totalDistortion += (images[i] as AllocationImage).weight * chosen.distortion
    }
    return { lambda, choices, totalBytes, totalDistortion }
  }

  /**
   * Every lambda at which any image's exhaustive argmin can change: the
   * pairwise weighted rates of ALL candidate pairs, no hull involved. The
   * expression shape matches what a caller would derive from two points, so
   * matching lambdas compare bit-identically.
   */
  function refRates(images: readonly AllocationImage[]): number[] {
    const set = new Set<number>()
    for (const image of images) {
      for (const low of image.hull) {
        for (const high of image.hull) {
          if (high.bytes > low.bytes && low.distortion > high.distortion) {
            set.add((image.weight * (low.distortion - high.distortion)) / (high.bytes - low.bytes))
          }
        }
      }
    }
    return [...set].filter((r) => r > 0).sort((a, b) => b - a)
  }

  /**
   * A safe evaluation lambda strictly inside candidate rates[k]'s constancy
   * interval [rates[k], rates[k - 1]): the allocation is constant there and
   * the point sits far from every crossing, so refChoice is exact at it.
   */
  function safeAbove(rates: readonly number[], k: number): number {
    const rate = rates[k] as number
    return k === 0 ? rate * 2 + 1 : rate + ((rates[k - 1] as number) - rate) / 2
  }

  /**
   * Every candidate lambda with the allocation it produces, descending, with
   * lambda 0 last. The allocation AT a candidate equals the allocation on
   * the interval just above it (the fewer-bytes tie: the crossing upgrade is
   * not bought), so each is evaluated at safeAbove rather than at itself.
   */
  function refCandidates(images: readonly AllocationImage[]): RefResult[] {
    const rates = refRates(images)
    const candidates = rates.map((rate, k) => ({
      ...refEvaluate(images, safeAbove(rates, k)),
      lambda: rate,
    }))
    candidates.push(refEvaluate(images, 0))
    return candidates
  }

  /**
   * Hull-free reference: the smallest sweep lambda whose total fits the
   * budget. When even the minimum byte total overruns, the documented best
   * effort is that minimum allocation with the smallest lambda producing it
   * (rates above the steepest segment yield the same bytes but are not
   * minimal, so the scan keeps the last, smallest, rate at minimum bytes).
   */
  function refAllocate(images: readonly AllocationImage[], budget: number): RefResult {
    const candidates = refCandidates(images)
    let best: RefResult | undefined
    for (const candidate of candidates) {
      if (candidate.totalBytes <= budget) best = candidate
    }
    if (best) return best
    const minBytes = (candidates[0] as RefResult).totalBytes
    let fallback = candidates[0] as RefResult
    for (const candidate of candidates) {
      if (candidate.totalBytes === minBytes) fallback = candidate
    }
    return fallback
  }

  /** (totalBytes, totalDistortion) of every unpruned candidate combination. */
  function allCombinations(
    images: readonly AllocationImage[],
  ): { totalBytes: number; totalDistortion: number }[] {
    let combos = [{ totalBytes: 0, totalDistortion: 0 }]
    for (const image of images) {
      const next: { totalBytes: number; totalDistortion: number }[] = []
      for (const partial of combos) {
        for (const p of image.hull) {
          next.push({
            totalBytes: partial.totalBytes + p.bytes,
            totalDistortion: partial.totalDistortion + image.weight * p.distortion,
          })
        }
      }
      combos = next
    }
    return combos
  }

  function sampleBudgets(images: readonly AllocationImage[], rand: () => number): number[] {
    // 1e12 dwarfs every weighted distortion here, so this is the minimum
    // byte allocation without risking Infinity scores.
    const minTotal = refEvaluate(images, 1e12).totalBytes
    const maxTotal = refEvaluate(images, 0).totalBytes
    const budgets = [minTotal - 1, minTotal, maxTotal, maxTotal + 123, 1e9]
    for (const candidate of refCandidates(images)) {
      budgets.push(candidate.totalBytes, candidate.totalBytes - 1, candidate.totalBytes + 1)
    }
    for (let i = 0; i < 3; i++) {
      budgets.push(minTotal + Math.floor(rand() * (maxTotal - minTotal + 1)))
    }
    return [...new Set(budgets)].filter((b) => b >= 0)
  }

  it('lambda mode matches exhaustive argmin over all unpruned candidates', () => {
    const rand = mulberry32(0x5eed_0001)
    for (let trial = 0; trial < 12; trial++) {
      const images = randomInstance(1000 + trial)
      const rates = refRates(images)
      // Sweep 0, a safe point inside every constancy interval, and a few
      // arbitrary lambdas.
      const lambdas = [0, rand() * 0.02, rand() * 0.002, 1e6]
      for (let k = 0; k < rates.length; k++) lambdas.push(safeAbove(rates, k))
      for (const lambda of lambdas) {
        const res = allocate(images, { lambda })
        for (const image of images) {
          const expected = refChoice(image, lambda)
          const actual = res.choices.get(image.id)
          const label = `trial ${trial}, lambda ${lambda}, ${image.id}`
          expect(actual?.bytes, `${label}: bytes`).toBe(expected.bytes)
          expect(actual?.distortion, `${label}: distortion`).toBe(expected.distortion)
        }
      }
    }
  })

  it('lambda mode is right-continuous: at a crossing the upgrade is not bought', () => {
    for (let trial = 0; trial < 12; trial++) {
      const images = randomInstance(1000 + trial)
      const rates = refRates(images)
      for (let k = 0; k < rates.length; k++) {
        // The allocation exactly AT a marginal rate must equal the
        // allocation just above it: the fewer-bytes side of the tie.
        const atRate = allocate(images, { lambda: rates[k] as number })
        const justAbove = allocate(images, { lambda: safeAbove(rates, k) })
        expect(atRate.choices, `trial ${trial}, rate ${rates[k]}`).toEqual(justAbove.choices)
      }
    }
  })

  it('budget mode matches the hull-free exhaustive rate sweep exactly', () => {
    const rand = mulberry32(0x5eed_0002)
    for (let trial = 0; trial < 12; trial++) {
      const images = randomInstance(2000 + trial)
      for (const budget of sampleBudgets(images, rand)) {
        const res = allocate(images, { budgetBytes: budget })
        const ref = refAllocate(images, budget)
        const label = `trial ${trial}, budget ${budget}`
        expect(res.lambda, `${label}: lambda`).toBe(ref.lambda)
        expect(res.totalBytes, `${label}: totalBytes`).toBe(ref.totalBytes)
        expect(res.totalDistortion, `${label}: totalDistortion`).toBe(ref.totalDistortion)
        for (let i = 0; i < images.length; i++) {
          const image = images[i] as AllocationImage
          const expected = ref.choices[i] as CandidatePoint
          const actual = res.choices.get(image.id)
          expect(actual?.bytes, `${label}, ${image.id}: bytes`).toBe(expected.bytes)
          expect(actual?.distortion, `${label}, ${image.id}: distortion`).toBe(expected.distortion)
        }
        // The resolved lambda must reproduce the identical result in lambda
        // mode: budget mode is a search over lambda mode, nothing more.
        const replay = allocate(images, { lambda: res.lambda })
        expect(replay.choices, `${label}: replay`).toEqual(res.choices)
        expect(replay.totalBytes, `${label}: replay bytes`).toBe(res.totalBytes)
      }
    }
  })

  it('budget mode is knapsack-optimal over all combinations within its byte total', () => {
    const rand = mulberry32(0x5eed_0003)
    for (let trial = 0; trial < 8; trial++) {
      const images = randomInstance(3000 + trial)
      const combos = allCombinations(images)
      let minTotal = Number.POSITIVE_INFINITY
      for (const combo of combos) minTotal = Math.min(minTotal, combo.totalBytes)
      for (const budget of sampleBudgets(images, rand)) {
        const res = allocate(images, { budgetBytes: budget })
        const label = `trial ${trial}, budget ${budget}`
        if (minTotal <= budget) {
          expect(res.totalBytes, `${label}: within budget`).toBeLessThanOrEqual(budget)
        } else {
          // Infeasible: best effort is the minimum byte allocation.
          expect(res.totalBytes, `${label}: minimum total`).toBe(minTotal)
        }
        // No combination of unpruned candidates fitting in the bytes the
        // allocator actually spent can beat its distortion. Exact comparison:
        // all values sit on the 1/512 grid.
        let best = Number.POSITIVE_INFINITY
        for (const combo of combos) {
          if (combo.totalBytes <= res.totalBytes) best = Math.min(best, combo.totalDistortion)
        }
        expect(res.totalDistortion, `${label}: knapsack optimum`).toBe(best)
      }
    }
  })
})
