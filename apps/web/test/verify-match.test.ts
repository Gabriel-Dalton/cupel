import { describe, expect, it } from 'vitest'
import type { LedgerEntryV1 } from '@cupel/core'
import { assetBasename, matchEntry } from '../lib/verify/match'
import type { VerifyFile } from '../lib/verify/types'

// Matching is pure string work over precomputed hashes, so these fixtures
// use synthetic hash strings. Byte-accurate hashing is covered by
// verify-hash.test.ts; the wasm integration test exercises the real thing
// end to end.
const SOURCE_HASH = `sha256:${'a'.repeat(64)}`
const OUTPUT_HASH = `sha256:${'b'.repeat(64)}`
const STRANGER_HASH = `sha256:${'d'.repeat(64)}`

function file(name: string, hash: string): VerifyFile {
  return { name, hash, bytes: new Uint8Array([1]) }
}

function makeEntry(overrides: Partial<LedgerEntryV1> = {}): LedgerEntryV1 {
  return {
    v: 1,
    ts: '2026-07-25T18:04:11Z',
    asset: 'public/img/hero.jpg',
    sourceHash: SOURCE_HASH,
    outputHash: OUTPUT_HASH,
    sourceRecovered: null,
    reference: { w: 64, h: 48, hash: `sha256:${'c'.repeat(64)}` },
    decision: 'encoded',
    reason: null,
    output: { format: 'jpeg', quality: 75, bytes: 4120 },
    before: { format: 'png', bytes: 31844 },
    metrics: { ssim: 0.9931, deltaE: 0.71, distortion: 0.00844 },
    weight: 41.2,
    lambda: 3.1e-7,
    provenance: null,
    encoder: null,
    tool: 'cupel@0.0.0',
    ...overrides,
  }
}

function refusedEntry(): LedgerEntryV1 {
  return makeEntry({
    decision: 'refused',
    reason: 'no quality headroom left',
    outputHash: null,
    output: null,
    metrics: null,
    weight: null,
    lambda: null,
  })
}

describe('assetBasename', () => {
  it('takes the final path segment, tolerating both separators', () => {
    expect(assetBasename('public/img/hero.jpg')).toBe('hero.jpg')
    expect(assetBasename('public\\img\\hero.jpg')).toBe('hero.jpg')
    expect(assetBasename('hero.jpg')).toBe('hero.jpg')
  })
})

describe('matchEntry for encoded entries', () => {
  it('classifies as verifiable when output and source are both present by hash', () => {
    const result = matchEntry(makeEntry(), [
      file('hero.jpg', OUTPUT_HASH),
      file('hero-original.png', SOURCE_HASH),
    ])
    expect(result.classification).toBe('verifiable')
    expect(result.output?.hash).toBe(OUTPUT_HASH)
    expect(result.source?.hash).toBe(SOURCE_HASH)
    // Re-measurement decides the verdict; matching leaves it open.
    expect(result.verdict).toBeNull()
  })

  it('matches by content hash, not by file name', () => {
    const result = matchEntry(makeEntry(), [
      file('renamed-beyond-recognition.bin', OUTPUT_HASH),
      file('also-renamed.bin', SOURCE_HASH),
    ])
    expect(result.classification).toBe('verifiable')
  })

  it('classifies as reference-missing when only the output is present', () => {
    const result = matchEntry(makeEntry(), [file('hero.jpg', OUTPUT_HASH)])
    expect(result.classification).toBe('reference-missing')
    expect(result.verdict).toBe('unverifiable')
    expect(result.notes.join(' ')).toMatch(/source/i)
  })

  it('fails on a name-matched file whose bytes hash to neither recorded hash', () => {
    const result = matchEntry(makeEntry(), [file('hero.jpg', STRANGER_HASH)])
    expect(result.verdict).toBe('fail')
    expect(result.notes.join(' ')).toMatch(/hash/i)
  })

  it('fails, with a distinct explanation, when the name-matched file is the recorded source', () => {
    const result = matchEntry(makeEntry(), [file('hero.jpg', SOURCE_HASH)])
    expect(result.verdict).toBe('fail')
    expect(result.notes.join(' ')).toMatch(/source/i)
  })

  it('classifies as file-missing when nothing matches by hash or name', () => {
    const result = matchEntry(makeEntry(), [file('unrelated.png', STRANGER_HASH)])
    expect(result.classification).toBe('file-missing')
    expect(result.verdict).toBe('unverifiable')
  })
})

describe('matchEntry for kept, refused, and skipped entries', () => {
  it('passes when the file still hashes to the recorded source', () => {
    const result = matchEntry(refusedEntry(), [file('hero.jpg', SOURCE_HASH)])
    expect(result.classification).toBe('not-applicable')
    expect(result.verdict).toBe('pass')
  })

  it('confirms the unchanged claim by hash even under a different name', () => {
    const result = matchEntry(refusedEntry(), [file('any-name-at-all.jpg', SOURCE_HASH)])
    expect(result.verdict).toBe('pass')
  })

  it('fails when a name-matched file no longer hashes to the recorded source', () => {
    const result = matchEntry(refusedEntry(), [file('hero.jpg', STRANGER_HASH)])
    expect(result.classification).toBe('not-applicable')
    expect(result.verdict).toBe('fail')
    expect(result.notes.join(' ')).toMatch(/refused/)
  })

  it('is unverifiable when the file is absent entirely', () => {
    const result = matchEntry(refusedEntry(), [])
    expect(result.verdict).toBe('unverifiable')
  })
})
