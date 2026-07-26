import type { LedgerEntryV1 } from '@cupel/core'
import type { MatchResult, VerifyFile } from './types'

/**
 * Matching provided files to ledger entries.
 *
 * Content hash is the identity: a file matches an entry because its bytes
 * hash to what the entry recorded, never because of what it is called.
 * File names are used for exactly one thing: catching the failure case
 * where a file carries the asset's name but the wrong bytes, which is the
 * difference between "you did not give me the file" (unverifiable) and
 * "the file you gave me is not what the receipt describes" (refuted).
 */

/** Final path segment of a repo-relative asset path, either separator. */
export function assetBasename(assetPath: string): string {
  const segments = assetPath.split(/[\\/]/)
  return segments[segments.length - 1] ?? assetPath
}

export function matchEntry(entry: LedgerEntryV1, files: readonly VerifyFile[]): MatchResult {
  const byHash = (hash: string | null): VerifyFile | null =>
    hash === null ? null : (files.find((f) => f.hash === hash) ?? null)
  const wantedName = assetBasename(entry.asset).toLowerCase()
  const byName = files.find((f) => f.name.toLowerCase() === wantedName) ?? null
  const source = byHash(entry.sourceHash)

  if (entry.decision === 'encoded') {
    const output = byHash(entry.outputHash)
    if (output) {
      if (source) {
        return { classification: 'verifiable', output, source, verdict: null, notes: [] }
      }
      return {
        classification: 'reference-missing',
        output,
        source: null,
        verdict: 'unverifiable',
        notes: [
          'The provided bytes hash to the recorded output, so the shipped file itself is confirmed.',
          'The source file needed to re-derive the reference was not provided, so the recorded quality numbers stay unverified.',
        ],
      }
    }
    if (byName) {
      if (byName.hash === entry.sourceHash) {
        return {
          classification: 'file-missing',
          output: null,
          source,
          verdict: 'fail',
          notes: [
            `${byName.name} carries this asset's name but its bytes hash to the recorded source, not the recorded output.`,
            'The optimized output this receipt describes was not among the provided files.',
          ],
        }
      }
      return {
        classification: 'file-missing',
        output: null,
        source,
        verdict: 'fail',
        notes: [
          `${byName.name} carries this asset's name but its bytes do not hash to anything this receipt recorded.`,
          `Expected output ${entry.outputHash ?? '(none recorded)'}, got ${byName.hash}.`,
        ],
      }
    }
    return {
      classification: 'file-missing',
      output: null,
      source,
      verdict: 'unverifiable',
      notes: ['No provided file hashes to the recorded output, and none carries the asset name.'],
    }
  }

  // kept / refused / skipped: the receipt's claim is that the file was NOT
  // changed, so the whole verification is one hash comparison.
  if (source) {
    return {
      classification: 'not-applicable',
      output: null,
      source,
      verdict: 'pass',
      notes: [
        `The receipt says this file was ${entry.decision} and left untouched; the provided bytes still hash to the recorded source.`,
      ],
    }
  }
  if (byName) {
    return {
      classification: 'not-applicable',
      output: null,
      source: null,
      verdict: 'fail',
      notes: [
        `The receipt says this file was ${entry.decision} and left untouched, but ${byName.name} no longer hashes to the recorded source.`,
        `Expected ${entry.sourceHash}, got ${byName.hash}.`,
      ],
    }
  }
  return {
    classification: 'not-applicable',
    output: null,
    source: null,
    verdict: 'unverifiable',
    notes: ['No provided file hashes to the recorded source, and none carries the asset name.'],
  }
}
