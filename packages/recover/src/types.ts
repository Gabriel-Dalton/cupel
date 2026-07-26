import type { DiscoveredAsset } from '@cupel/core'

/**
 * A better original proposed by a recoverer. Proposals are never trusted:
 * a candidate is accepted only if it strictly improves at least one of
 * declared resolution, effective resolution, generation count, or
 * estimated original quality, and every accepted swap is logged in the
 * receipt. Acceptance lives in core's decision layer, not here.
 */
export type SourceCandidate = {
  /** URL or local path of the proposed better source. */
  url: string
  /** Which recoverer proposed it. */
  via: string
  /** Why this candidate plausibly exists, human readable. */
  rationale: string
}

/**
 * Recoverers PROPOSE candidates; the framework VERIFIES them (see
 * BRIEF section 5 and the package responsibility table in section 8.2).
 */
export interface SourceRecoverer {
  name: string
  match(asset: DiscoveredAsset): boolean
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]>
}
