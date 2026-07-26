export type Container = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'svg'

export type ChromaSubsampling = '4:4:4' | '4:2:2' | '4:2:0' | 'none'

export type Headroom = 'normal' | 'low' | 'none'

/**
 * What has already been done to this file. Produced by the provenance
 * module; feeds exactly one field into the compression decision: headroom.
 * Everything here is EVIDENCE with stated uncertainty, never verdict:
 * double quantization detection in particular is noisy by nature and must
 * not alone trigger a refusal.
 */
export type ProvenanceRecord = {
  container: Container
  /** Recovered from JPEG quantization tables, accurate to ~2 points. */
  estimatedOriginalQuality: number | null
  /** 'mozjpeg' | 'adobe-sfw' | 'libjpeg-turbo' | 'apple-isp' | ... */
  encoderFingerprint: string | null
  /** >= 1, from double quantization analysis. null when undetermined. */
  generations: number | null
  chromaSubsampling: ChromaSubsampling | null
  declaredResolution: { w: number; h: number }
  effectiveResolution: { w: number; h: number } | null
  upscaled: boolean
  /** 8x8 boundary energy ratio normalized to 0..1, see metrics/blocking. */
  blockingScore: number
  softness: {
    p95Laplacian: number
    verdict: 'sharp' | 'soft' | 'unknown'
  }
  headroom: Headroom
  /** Human readable reasons. Always populated. */
  evidence: string[]
}
