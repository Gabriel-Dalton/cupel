import type { Container } from '@cupel/core'
import type { DemoResult, SampleKind } from './pipeline'

/**
 * Message contract between the landing page demo and its worker. Types only;
 * both sides import from here so the contract cannot drift.
 */

/** Build the three sample files so the picker can show real thumbnails. */
export type BuildSamplesRequest = { type: 'samples' }

/** Run the real pipeline over one file. */
export type RunRequest = {
  type: 'run'
  bytes: ArrayBuffer
  container: Container
}

export type DemoRequest = BuildSamplesRequest | RunRequest

export type SamplesReadyMessage = {
  type: 'samples'
  items: { kind: SampleKind; container: Container; bytes: ArrayBuffer }[]
  /**
   * True when the samples were built from committed photographs rather than the
   * drawn fallback scenes. The page says which, so it never calls arithmetic a
   * photograph.
   */
  photographed: boolean
}

export type ProgressMessage = { type: 'progress'; done: number; total: number }

/**
 * The verdict. `outputBytes` is transferred rather than copied, and is null
 * whenever cupel decided not to encode, which is a real outcome and not a
 * missing value.
 */
export type ResultMessage = {
  type: 'result'
  result: Omit<DemoResult, 'outputBytes'>
  outputBytes: ArrayBuffer | null
  elapsedMs: number
}

/** Something could not be read at all. Always says why. */
export type FailureMessage = { type: 'failure'; message: string }

export type DemoResponse = SamplesReadyMessage | ProgressMessage | ResultMessage | FailureMessage
