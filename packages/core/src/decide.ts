import type { LedgerDecision } from './ledger.js'
import type { ProvenanceRecord } from './provenance/types.js'
import type { CandidatePoint, FloorConfig } from './rd/types.js'
import { resolveHeadroom } from './provenance/headroom.js'
import { DEFAULT_FLOORS, allocate, applyFloor } from './rd/allocate.js'
import { lowerConvexHull } from './rd/hull.js'

/**
 * The per-asset decision engine, BRIEF section 6 distilled to its pure
 * heart. Everything platform-bound happens elsewhere: candidates arrive
 * already measured, provenance already analyzed, and what leaves is a
 * LedgerDecision plus a reason string ready for the receipt. The two
 * behaviours that must never be quietly dropped both live here: refusal on
 * exhausted headroom, and the no-op guard against spending a generation for
 * trivial savings.
 */

/**
 * BRIEF sections 3.4 and 6, step 9: when the chosen encode saves less than
 * this fraction of the original bytes and the format is unchanged, the
 * decision collapses to keep-original. The 5 percent value is a guess to be
 * calibrated against the corpus (BRIEF section 15).
 */
export const NO_OP_MIN_SAVINGS = 0.05

/**
 * Low headroom means the source has little quality left to spend, so a
 * candidate must clear the applicable ssim floor with explicit margin
 * rather than just touching it. The raised floor is capped at 1 so lossless
 * points and keep-original always stay legal. The value is a calibration
 * guess in the same family as the floors themselves (issue #7).
 */
export const LOW_HEADROOM_SSIM_MARGIN = 0.01

/** BRIEF section 6 step 1. The first three classes are skipped, recorded,
 * never silently flattened or rasterized. */
export type AssetClassification = 'vector' | 'animated' | 'icon' | 'graphic' | 'photo'

export type DecideAssetOptions = {
  /** Quality floors; DEFAULT_FLOORS when omitted. */
  floors?: FloorConfig
  /** Visual weight (BRIEF 3.3). Only consulted in lambda mode. Default 1. */
  weight?: number
  /**
   * Marginal weighted distortion per byte. When provided the choice is the
   * allocator's argmin at this lambda (page mode with a pinned knob). When
   * omitted the choice is single mode: the cheapest point clearing the
   * floor (BRIEF section 6, step 10).
   */
  lambda?: number
  /** Applies floors.aboveFoldMinSsim instead of floors.globalMinSsim. */
  aboveFold?: boolean
  /**
   * The classifier's verdict, when the caller ran one. It overrides the
   * container-based skip default: the classifier saw the actual frames, the
   * container byte did not.
   */
  classification?: AssetClassification
}

export type AssetDecision =
  | { decision: 'encoded'; chosen: CandidatePoint; reason: string }
  | { decision: Exclude<LedgerDecision, 'encoded'>; chosen: null; reason: string }

/** Containers skipped when no classification is provided: an svg is a
 * vector by definition, and a gif cannot be proven static from a
 * ProvenanceRecord alone, so neither is ever quietly re-encoded here. */
const SKIP_CLASSES: ReadonlySet<AssetClassification> = new Set(['vector', 'animated', 'icon'])

function skipReason(classification: AssetClassification): string {
  switch (classification) {
    case 'vector':
      return 'vector source: rasterizing it would trade resolution independence for pixels'
    case 'animated':
      return 'animated source: it must never be silently flattened to one frame'
    default:
      return 'icon: too small for the sweep to say anything trustworthy'
  }
}

