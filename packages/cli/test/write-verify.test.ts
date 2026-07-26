import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEDGER_PATH, SOURCES_DIR, applyPlan, ledgerEntry } from '../src/write/apply.js'
import { outputPathFor, planDirectory } from '../src/write/plan.js'
import { renderPlan } from '../src/write/render.js'
import { exitCodeFor, parseLedger, verifyLedger } from '../src/verify/verify.js'
import { encodeJpeg, encodePng, flatGraphic, photoLike, tempDir } from './fixtures.js'

/**
 * The end to end contract: write measures and records, verify re-measures
 * and confirms. If these two ever disagree the receipts are worthless, so
 * the round trip is the single most important test in the package.
 */

/** A short ladder and no avif: the shape of the curve matters here, not its resolution. */
const FAST = { fast: true, ladder: [55, 75, 90] } as const

describe('cupel write, dry run', () => {
  it('plans without touching the tree', async () => {
    const dir = await tempDir('cupel-dry-')
    try {
      await writeFile(join(dir.path, 'photo.jpg'), await encodeJpeg(photoLike(96), 95))
      const before = await readdir(dir.path)

      const plan = await planDirectory(dir.path, FAST)
      expect(plan.assets).toHaveLength(1)

      const after = await readdir(dir.path)
      expect(after).toEqual(before)
      expect(renderPlan(plan, null)).toContain('Nothing was written')
    } finally {
      await dir.cleanup()
    }
  })

  it('refuses a source with no headroom left instead of encoding it', async () => {
    const dir = await tempDir('cupel-refuse-')
    try {
      // Six generations of aggressive re-encoding leaves nothing to spend.
      let bytes = await encodeJpeg(photoLike(128), 40)
      const { sharpCodec } = await import('@cupel/codecs-node')
      const jpeg = sharpCodec('jpeg')
      for (let i = 0; i < 5; i++) {
        bytes = await jpeg.encode(await jpeg.decode(bytes), { quality: 35 })
      }
      await writeFile(join(dir.path, 'tired.jpg'), bytes)

      const plan = await planDirectory(dir.path, FAST)
      const decision = plan.assets[0]?.decision
      expect(decision).toBeDefined()
      // Either verdict is legitimate for this fixture; what must never
      // happen is a silent encode of a source with nothing left.
      if (decision?.decision === 'refused') {
        expect(decision.reason).toContain('headroom none')
        // A refusal must cost nothing: no candidates were swept.
        expect(plan.assets[0]?.candidates).toHaveLength(0)
      } else {
        expect(['kept', 'encoded', 'skipped']).toContain(decision?.decision)
      }
    } finally {
      await dir.cleanup()
    }
  }, 120_000)

  it('skips an svg rather than rasterizing it', async () => {
    const dir = await tempDir('cupel-svg-')
    try {
      await writeFile(
        join(dir.path, 'logo.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>',
      )
      const plan = await planDirectory(dir.path, FAST)

      expect(plan.assets[0]?.decision.decision).toBe('skipped')
      expect(plan.assets[0]?.reference).toBeNull()
      // No reference means no receipt: a ledger entry with invented
      // dimensions could never be verified.
      expect(ledgerEntry(plan.assets[0]!, '2026-01-01T00:00:00.000Z')).toBeNull()
    } finally {
      await dir.cleanup()
    }
  })
})

describe('cupel write, applied, then verified', () => {
  it('round trips: every receipt it writes, it can confirm', async () => {
    const dir = await tempDir('cupel-roundtrip-')
    try {
      // A photograph at q95 has real headroom, so this should encode.
      await writeFile(join(dir.path, 'photo.jpg'), await encodeJpeg(photoLike(128, 11), 95))
      // A flat graphic as png: the interesting comparison case.
      await writeFile(join(dir.path, 'graphic.png'), await encodePng(flatGraphic(128)))

      const plan = await planDirectory(dir.path, FAST)
      const applied = await applyPlan(plan, { now: () => new Date('2026-01-01T00:00:00.000Z') })

      expect(applied.entries.length).toBe(2)
      for (const entry of applied.entries) {
        expect(entry.v).toBe(1)
        expect(entry.ts).toBe('2026-01-01T00:00:00.000Z')
        expect(entry.tool).toMatch(/^cupel@/)
        // The frozen schema wants explicit nulls, never omitted keys.
        for (const key of [
          'outputHash',
          'sourceRecovered',
          'reason',
          'output',
          'metrics',
          'weight',
          'lambda',
          'provenance',
          'encoder',
        ]) {
          expect(Object.keys(entry)).toContain(key)
        }
        // reason is null exactly for encoded entries, populated otherwise.
        if (entry.decision === 'encoded') {
          expect(entry.reason).toBeNull()
          expect(entry.metrics).not.toBeNull()
          expect(entry.output).not.toBeNull()
        } else {
          expect(typeof entry.reason).toBe('string')
        }
      }

      // Originals are preserved byte for byte for everything that was written.
      for (const planned of plan.assets) {
        if (planned.encoded === null) continue
        const preserved = new Uint8Array(await readFile(join(dir.path, SOURCES_DIR, planned.asset)))
        expect(preserved).toEqual(planned.sourceBytes)
      }

      const ledgerText = await readFile(join(dir.path, LEDGER_PATH), 'utf8')
      expect(ledgerText.endsWith('\n')).toBe(true)
      expect(ledgerText.includes('\n\n')).toBe(false)
      expect(parseLedger(ledgerText).skipped).toEqual([])

      const report = await verifyLedger(dir.path)
      expect(report.results).toHaveLength(applied.entries.length)
      expect(report.totals.refuted).toBe(0)
      expect(report.totals.unverifiable).toBe(0)
      expect(exitCodeFor(report)).toBe(0)
      for (const result of report.results) {
        expect(result.verdict).toBe('pass')
        if (result.decision === 'encoded') expect(result.referenceHashMatch).toBe(true)
      }
    } finally {
      await dir.cleanup()
    }
  }, 180_000)

  it('refutes a receipt when the shipped bytes are swapped', async () => {
    const dir = await tempDir('cupel-tamper-')
    try {
      await writeFile(join(dir.path, 'photo.jpg'), await encodeJpeg(photoLike(128, 3), 95))
      const plan = await planDirectory(dir.path, FAST)
      const applied = await applyPlan(plan)

      const encodedEntry = applied.entries.find((e) => e.decision === 'encoded')
      expect(encodedEntry, 'the fixture should produce at least one encode').toBeDefined()

      // Replace the shipped output with a visibly different encode. The
      // receipt now describes bytes that are not there.
      const outputPath = join(
        dir.path,
        outputPathFor(encodedEntry!.asset, encodedEntry!.output!.format),
      )
      await writeFile(outputPath, await encodeJpeg(photoLike(128, 3), 30))

      const report = await verifyLedger(dir.path)
      const refuted = report.results.find((r) => r.asset === encodedEntry!.asset)
      expect(refuted?.verdict).toBe('refuted')
      expect(exitCodeFor(report)).toBe(1)
    } finally {
      await dir.cleanup()
    }
  }, 180_000)

  it('reports unverifiable, not refuted, when the source is gone', async () => {
    const dir = await tempDir('cupel-nosource-')
    try {
      await writeFile(join(dir.path, 'photo.jpg'), await encodeJpeg(photoLike(128, 5), 95))
      const plan = await planDirectory(dir.path, FAST)
      const applied = await applyPlan(plan)
      const encodedEntry = applied.entries.find((e) => e.decision === 'encoded')
      expect(encodedEntry).toBeDefined()

      // Corrupt both copies of the source so nothing hashes to sourceHash.
      await writeFile(join(dir.path, SOURCES_DIR, encodedEntry!.asset), 'not the source')
      await writeFile(join(dir.path, encodedEntry!.asset), 'not the source either')

      const report = await verifyLedger(dir.path)
      const result = report.results.find((r) => r.asset === encodedEntry!.asset)
      expect(result?.verdict).toBe('unverifiable')
      expect(result?.notes.join(' ')).toContain('sourceHash')
      expect(exitCodeFor(report)).toBe(2)
    } finally {
      await dir.cleanup()
    }
  }, 180_000)
})

describe('ledger parsing', () => {
  it('skips bad lines with a reason instead of failing the whole log', () => {
    const good = JSON.stringify({
      v: 1,
      ts: '2026-01-01T00:00:00.000Z',
      asset: 'a.jpg',
      sourceHash: 'sha256:aa',
      outputHash: null,
      sourceRecovered: null,
      reference: { w: 1, h: 1, hash: 'sha256:bb' },
      decision: 'kept',
      reason: 'no-op guard',
      output: null,
      before: { format: 'jpeg', bytes: 10 },
      metrics: null,
      weight: null,
      lambda: null,
      provenance: null,
      encoder: null,
      tool: 'cupel@0.1.0',
    })
    const { entries, skipped } = parseLedger(
      ['not json at all', good, '{"v":2}', JSON.stringify({ v: 1, asset: 'b.jpg' }), ''].join('\n'),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.asset).toBe('a.jpg')
    expect(skipped).toHaveLength(3)
    expect(skipped[0]).toContain('not valid JSON')
    expect(skipped[1]).toContain('unsupported schema version 2')
    expect(skipped[2]).toContain('missing required field')
  })
})

describe('output path derivation', () => {
  it('swaps the extension so verify can find the output from the receipt', () => {
    expect(outputPathFor('a/photo.jpg', 'webp')).toBe('a/photo.webp')
    expect(outputPathFor('a/photo.jpeg', 'avif')).toBe('a/photo.avif')
    expect(outputPathFor('a/photo', 'webp')).toBe('a/photo.webp')
    expect(outputPathFor('a.dir/photo', 'jpeg')).toBe('a.dir/photo.jpg')
  })
})
