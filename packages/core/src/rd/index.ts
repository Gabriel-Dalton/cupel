export { distortion, CIE76_JND_DELTA_E, DEFAULT_KAPPA } from './distortion.js'
export { lowerConvexHull } from './hull.js'
export {
  visualWeight,
  viewportFactorAtDepth,
  roleFactorFor,
  DEFAULT_AREA_EXPONENT,
} from './weight.js'
export { allocate, applyFloor, DEFAULT_FLOORS } from './allocate.js'
export type {
  CandidatePoint,
  FloorConfig,
  WeightInputs,
  AllocationImage,
  AllocateOptions,
  AllocateResult,
} from './types.js'
