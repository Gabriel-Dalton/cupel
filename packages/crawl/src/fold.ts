import type { DisplayEstimate, Viewport } from './dims.js'

/**
 * Above-the-fold heuristic and LCP guess. Like everything else in this
 * package it is a static approximation, and its two assumptions are
 * deliberate and documented:
 *
 * 1. Assets stack vertically in document order. Each asset's top offset is
 *    the sum of the estimated heights before it (unknown heights contribute
 *    nothing), and an asset is above the fold when its top lands strictly
 *    inside the viewport. When no heights are known this degrades to
 *    "everything is above the fold", which errs toward over-weighting
 *    rather than silently discounting assets in the allocator.
 * 2. loading="lazy" is read as an author statement that the image is below
 *    the fold, and it overrides the stacking estimate. The lazy asset still
 *    occupies its estimated layout space for the assets after it.
 *
 * The LCP guess is the above-fold asset with the largest estimated display
 * area, mirroring how real LCP tracks the largest painted element. Only
 * assets with both dimensions estimated can win. Tie-break, documented:
 * equal areas go to the earliest asset in document order, because earlier
 * markup tends to paint earlier.
 */

export type FoldInput = {
  display: DisplayEstimate
  lazy: boolean
}

export type FoldResult = {
  /** Parallel to the input array. */
  aboveFold: boolean[]
  /** Index of the LCP guess, or undefined when nothing qualifies. */
  lcpIndex: number | undefined
}

export function estimateFold(items: FoldInput[], viewport: Viewport): FoldResult {
  const aboveFold: boolean[] = []
  let top = 0
  for (const item of items) {
    aboveFold.push(!item.lazy && top < viewport.height)
    top += item.display.height ?? 0
  }

  let lcpIndex: number | undefined
  let lcpArea = 0
  for (let i = 0; i < items.length; i++) {
    const { width, height } = items[i]!.display
    if (!aboveFold[i] || width === undefined || height === undefined) continue
    const area = width * height
    // Strictly greater keeps the earliest asset on ties.
    if (area > lcpArea) {
      lcpArea = area
      lcpIndex = i
    }
  }

  return { aboveFold, lcpIndex }
}
