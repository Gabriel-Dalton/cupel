import type { RawImage } from '../types.js'
import type { ChromaSubsampling, Container, Headroom, ProvenanceRecord } from './types.js'
import { blockingScore } from '../metrics/blocking.js'
import { effectiveResolution } from '../metrics/spectrum.js'
import { laplacianSharpness } from '../metrics/laplacian.js'
import { estimateJpegQuality, parseJpeg, selectQuantTables } from './jpeg-dqt.js'
import { FINGERPRINT_REGISTRY, identifyEncoder, quantSignature } from './fingerprints.js'
import { detectDoubleQuantization } from './double-quant.js'

/**
 * Assembles the full ProvenanceRecord from parsed header evidence plus the
 * M1 metrics. This module produces EVIDENCE and one derived field the
 * compression decision actually consumes: headroom (BRIEF section 4).
 */

export type ProvenanceInput = {
  container: Container
  /** Decoded pixels. */
  image: RawImage
  /**
   * The original file bytes (or their first ~64 KB: everything used here
   * lives before SOS). Only interpreted for jpeg containers.
   */
  bytes?: Uint8Array
}

/** The evidence subset that decides headroom. */
export type HeadroomInputs = {
  container: Container
  generations: number | null
  estimatedOriginalQuality: number | null
  /** Normalized 0..1 blocking score, as stored on the record. */
  blockingScore: number
}

/**
 * Containers that cannot themselves produce 8x8 blocking: DCT seams in one
 * of these mean the pixels were laundered from a JPEG. webp and avif are
 * excluded because their lossy modes are block transforms of their own.
 */
const LOSSLESS_CONTAINERS: ReadonlySet<Container> = new Set(['png', 'gif'])

/**
 * Blocking score (0..1 scale, see blockingScore01) at or above which a
 * lossless container is treated as laundered from a JPEG. 1/3 corresponds
 * to a boundary-to-interior gradient ratio of 1.5. Deliberately
 * conservative: a false "laundered" verdict refuses a healthy source, and
 * the synthetic laundering fixture scores essentially 1.0 while clean
 * sources sit at 0. Corpus recalibration expected (same caveat family as
 * issue #7 for the SSIM floors).
 */
const LAUNDERED_BLOCKING_SCORE = 1 / 3

/**
 * upscaled = effective long edge below this fraction of the certifiable
 * long edge. Calibration (test/metrics/spectrum.test.ts): 2x bilinear
 * upscales measure cutoffRatio 0.50..0.60 (truth 0.5), native content
 * measures 1.0, and the strongest antialiasing that must NOT be read as
 * upscaling (gaussian sigma 0.8) measures 0.672. 0.625 splits the gap.
 */
const UPSCALE_RATIO_MAX = 0.625

/**
 * Regime-aware softness thresholds (issue #4). laplacianSharpness measures
 * at native scale up to long edge 1024 and on a 1024 resample above it,
 * with a ~3.6x measurement cliff between the regimes for identical
 * statistics (pinned in test/metrics/laplacian.test.ts). One p95 threshold
 * therefore cannot serve both regimes; these are bucketed per regime and
 * calibrated on the procedural fixtures in test/provenance/headroom.test.ts
 * (measured values quoted there). The wide unknown band is deliberate
 * until the corpus provides real photographic calibration.
 */
const SOFTNESS_THRESHOLDS = {
  native: { sharpMin: 500, softMax: 100 },
  normalized: { sharpMin: 140, softMax: 28 },
} as const

/** Long edges above this measure in the normalized laplacian regime. */
const LAPLACIAN_NATIVE_LIMIT = 1024

const REGISTRY_FAMILIES = FINGERPRINT_REGISTRY.map((entry) => entry.family)

/**
 * Softness verdict for a p95 laplacian variance measured on an image whose
 * long edge is longEdge. Exported for direct calibration testing.
 */