function keptDecision(reason: string): AssetDecision {
  return { decision: 'kept', chosen: null, reason }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * Decides what an auditor reports or a writer executes for one asset:
 * encoded (with the chosen point), kept, refused, or skipped, plus a reason
 * string suitable for the ledger's reason field. The reason is populated
 * for every decision, including encoded; the ledger writer may drop it
 * where the schema wants null.
 *
 * Order follows BRIEF section 6 and it matters: classification skip, then
 * refusal on exhausted headroom, then floors filter the candidates (reuse
 * of applyFloor, with low headroom demanding LOW_HEADROOM_SSIM_MARGIN over
 * the floor), then the choice (allocate at the caller's lambda, or the
 * cheapest legal point in single mode), then the no-op guard.
 *
 * Candidates should include a keep-original point (ssim 1, distortion 0,
 * bytes of the original file). Without one the engine still decides, but it
 * cannot state savings and the no-op guard cannot run.
 */
export function decideAsset(
  provenance: ProvenanceRecord,
  candidates: readonly CandidatePoint[],
  opts: DecideAssetOptions = {},
): AssetDecision {
  const weight = opts.weight ?? 1
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error(`decideAsset: weight must be finite and non-negative, got ${opts.weight}`)
  }
  if (opts.lambda !== undefined && (!Number.isFinite(opts.lambda) || opts.lambda < 0)) {
    throw new Error(`decideAsset: lambda must be finite and non-negative, got ${opts.lambda}`)
  }

  // 1. Classification skip. The caller's classifier wins; the container is
  // the conservative fallback.
  const classification =
    opts.classification ??
    (provenance.container === 'svg'
      ? 'vector'
      : provenance.container === 'gif'
        ? 'animated'
        : undefined)
  if (classification && SKIP_CLASSES.has(classification)) {
    const via = opts.classification
      ? `classified ${classification}`
      : `${provenance.container} container, no classification provided, treated as ${classification}`
    return { decision: 'skipped', chosen: null, reason: `${via}: ${skipReason(classification)}` }
  }

  // 2. Refusal. Headroom none means re-encoding spends a generation the
  // source does not have, no matter how tempting a candidate looks. This
  // precedes every candidate consideration by design (BRIEF 6, step 4).
  if (provenance.headroom === 'none') {
    const resolved = resolveHeadroom({
      container: provenance.container,
      generations: provenance.generations,
      estimatedOriginalQuality: provenance.estimatedOriginalQuality,
      blockingScore: provenance.blockingScore,
    })
    const evidence =
      resolved.headroom === 'none'
        ? resolved.reasons.join('; ')
        : 'recorded by the provenance record'
    return {
      decision: 'refused',
      chosen: null,
      reason: `headroom none: ${evidence}. Re-encoding is refused; recover a better original instead`,
    }
  }

  // 3. Nothing measured, nothing to decide. Recorded, not silent.
  if (candidates.length === 0) {
    return {
      decision: 'skipped',
      chosen: null,
      reason: 'no candidate points were measured for this asset',
    }
  }

  // 4. Floors FILTER candidates (BRIEF 3.4); low headroom raises the bar.
  const floors = opts.floors ?? DEFAULT_FLOORS
  const baseFloor = opts.aboveFold ? floors.aboveFoldMinSsim : floors.globalMinSsim
  const lowHeadroom = provenance.headroom === 'low'
  const floor = lowHeadroom ? Math.min(1, baseFloor + LOW_HEADROOM_SSIM_MARGIN) : baseFloor
  const floorNote = lowHeadroom
    ? `ssim floor ${floor} (${baseFloor} raised by the low headroom margin ${LOW_HEADROOM_SSIM_MARGIN})`
    : `ssim floor ${floor}`
  const legal = applyFloor(candidates, floor)

  if (legal.length === 0) {
    return keptDecision(
      `every measured candidate fell below the ${floorNote}: keeping the original bytes`,
    )
  }

  // 5. The choice. Lambda mode delegates to the allocator so a pinned page
  // lambda produces identical selections here and in page allocation;
  // single mode is the hull's cheapest point, which is the cheapest legal
  // candidate with ties broken toward lower distortion.
  let chosen: CandidatePoint
  let how: string
  if (opts.lambda !== undefined) {
    const result = allocate([{ id: 'asset', weight, hull: legal }], { lambda: opts.lambda })
    chosen = result.choices.get('asset') as CandidatePoint
    how = `allocator argmin at lambda ${opts.lambda}, weight ${weight}, over the ${floorNote}`
  } else {
    chosen = lowerConvexHull(legal)[0] as CandidatePoint
    how = `cheapest point clearing the ${floorNote}`
  }

  const original = candidates.find((p) => p.format === 'keep-original')

  if (chosen.format === 'keep-original') {
    return keptDecision(`keep-original selected (${how}): no measured encode beats the original`)
  }

  // 6. No-op guard (BRIEF 6, step 9): a same-format re-encode that saves
  // under the threshold costs a generation and buys nothing.
  if (original && original.bytes > 0) {
    const savings = (original.bytes - chosen.bytes) / original.bytes
    if (savings < NO_OP_MIN_SAVINGS && chosen.format === provenance.container) {
      return keptDecision(
        `no-op guard: the best ${chosen.format} point saves only ${percent(savings)} ` +
          `of ${original.bytes} bytes (threshold ${percent(NO_OP_MIN_SAVINGS)}) with the ` +
          `format unchanged: not worth an encode generation`,
      )
    }
  }

  const qualityLabel = chosen.quality === null ? 'lossless' : `q${chosen.quality}`
  const savingsLabel =
    original && original.bytes > 0
      ? `${chosen.bytes} bytes vs ${original.bytes} original ` +
        `(${percent((original.bytes - chosen.bytes) / original.bytes)} saved)`
      : `${chosen.bytes} bytes (no keep-original baseline provided)`
  return {
    decision: 'encoded',
    chosen,
    reason: `${chosen.format} ${qualityLabel}: ${savingsLabel}, ssim ${chosen.ssim} (${how})`,
  }
}

