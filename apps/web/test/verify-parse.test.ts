import { describe, expect, it } from 'vitest'
import type { LedgerEntryV1 } from '@cupel/core'
import { parseLedger, validateEntry } from '../lib/verify/parse'

/**
 * A fully populated, valid v1 entry. Tests override individual fields to
 * probe one validation rule at a time. Built in code, never pasted from a
 * real ledger, so the fixture stays deterministic and binary free.
 */
function makeEntry(overrides: Partial<LedgerEntryV1> = {}): LedgerEntryV1 {
  return {
    v: 1,
    ts: '2026-07-25T18:04:11Z',
    asset: 'public/img/hero.jpg',
    sourceHash: `sha256:${'a'.repeat(64)}`,
    outputHash: `sha256:${'b'.repeat(64)}`,
    sourceRecovered: null,
    reference: { w: 64, h: 48, hash: `sha256:${'c'.repeat(64)}` },
    decision: 'encoded',
    reason: null,
    output: { format: 'jpeg', quality: 75, bytes: 4120 },
    before: { format: 'png', bytes: 31844 },
    metrics: { ssim: 0.9931, deltaE: 0.71, distortion: 0.00844 },
    weight: 41.2,
    lambda: 3.1e-7,
    provenance: { generations: 1, estimatedOriginalQuality: 84, headroom: 'normal' },
    encoder: 'mozjpeg via @jsquash/jpeg@1.6.0',
    tool: 'cupel@0.0.0',
    ...overrides,
  }
}

function keptEntry(): LedgerEntryV1 {
  return makeEntry({
    decision: 'kept',
    reason: 'no candidate beat the original',
    outputHash: null,
    output: null,
    metrics: null,
    weight: null,
    lambda: null,
    provenance: null,
    encoder: null,
  })
}

describe('parseLedger', () => {
  it('parses one valid entry per line and reports line numbers', () => {
    const text = [JSON.stringify(makeEntry()), JSON.stringify(keptEntry())].join('\n')
    const parsed = parseLedger(text)
    expect(parsed.skipped).toEqual([])
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0]?.line).toBe(1)
    expect(parsed.entries[1]?.line).toBe(2)
    expect(parsed.entries[0]?.entry.decision).toBe('encoded')
    expect(parsed.entries[1]?.entry.decision).toBe('kept')
  })

  it('skips blank and whitespace-only lines silently', () => {
    const text = `\n${JSON.stringify(makeEntry())}\n   \n\n`
    const parsed = parseLedger(text)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]?.line).toBe(2)
    expect(parsed.skipped).toEqual([])
  })

  it('tolerates CRLF line endings', () => {
    const text = `${JSON.stringify(makeEntry())}\r\n${JSON.stringify(keptEntry())}\r\n`
    const parsed = parseLedger(text)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.skipped).toEqual([])
  })

  it('skips malformed JSON with a report and keeps parsing later lines', () => {
    const text = [JSON.stringify(makeEntry()), '{ this is not json', JSON.stringify(keptEntry())].join(
      '\n',
    )
    const parsed = parseLedger(text)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.skipped).toHaveLength(1)
    expect(parsed.skipped[0]?.line).toBe(2)
    expect(parsed.skipped[0]?.reason).toMatch(/JSON/i)
  })

  it('skips entries with the wrong version', () => {
    const bad = { ...makeEntry(), v: 2 }
    const parsed = parseLedger(JSON.stringify(bad))
    expect(parsed.entries).toEqual([])
    expect(parsed.skipped[0]?.reason).toMatch(/v/)
  })

  it('skips encoded entries that record no metrics', () => {
    const bad = { ...makeEntry(), metrics: null }
    const parsed = parseLedger(JSON.stringify(bad))
    expect(parsed.entries).toEqual([])
    expect(parsed.skipped[0]?.reason).toMatch(/metrics/)
  })

  it('accepts unknown extra fields for forward compatibility', () => {
    const extended = { ...makeEntry(), signature: 'minisign:abc' }
    const parsed = parseLedger(JSON.stringify(extended))
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.skipped).toEqual([])
  })
})

describe('validateEntry', () => {
  it('rejects non-objects', () => {
    for (const value of [null, 42, 'entry', [], true]) {
      const result = validateEntry(value)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects a bad decision value', () => {
    const result = validateEntry({ ...makeEntry(), decision: 'shipped' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/decision/)
  })

  it('rejects a reference with non-integer dimensions', () => {
    const entry = makeEntry()
    const result = validateEntry({ ...entry, reference: { ...entry.reference, w: 64.5 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/reference/)
  })

  it('rejects non-finite metric values', () => {
    const result = validateEntry({
      ...makeEntry(),
      metrics: { ssim: Number.NaN, deltaE: 0.5, distortion: 0.01 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/metrics/)
  })

  it('accepts a kept entry whose nullable fields are all null', () => {
    const result = validateEntry(keptEntry())
    expect(result.ok).toBe(true)
  })
})
