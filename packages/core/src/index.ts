export type { RawImage, OutputFormat, EncodeOptions, Encoder } from './types.js'
export { ENCODER_DEFAULT_QUALITY } from './types.js'

export { ssim } from './metrics/ssim.js'
export { deltaE, type DeltaEResult } from './metrics/deltae.js'
export { laplacianSharpness, type LaplacianResult } from './metrics/laplacian.js'
export { blockingScore, type BlockingResult } from './metrics/blocking.js'
export {
  radialPowerSpectrum,
  effectiveResolution,
  type EffectiveResolutionResult,
} from './metrics/spectrum.js'

export type {
  CandidatePoint,
  FloorConfig,
  WeightInputs,
  AllocationImage,
  AllocateOptions,
  AllocateResult,
} from './rd/types.js'
export type {
  ProvenanceRecord,
  Container,
  ChromaSubsampling,
  Headroom,
} from './provenance/types.js'
export type { LedgerEntryV1, LedgerDecision } from './ledger.js'
export type { DiscoveredAsset, AssetRole } from './assets.js'

export {
  ANNEX_K_CHROMA,
  ANNEX_K_LUMA,
  JPEG_ZIGZAG,
  LIBJPEG_FAMILY,
  estimateJpegQuality,
  parseJpeg,
  scaleQuantTable,
  selectQuantTables,
  type JpegComponent,
  type JpegInfo,
  type JpegQualityEstimate,
  type JpegQuantTable,
  type QuantTableFamily,
  type SelectedQuantTables,
} from './provenance/jpeg-dqt.js'
export {
  FINGERPRINT_REGISTRY,
  MOZJPEG_FAMILY,
  identifyEncoder,
  quantSignature,
  type FingerprintEntry,
  type FingerprintMatch,
} from './provenance/fingerprints.js'
export {
  detectDoubleQuantization,
  forwardDct8x8,
  inverseDct8x8,
  type DoubleQuantBand,
  type DoubleQuantResult,
} from './provenance/double-quant.js'
export {
  analyzeProvenance,
  resolveHeadroom,
  softnessVerdict,
  type HeadroomInputs,
  type ProvenanceInput,
} from './provenance/headroom.js'

export { distortion, CIE76_JND_DELTA_E, DEFAULT_KAPPA } from './rd/distortion.js'
export { lowerConvexHull } from './rd/hull.js'
export {
  visualWeight,
  viewportFactorAtDepth,
  roleFactorFor,
  DEFAULT_AREA_EXPONENT,
} from './rd/weight.js'
export { allocate, applyFloor, DEFAULT_FLOORS } from './rd/allocate.js'