/**
 * Documented tolerances for the recovered-source acceptance rule. Declared
 * resolution and generations are facts (a header field and a count), so
 * they get no tolerance at all: in particular a recovered source is never
 * allowed to add a generation. The other two are measurements: quality
 * estimation from quantization tables is accurate to about 2 points (BRIEF
 * 4.1), and the spectral effective-resolution cutoff carries a few percent
 * of noise (see the calibration notes in provenance/headroom.ts), so
 * differences inside these bands are neither improvements nor regressions.
 */
export const RECOVERY_TOLERANCE = {
  /** Fractional pixel-area band around equality for effective resolution. */
  effectiveResolutionRatio: 0.05,
  /** Points of estimated original quality inside the estimation noise. */
  estimatedOriginalQuality: 2,
} as const

export type SourceAcceptance = { accepted: boolean; reason: string }

type DimensionVerdict = 'improved' | 'regressed' | 'neutral'

type Dimension = {
  name: string
  verdict: DimensionVerdict
  detail: string
}

function resolutionLabel(r: { w: number; h: number } | null): string {
  return r ? `${r.w}x${r.h}` : 'undetermined'
}

function compareDeclaredResolution(
  current: ProvenanceRecord,
  candidate: ProvenanceRecord,
): Dimension {
  const name = 'declared resolution'
  const cur = current.declaredResolution
  const cand = candidate.declaredResolution
  const detail = `${name} ${resolutionLabel(cur)} -> ${resolutionLabel(cand)}`
  const curArea = cur.w * cur.h
  const candArea = cand.w * cand.h
  if (candArea > curArea) return { name, verdict: 'improved', detail: `${detail}: improved` }
  if (candArea < curArea) return { name, verdict: 'regressed', detail: `${detail}: regressed` }
  return { name, verdict: 'neutral', detail: `${detail}: unchanged` }
}

