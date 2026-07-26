import type {
  AllocateOptions,
  AllocateResult,
  AllocationImage,
  CandidatePoint,
  FloorConfig,
} from './types.js'
import { lowerConvexHull } from './hull.js'

/**
 * Lagrangian byte allocation across a page's images, per BRIEF section 3.4.
 *
 * For a given lambda every image is chosen independently:
 *
 *   choice_i(lambda) = argmin over hull points p of
 *                        w_i * p.distortion + lambda * p.bytes
 *
 * with exact ties broken toward fewer bytes, deterministically. In budget
 * mode lambda is resolved by bisection over the breakpoint rates of the
 * pruned hulls. Because hull pruning makes B(lambda) an exact step function
 * whose steps all sit at those rates, the bisection is exact, not
 * approximate: the resolved lambda reproduces the identical allocation when
 * fed back in lambda mode.
 *
 * Floors FILTER candidate sets before hulls are built, they never patch an
 * allocation afterward. Every image must keep at least one legal point, so
 * callers include a keep-original candidate (ssim 1 by definition), which
 * survives any legal floor.
 */

/**
 * Brief section 3.4 defaults. NOTE: written against standard SSIM's scale;
 * recalibration for cupel's 8x8 window variant is tracked in issue #7 and
 * pinned empirically in packages/codecs-node/test/ssim-floor-calibration.
 */
export const DEFAULT_FLOORS: FloorConfig = { globalMinSsim: 0.97, aboveFoldMinSsim: 0.99 }

/**
 * Drops candidates whose ssim falls strictly below the floor. Points exactly
 * at the floor survive. Exported separately so the pipeline's filter stage
 * can apply role-aware floors (aboveFoldMinSsim needs to know which assets
 * are above the fold, context the allocator does not have).
 */
export function applyFloor(points: readonly CandidatePoint[], floor: number): CandidatePoint[] {
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new Error(`applyFloor: floor must be a finite value in [0, 1], got ${floor}`)
  }
  for (const p of points) {
    if (!Number.isFinite(p.ssim)) {
      throw new Error(`applyFloor: candidate ssim must be finite, got ${p.ssim}`)
    }
  }
  return points.filter((p) => p.ssim >= floor)
}

/** One image with its floor-filtered, freshly pruned hull. */
type PreparedImage = {
  id: string
  weight: number
  hull: CandidatePoint[]
  /**
   * Weighted marginal rate of each hull segment: rates[k] is the weighted
   * distortion removed per byte by upgrading from hull[k] to hull[k + 1].
   * Hull convexity makes the real rates strictly decreasing; their nearest
   * double roundings are therefore non-increasing.
   */
  rates: number[]
}

type Evaluation = {
  choices: CandidatePoint[]
  totalBytes: number
  totalDistortion: number
}

function prepareRates(weight: number, hull: readonly CandidatePoint[]): number[] {
  const rates: number[] = []
  for (let i = 0; i + 1 < hull.length; i++) {
    const cheap = hull[i] as CandidatePoint
    const rich = hull[i + 1] as CandidatePoint
    rates.push((weight * (cheap.distortion - rich.distortion)) / (rich.bytes - cheap.bytes))
  }
  return rates
}

/**
 * The per-image choice at a given lambda: walk the hull from the cheapest
 * point and buy each upgrade whose marginal rate exceeds lambda, stopping at
 * the first that does not. On a convex hull this is exactly the argmin of
 * w * p.distortion + lambda * p.bytes with exact ties resolved toward fewer
 * bytes (at lambda equal to a rate, the upgrade is not bought).
 *
 * The comparison deliberately runs against the precomputed rate doubles
 * rather than recomputing scores: budget mode's candidate lambdas are these
 * same doubles, so every step of B(lambda) lands exactly on a candidate and
 * B is exactly monotone over them. Score arithmetic would resolve crossings
 * within a rounding error of the true rate unpredictably, hiding steps from
 * the bisection whenever a rate rounds down.
 */
function evaluateAt(images: readonly PreparedImage[], lambda: number): Evaluation {
  const choices: CandidatePoint[] = []
  let totalBytes = 0
  let totalDistortion = 0
  for (const image of images) {
    let k = 0
    while (k < image.rates.length && (image.rates[k] as number) > lambda) k++
    const chosen = image.hull[k] as CandidatePoint
    choices.push(chosen)
    totalBytes += chosen.bytes
    totalDistortion += image.weight * chosen.distortion
  }
  return { choices, totalBytes, totalDistortion }
}

function toResult(
  images: readonly PreparedImage[],
  lambda: number,
  evaluation: Evaluation,
): AllocateResult {
  const choices = new Map<string, CandidatePoint>()
  for (let i = 0; i < images.length; i++) {
    choices.set((images[i] as PreparedImage).id, evaluation.choices[i] as CandidatePoint)
  }
  return {
    lambda,
    totalBytes: evaluation.totalBytes,
    totalDistortion: evaluation.totalDistortion,
    choices,
  }
}