export function softnessVerdict(p95: number, longEdge: number): 'sharp' | 'soft' | 'unknown' {
  const t =
    longEdge > LAPLACIAN_NATIVE_LIMIT ? SOFTNESS_THRESHOLDS.normalized : SOFTNESS_THRESHOLDS.native
  if (p95 >= t.sharpMin) return 'sharp'
  if (p95 < t.softMax) return 'soft'
  return 'unknown'
}

/**
 * The headroom rule from BRIEF 4.5, over evidence that has already been
 * gathered. Reading for null generations: a JPEG has at least one encode
 * generation by definition, so an undetermined detector result never
 * rescues headroom; the quality evidence stands alone.
 */
export function resolveHeadroom(inputs: HeadroomInputs): { headroom: Headroom; reasons: string[] } {
  const { generations, estimatedOriginalQuality: quality } = inputs
  const exhausted: string[] = []
  if (generations !== null && generations >= 2) {
    exhausted.push(`at least ${generations} encode generations detected`)
  }
  if (quality !== null && quality < 60) {
    exhausted.push(`estimated original quality ${quality} is below 60`)
  }
  if (
    LOSSLESS_CONTAINERS.has(inputs.container) &&
    inputs.blockingScore >= LAUNDERED_BLOCKING_SCORE
  ) {
    exhausted.push(
      `blocking score ${inputs.blockingScore.toFixed(2)} in a lossless container: ` +
        `pixels were laundered from a jpeg`,
    )
  }
  if (exhausted.length > 0) return { headroom: 'none', reasons: exhausted }
  if (quality !== null && quality < 78) {
    return {
      headroom: 'low',
      reasons: [
        `estimated original quality ${quality} is below 78 ` +
          `(generations ${generations ?? 'undetermined, at least 1'})`,
      ],
    }
  }
  return { headroom: 'normal', reasons: ['no exhaustion evidence'] }
}

/** Maps the open-ended boundary/interior ratio onto the record's 0..1 scale:
 * 1 - 1/ratio for ratio above the 1.0 neutral point, 0 otherwise. Ratio 1.5
 * maps to 1/3, ratio 2 to 0.5, extreme laundering saturates toward 1. */
function blockingScore01(ratio: number): number {
  return ratio <= 1 ? 0 : 1 - 1 / ratio
}

type JpegEvidence = {
  estimatedOriginalQuality: number | null
  encoderFingerprint: string | null
  chromaSubsampling: ChromaSubsampling | null
  generations: number | null
  evidence: string[]
}

function analyzeJpegBytes(bytes: Uint8Array | undefined, image: RawImage): JpegEvidence {
  const out: JpegEvidence = {
    estimatedOriginalQuality: null,
    encoderFingerprint: null,
    chromaSubsampling: null,
    generations: null,
    evidence: [],
  }
  const info = bytes ? parseJpeg(bytes) : null
  if (!info) {
    out.evidence.push(
      bytes
        ? 'jpeg header unreadable: no quality or generation evidence'
        : 'file bytes not provided: no quality or generation evidence',
    )
    return out
  }
  if (info.truncated) {
    out.evidence.push('jpeg header truncated: evidence may be partial')
  }
  out.chromaSubsampling = info.chromaSubsampling
  if (info.chromaSubsampling) {
    out.evidence.push(`chroma subsampling ${info.chromaSubsampling}`)
  }
  const selected = selectQuantTables(info)
  if (!selected.luma) {
    out.evidence.push('no quantization tables recovered from the header')
    return out
  }

  const estimate = estimateJpegQuality(selected, REGISTRY_FAMILIES)
  if (estimate) {
    out.estimatedOriginalQuality = estimate.quality
    out.evidence.push(
      `quantization tables fit the ${estimate.family} family at quality ${estimate.quality}` +
        (estimate.exact ? ' (exact match)' : ` (fit error ${estimate.fitError.toFixed(4)})`),
    )
  } else {
    const signatures =
      `luma ${quantSignature(selected.luma)}` +
      (selected.chroma ? `, chroma ${quantSignature(selected.chroma)}` : '')
    out.evidence.push(
      `quantization tables match no known family (signatures ${signatures}): quality unknown`,
    )
  }

  const match = identifyEncoder(selected)
  if (match) {
    out.encoderFingerprint = match.name
    out.evidence.push(`encoder fingerprint: ${match.name}`)
  }

  const dq = detectDoubleQuantization(image, selected.luma.values)
  out.generations = dq.generations
  out.evidence.push(...dq.evidence)
  return out
}