function compareEffectiveResolution(
  current: ProvenanceRecord,
  candidate: ProvenanceRecord,
): Dimension {
  const name = 'effective resolution'
  const cur = current.effectiveResolution
  const cand = candidate.effectiveResolution
  const detail = `${name} ${resolutionLabel(cur)} -> ${resolutionLabel(cand)}`
  if (!cur || !cand) {
    return { name, verdict: 'neutral', detail: `${detail}: undetermined on at least one side` }
  }
  const curArea = cur.w * cur.h
  const candArea = cand.w * cand.h
  const tolerance = RECOVERY_TOLERANCE.effectiveResolutionRatio
  if (candArea > curArea * (1 + tolerance)) {
    return { name, verdict: 'improved', detail: `${detail}: improved` }
  }
  if (candArea < curArea * (1 - tolerance)) {
    return { name, verdict: 'regressed', detail: `${detail}: regressed` }
  }
  return { name, verdict: 'neutral', detail: `${detail}: within measurement tolerance` }
}

function compareGenerations(current: ProvenanceRecord, candidate: ProvenanceRecord): Dimension {
  const name = 'generations'
  const cur = current.generations
  const cand = candidate.generations
  const detail = `${name} ${cur ?? 'undetermined'} -> ${cand ?? 'undetermined'}`
  if (cur === null || cand === null) {
    return { name, verdict: 'neutral', detail: `${detail}: undetermined on at least one side` }
  }
  if (cand < cur) return { name, verdict: 'improved', detail: `${detail}: improved` }
  if (cand > cur) {
    return { name, verdict: 'regressed', detail: `${detail}: adds an encode generation` }
  }
  return { name, verdict: 'neutral', detail: `${detail}: unchanged` }
}

function compareQuality(current: ProvenanceRecord, candidate: ProvenanceRecord): Dimension {
  const name = 'estimated original quality'
  const cur = current.estimatedOriginalQuality
  const cand = candidate.estimatedOriginalQuality
  const detail = `${name} ${cur ?? 'undetermined'} -> ${cand ?? 'undetermined'}`
  if (cur === null || cand === null) {
    return { name, verdict: 'neutral', detail: `${detail}: undetermined on at least one side` }
  }
  const tolerance = RECOVERY_TOLERANCE.estimatedOriginalQuality
  if (cand > cur + tolerance) return { name, verdict: 'improved', detail: `${detail}: improved` }
  if (cand < cur - tolerance) return { name, verdict: 'regressed', detail: `${detail}: regressed` }
  return { name, verdict: 'neutral', detail: `${detail}: within the ${tolerance} point tolerance` }
}

/**
 * The pure acceptance rule for a proposed better original (BRIEF section
 * 5): a recovered candidate is accepted only if it strictly improves at
 * least one of declared resolution, effective resolution, generation count,
 * or estimated original quality, with no regression permitted in the others
 * beyond RECOVERY_TOLERANCE. Recoverers propose, this verifies: both
 * records are expected to come from analyzeProvenance on the respective
 * decoded sources. The reason string names all four dimensions so the
 * accepted (or rejected) swap is auditable from the ledger alone.
 */
export function acceptRecoveredSource(
  current: ProvenanceRecord,
  candidate: ProvenanceRecord,
): SourceAcceptance {
  const dimensions: Dimension[] = [
    compareDeclaredResolution(current, candidate),
    compareEffectiveResolution(current, candidate),
    compareGenerations(current, candidate),
    compareQuality(current, candidate),
  ]
  const improved = dimensions.filter((d) => d.verdict === 'improved')
  const regressed = dimensions.filter((d) => d.verdict === 'regressed')
  const summary = dimensions.map((d) => d.detail).join('; ')

  if (regressed.length > 0) {
    return {
      accepted: false,
      reason: `rejected, regression in ${regressed.map((d) => d.name).join(', ')}: ${summary}`,
    }
  }
  if (improved.length === 0) {
    return {
      accepted: false,
      reason: `rejected, no strict improvement in any dimension: ${summary}`,
    }
  }
  return {
    accepted: true,
    reason:
      `accepted, ${improved.map((d) => d.name).join(', ')} strictly improved ` +
      `with no regression: ${summary}`,
  }
}