/**
 * Allocates one candidate point per image, minimizing total weighted
 * distortion. Exactly one of opts.budgetBytes and opts.lambda must be
 * provided: lambda is the portable knob (uniform marginal weighted
 * distortion per byte), budgetBytes resolves a lambda internally and reports
 * it so callers can pin it later.
 *
 * The hull field of each image may be an unsorted, unpruned candidate list:
 * the lower convex hull is re-derived here after floors are applied, which
 * is also what guarantees floors filter candidates rather than patch hulls.
 *
 * Budget-mode semantics are step-down: the result is the allocation at the
 * smallest breakpoint lambda whose total fits the budget, so totalBytes is
 * the largest uniform-lambda-achievable total at or under budgetBytes. When
 * even the minimum byte allocation exceeds the budget the result is best
 * effort: that minimum allocation, the smallest lambda producing it, and
 * totalBytes visibly over budget so the caller can detect the overrun.
 */
export function allocate(
  images: readonly AllocationImage[],
  opts: AllocateOptions,
): AllocateResult {
  const hasBudget = opts.budgetBytes !== undefined
  const hasLambda = opts.lambda !== undefined
  if (hasBudget === hasLambda) {
    throw new Error('allocate: provide exactly one of budgetBytes and lambda')
  }
  if (hasLambda && (!Number.isFinite(opts.lambda) || (opts.lambda as number) < 0)) {
    throw new Error(`allocate: lambda must be finite and non-negative, got ${opts.lambda}`)
  }
  if (hasBudget && (!Number.isFinite(opts.budgetBytes) || (opts.budgetBytes as number) < 0)) {
    throw new Error(
      `allocate: budgetBytes must be finite and non-negative, got ${opts.budgetBytes}`,
    )
  }

  const prepared: PreparedImage[] = []
  const seen = new Set<string>()
  for (const image of images) {
    if (seen.has(image.id)) {
      throw new Error(`allocate: duplicate image id "${image.id}"`)
    }
    seen.add(image.id)
    if (!Number.isFinite(image.weight) || image.weight < 0) {
      throw new Error(
        `allocate: weight must be finite and non-negative, image "${image.id}" has ${image.weight}`,
      )
    }
    if (image.hull.length === 0) {
      throw new Error(`allocate: image "${image.id}" has no candidate points`)
    }
    const filtered = opts.floors
      ? applyFloor(image.hull, opts.floors.globalMinSsim)
      : [...image.hull]
    if (filtered.length === 0) {
      throw new Error(
        `allocate: floors removed every candidate for image "${image.id}"; ` +
          'include a keep-original point (ssim 1) so a legal choice always survives',
      )
    }
    const hull = lowerConvexHull(filtered)
    prepared.push({
      id: image.id,
      weight: image.weight,
      hull,
      rates: prepareRates(image.weight, hull),
    })
  }

  if (hasLambda) {
    const lambda = opts.lambda as number
    return toResult(prepared, lambda, evaluateAt(prepared, lambda))
  }

  const budget = opts.budgetBytes as number

  // Lambda 0 buys every image its minimum distortion point. If that fits,
  // the budget does not bind and the allocator degenerates into per-image
  // threshold mode (BRIEF section 13).
  const atZero = evaluateAt(prepared, 0)
  if (atZero.totalBytes <= budget) {
    return toResult(prepared, 0, atZero)
  }

  // B(lambda) only steps where lambda crosses a hull segment rate, and at
  // the crossing itself the upgrade is not bought (the fewer-bytes tie), so
  // evaluating exactly at the rates covers every reachable allocation. The
  // rates are the very doubles evaluateAt compares against, so the reported
  // lambda is bit-identical to what a caller would derive from the chosen
  // points with the same expression.
  const rateSet = new Set<number>()
  for (const image of prepared) {
    for (const rate of image.rates) {
      if (rate > 0) rateSet.add(rate)
    }
  }
  // Descending: rates[0] yields the minimum byte allocation, the last rate
  // the largest one still short of lambda 0.
  const rates = [...rateSet].sort((a, b) => b - a)

  // No positive rates means B(lambda) is constant, and it exceeds the
  // budget (checked above): best effort at lambda 0.
  if (rates.length === 0) {
    return toResult(prepared, 0, atZero)
  }

  const cheapest = evaluateAt(prepared, rates[0] as number)
  if (cheapest.totalBytes > budget) {
    // Even the minimum byte allocation overruns. rates[0] is the smallest
    // lambda that produces it; return it so the caller sees the overrun.
    return toResult(prepared, rates[0] as number, cheapest)
  }

  // Exact bisection over the breakpoints: B(rates[k]) is non-decreasing in
  // k (smaller lambda buys more), find the largest k still within budget.
  let lo = 0
  let hi = rates.length - 1
  let loEval = cheapest
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2)
    const midEval = evaluateAt(prepared, rates[mid] as number)
    if (midEval.totalBytes <= budget) {
      lo = mid
      loEval = midEval
    } else {
      hi = mid - 1
    }
  }
  return toResult(prepared, rates[lo] as number, loEval)
}
