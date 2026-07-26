/**
 * The receipts. One JSON Lines entry per asset decision, committed to the
 * repo at .cupel/ledger.jsonl. `cupel verify` re-reads shipped bytes,
 * re-derives the reference, recomputes the metrics, and confirms these
 * numbers: verification re-measures, it never re-encodes, which sidesteps
 * encoder determinism entirely.
 *
 * Types only for now; the writer lands in M6. Signing (minisign/sigstore)
 * is a v2 hook: v1 ships content addressed and unsigned.
 */

export type LedgerDecision = 'encoded' | 'kept' | 'refused' | 'skipped'

export type LedgerEntryV1 = {
  v: 1
  /** ISO 8601 UTC. */
  ts: string
  /** Repo relative asset path. */
  asset: string
  sourceHash: string
  outputHash: string | null
  sourceRecovered: { from: string; via: string } | null
  reference: { w: number; h: number; hash: string }
  decision: LedgerDecision
  /** Populated for kept / refused / skipped. */
  reason: string | null
  output: { format: string; quality: number | null; bytes: number } | null
  before: { format: string; bytes: number }
  metrics: { ssim: number; deltaE: number; distortion: number } | null
  weight: number | null
  lambda: number | null
  provenance: {
    generations: number | null
    estimatedOriginalQuality: number | null
    headroom: 'normal' | 'low' | 'none'
  } | null
  encoder: string | null
  /** e.g. 'cupel@0.3.0'. */
  tool: string
}
