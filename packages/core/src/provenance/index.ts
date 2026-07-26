export type { ChromaSubsampling, Container, Headroom, ProvenanceRecord } from './types.js'
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
} from './jpeg-dqt.js'
export {
  FINGERPRINT_REGISTRY,
  MOZJPEG_FAMILY,
  identifyEncoder,
  quantSignature,
  type FingerprintEntry,
  type FingerprintMatch,
} from './fingerprints.js'
export {
  detectDoubleQuantization,
  forwardDct8x8,
  inverseDct8x8,
  type DoubleQuantBand,
  type DoubleQuantResult,
} from './double-quant.js'
export {
  analyzeProvenance,
  resolveHeadroom,
  softnessVerdict,
  type HeadroomInputs,
  type ProvenanceInput,
} from './headroom.js'
