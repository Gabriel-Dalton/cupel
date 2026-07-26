import type { LedgerEntryV1, RawImage } from '@cupel/core'
import type { CodecFormat } from '@cupel/codecs-wasm'

/**
 * Shared shapes for the /verify pipeline: parse the ledger, hash the
 * provided files, match files to entries, re-measure, report.
 *
 * Everything here is platform pure and runs identically under vitest in
 * Node and in the browser page; the only platform edge is the DecodeFn the
 * caller injects.
 */

/** One successfully parsed ledger line. Line numbers are 1-based. */
export type ParsedLine = { line: number; entry: LedgerEntryV1 }

/** One line the tolerant parser refused, and why. */
export type SkippedLine = { line: number; reason: string }

export type ParsedLedger = { entries: ParsedLine[]; skipped: SkippedLine[] }

/** A user-provided file, content addressed the same way the ledger is. */
export type VerifyFile = {
  name: string
  /** 'sha256:<lowercase hex>' over the raw file bytes. */
  hash: string
  bytes: Uint8Array
}

/**
 * How an entry relates to the provided files.
 * - verifiable: encoded entry, output and source both present by hash.
 * - reference-missing: encoded entry, output present, but the source needed
 *   to re-derive the reference is not.
 * - file-missing: encoded entry whose output bytes were not provided.
 * - not-applicable: kept / refused / skipped entries. Their claim is that
 *   the file was NOT changed, so they verify by hash alone, without
 *   re-measurement.
 */
export type Classification = 'verifiable' | 'reference-missing' | 'not-applicable' | 'file-missing'

export type Verdict = 'pass' | 'fail' | 'unverifiable'

export type MetricName = 'ssim' | 'deltaE' | 'distortion'

export type MetricComparison = {
  metric: MetricName
  recorded: number
  measured: number
  tolerance: number
  withinTolerance: boolean
}

/**
 * Decodes shipped bytes to pixels. The page injects the @cupel/codecs-wasm
 * decoders; tests inject either the same wasm builds or a fake.
 */
export type DecodeFn = (format: CodecFormat, bytes: Uint8Array) => Promise<RawImage>

export type Remeasurement = {
  verdict: Verdict
  notes: string[]
  metrics: MetricComparison[] | null
  /** Whether the re-derived reference hashes to the recorded reference. */
  referenceHashMatch: boolean | null
}

export type MatchResult = {
  classification: Classification
  /** File whose bytes hash to the recorded outputHash, when present. */
  output: VerifyFile | null
  /** File whose bytes hash to the recorded sourceHash, when present. */
  source: VerifyFile | null
  /** Verdict decided by hashing alone; null when re-measurement must decide. */
  verdict: Verdict | null
  notes: string[]
}

export type EntryReport = {
  line: number
  entry: LedgerEntryV1
  classification: Classification
  verdict: Verdict
  notes: string[]
  metrics: MetricComparison[] | null
  referenceHashMatch: boolean | null
}

export type VerifySummary = {
  entries: number
  pass: number
  fail: number
  unverifiable: number
  skippedLines: number
}

export type VerifyReport = { reports: EntryReport[]; summary: VerifySummary }
