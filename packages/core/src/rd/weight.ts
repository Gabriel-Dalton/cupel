import type { AssetRole } from '../assets.js'
import type { WeightInputs } from './types.js'

/**
 * Visual weight model, per BRIEF section 3.3:
 *
 *   w = (displayAreaCssPx ^ alpha) * viewportFactor * roleFactor
 *
 * Sublinear in area because perceived importance does not scale linearly
 * with it. Display area comes from the page crawl (rendered CSS dimensions,
 * not intrinsic pixels); when there is no page context, callers should use
 * weight 1 for every image and the allocator degenerates gracefully into
 * per-image threshold mode.
 */

/** Default area exponent alpha, per BRIEF section 3.3. */
export const DEFAULT_AREA_EXPONENT = 0.6

/** Per-role multipliers, per BRIEF section 3.3. */
const ROLE_FACTORS: Record<AssetRole, number> = { lcp: 1.5, content: 1, decorative: 0.6 }

/** Where the viewport decay bottoms out, in viewport heights below the fold. */
const VIEWPORT_DECAY_END = 2

/** The factor an asset keeps once it is VIEWPORT_DECAY_END viewports down. */
const VIEWPORT_FLOOR = 0.3

/**
 * Computes the visual weight from the crawl-derived inputs. Absent factors
 * default to 1 (no page context, no adjustment). alpha must lie in (0, 1]:
 * zero or negative exponents would invert the area ordering, and exponents
 * above 1 would make the model superlinear, both nonsensical here.
 */
export function visualWeight(inputs: WeightInputs, alpha: number = DEFAULT_AREA_EXPONENT): number {
  const { displayAreaCssPx, viewportFactor = 1, roleFactor = 1 } = inputs
  if (!Number.isFinite(displayAreaCssPx) || displayAreaCssPx < 0) {
    throw new Error(
      `visualWeight: displayAreaCssPx must be finite and non-negative, got ${displayAreaCssPx}`,
    )
  }
  if (!Number.isFinite(viewportFactor) || viewportFactor < 0) {
    throw new Error(
      `visualWeight: viewportFactor must be finite and non-negative, got ${viewportFactor}`,
    )
  }
  if (!Number.isFinite(roleFactor) || roleFactor < 0) {
    throw new Error(`visualWeight: roleFactor must be finite and non-negative, got ${roleFactor}`)
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new Error(`visualWeight: alpha must be a finite value in (0, 1], got ${alpha}`)
  }
  return Math.pow(displayAreaCssPx, alpha) * viewportFactor * roleFactor
}

/**
 * Viewport factor as a function of how far below the fold an asset sits,
 * measured in viewport heights (0 means the top edge of the asset is at the
 * fold; negative depths are on screen). 1.0 above the fold, decaying
 * linearly to 0.3 at two viewport heights down, flat beyond that. Linear
 * because nothing in the brief justifies a fancier curve, and a linear ramp
 * is trivially explainable in an audit report.
 */
export function viewportFactorAtDepth(depthViewports: number): number {
  if (!Number.isFinite(depthViewports)) {
    throw new Error(`viewportFactorAtDepth: depth must be finite, got ${depthViewports}`)
  }
  if (depthViewports <= 0) return 1
  if (depthViewports >= VIEWPORT_DECAY_END) return VIEWPORT_FLOOR
  return 1 - ((1 - VIEWPORT_FLOOR) / VIEWPORT_DECAY_END) * depthViewports
}

/** Role factor per BRIEF 3.3: LCP 1.5, decorative 0.6, everything else 1. */
export function roleFactorFor(role: AssetRole): number {
  return ROLE_FACTORS[role]
}
