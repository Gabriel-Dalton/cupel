import type { OutputFormat } from '../types.js'

/**
 * One point on an image's rate-distortion curve: a concrete encode at a
 * concrete quality, measured. The sweep produces many of these per image;
 * only the lower convex hull survives into allocation.
 */
export type CandidatePoint = {
  format: OutputFormat
  /** null for lossless points and for keep-original. */
  quality: number | null
  bytes: number
  ssim: number
  /** Mean CIE76 deltaE against the reference. */
  deltaE: number
  /** Derived, see distortion.ts: d = (1 - ssim) + kappa * min(deltaE / 2.3, 1). */
  distortion: number
  /** Provenance of the number, e.g. 'sharp@0.34.5/libwebp@1.6.0'. */
  encoder: string
}

/**
 * Quality floors applied by FILTERING hulls before allocation, never by
 * patching afterward. NOTE: these defaults were written against standard
 * SSIM's scale and must be recalibrated for cupel's 8x8 window variant
 * before the allocator ships decisions (tracked in issue #7).
 */
export type FloorConfig = {
  /** Points below this ssim are dropped everywhere. Default 0.97. */
  globalMinSsim: number
  /** Floor for above-the-fold and LCP candidates. Default 0.99. */
  aboveFoldMinSsim: number
}

/** Inputs to the visual weight model, see BRIEF section 3.3. */
export type WeightInputs = {
  displayAreaCssPx: number
  /** 1.0 above the fold, decaying to ~0.3 two viewport heights down. */
  viewportFactor?: number
  /** LCP candidate 1.5, decorative background 0.6, otherwise 1.0. */
  roleFactor?: number
}

/** One image as the allocator sees it. */
export type AllocationImage = {
  id: string
  weight: number
  /** Lower convex hull of (bytes, distortion), bytes ascending. */
  hull: CandidatePoint[]
}

export type AllocateOptions = {
  /** Total byte budget. Provide either this or lambda. */
  budgetBytes?: number
  /** Marginal weighted distortion per byte. The portable knob. */
  lambda?: number
  floors?: FloorConfig
}

export type AllocateResult = {
  /** The lambda that was used or resolved from the budget. */
  lambda: number
  totalBytes: number
  totalDistortion: number
  /** Chosen point per image id. */
  choices: Map<string, CandidatePoint>
}