export function analyzeProvenance(input: ProvenanceInput): ProvenanceRecord {
  const { container, image } = input
  const evidence: string[] = [`container ${container}, declared ${image.width}x${image.height}`]

  const jpeg: JpegEvidence =
    container === 'jpeg'
      ? analyzeJpegBytes(input.bytes, image)
      : {
          estimatedOriginalQuality: null,
          encoderFingerprint: null,
          chromaSubsampling: null,
          generations: null,
          evidence: [],
        }
  evidence.push(...jpeg.evidence)

  const blocking = blockingScore(image)
  const blockingRecord = blockingScore01(blocking.combined)
  evidence.push(
    `8x8 boundary energy ratio ${blocking.combined.toFixed(2)} ` +
      `(blocking score ${blockingRecord.toFixed(2)})`,
  )

  let effective: { w: number; h: number } | null = null
  let upscaled = false
  if (Math.min(image.width, image.height) >= 16) {
    const resolution = effectiveResolution(image)
    effective = resolution.effective
    const certifiedLong = Math.max(resolution.certifiedUpTo.w, resolution.certifiedUpTo.h)
    const effectiveLong = Math.max(effective.w, effective.h)
    upscaled = effectiveLong < UPSCALE_RATIO_MAX * certifiedLong
    evidence.push(
      upscaled
        ? `effective resolution ${effective.w}x${effective.h}: upscaled past its real detail`
        : `spectral cutoff consistent with detail up to ${effective.w}x${effective.h}`,
    )
  } else {
    evidence.push('image too small for spectral resolution analysis')
  }

  const softness = measureSoftness(image)
  evidence.push(
    `softness p95 laplacian ${softness.p95Laplacian.toFixed(1)} ` +
      `(${Math.max(image.width, image.height) > LAPLACIAN_NATIVE_LIMIT ? 'normalized' : 'native'} ` +
      `regime): ${softness.verdict}`,
  )

  const { headroom, reasons } = resolveHeadroom({
    container,
    generations: jpeg.generations,
    estimatedOriginalQuality: jpeg.estimatedOriginalQuality,
    blockingScore: blockingRecord,
  })
  evidence.push(`headroom ${headroom}: ${reasons.join('; ')}`)

  return {
    container,
    estimatedOriginalQuality: jpeg.estimatedOriginalQuality,
    encoderFingerprint: jpeg.encoderFingerprint,
    generations: jpeg.generations,
    chromaSubsampling: jpeg.chromaSubsampling,
    declaredResolution: { w: image.width, h: image.height },
    effectiveResolution: effective,
    upscaled,
    blockingScore: blockingRecord,
    softness,
    headroom,
    evidence,
  }
}

/**
 * Runs laplacianSharpness inside its documented domain (at least 3x3, and
 * an aspect ratio that does not collapse below 3px when the long edge is
 * normalized to 1024; see laplacian.ts). Out-of-domain images are honestly
 * 'unknown' rather than a thrown error, because a provenance record must
 * exist for every decodable input.
 */
function measureSoftness(image: RawImage): ProvenanceRecord['softness'] {
  const { width, height } = image
  const long = Math.max(width, height)
  const scale = long > LAPLACIAN_NATIVE_LIMIT ? LAPLACIAN_NATIVE_LIMIT / long : 1
  const normWidth = Math.max(1, Math.round(width * scale))
  const normHeight = Math.max(1, Math.round(height * scale))
  if (Math.min(normWidth, normHeight) < 3) {
    return { p95Laplacian: 0, verdict: 'unknown' }
  }
  const { p95 } = laplacianSharpness(image)
  return { p95Laplacian: p95, verdict: softnessVerdict(p95, long) }
}
