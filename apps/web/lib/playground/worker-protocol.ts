import type { CandidatePoint } from '@cupel/core'
import type { SniffedContainer } from './ingest'

/**
 * The message contract between the playground page and its sweep worker.
 * Types only; both sides import from here so the contract cannot drift.
 *
 * One worker runs one sweep. Cancellation is Worker.terminate(), which also
 * abandons any in-flight wasm encode, so there is no cancel message.
 */

/** Main thread to worker: the dropped file's bytes, transferred. */
export type SweepRequest = {
  type: 'sweep'
  bytes: ArrayBuffer
}

/** First response: the file decoded and the reference is prepared. */
export type DecodedMessage = {
  type: 'decoded'
  container: SniffedContainer
  /** The dropped file as decoded: pixel dimensions and file bytes. */
  source: { width: number; height: number; bytes: number }
  /** The measurement reference after flattening and the edge cap. */
  reference: { width: number; height: number }
  /** True when transparency was composited onto white before measuring. */
  flattened: boolean
  /** True when the reference was downscaled to the documented cap. */
  downscaled: boolean
  /** Number of point messages (or step errors) that will follow. */
  totalSteps: number
}

/** One measured candidate. Streams in as the curve fills. */
export type PointMessage = {
  type: 'point'
  index: number
  label: string
  point: CandidatePoint
  /** Wall clock encode time in this browser, milliseconds. */
  encodeMs: number
  /**
   * The actual encoded file, transferred, so the compare view shows the
   * real bytes. Null for the keep-original anchor: its file is the one the
   * visitor dropped.
   */
  encoded: ArrayBuffer | null
}

/** One candidate failed to encode or measure. The sweep continues. */
export type StepErrorMessage = {
  type: 'step-error'
  index: number
  label: string
  message: string
}

export type DoneMessage = {
  type: 'done'
  elapsedMs: number
}

/**
 * The sweep will not run: unsupported container, undecodable bytes. A
 * refusal is a first class result, not an error, and it always says why.
 */
export type RefusalMessage = {
  type: 'refusal'
  message: string
}

export type SweepResponse =
  | DecodedMessage
  | PointMessage
  | StepErrorMessage
  | DoneMessage
  | RefusalMessage
