// End-to-end verification against the real wasm codecs, in Node. The test
// plays the M6 writer's part: it generates a seeded image, encodes it, and
// writes the ledger entry itself (hashes and metrics computed by the same
// shipped code), then hands the bytes to the verify pipeline exactly as the
// browser page does. No binary fixtures: every byte is produced here.
//
// The wasm builds cannot self-load in plain Node, so the modules are read
// from the @jsquash packages installed under packages/codecs-wasm and handed
// to wasmCodec precompiled, the same injection path the adapter tests use.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deltaE, distortion, ssim } from '@cupel/core'
import type { Encoder, LedgerEntryV1, RawImage } from '@cupel/core'
import { wasmCodec } from '@cupel/codecs-wasm'
import type { CodecFormat } from '@cupel/codecs-wasm'
import { hashRawImage, sha256Hex } from '../lib/verify/hash'
import { deriveReference } from '../lib/verify/measure'
import { parseLedger } from '../lib/verify/parse'
import type { DecodeFn, VerifyFile } from '../lib/verify/types'
import { verifyLedger } from '../lib/verify/verify'

const LONG = 120_000

// ---------------------------------------------------------------------------
// Codec plumbing
// ---------------------------------------------------------------------------

const WASM_PATHS: Partial<Record<CodecFormat, { encode: string; decode: string }>> = {
  jpeg: { encode: 'codec/enc/mozjpeg_enc.wasm', decode: 'codec/dec/mozjpeg_dec.wasm' },
  png: { encode: 'codec/pkg/squoosh_png_bg.wasm', decode: 'codec/pkg/squoosh_png_bg.wasm' },
}

async function compileWasm(format: string, rel: string): Promise<WebAssembly.Module> {
  const url = new URL(
    `../../../packages/codecs-wasm/node_modules/@jsquash/${format}/${rel}`,
    import.meta.url,
  )
  return WebAssembly.compile(await readFile(fileURLToPath(url)))
}

const codecCache = new Map<CodecFormat, Promise<Encoder>>()

function codec(format: CodecFormat): Promise<Encoder> {
  let cached = codecCache.get(format)
  if (!cached) {
    cached = (async () => {
      const paths = WASM_PATHS[format]
      if (!paths) throw new Error(`no wasm paths configured for ${format}`)
      return wasmCodec(format, {
        encode: await compileWasm(format, paths.encode),
        decode: await compileWasm(format, paths.decode),
      })
    })()
    codecCache.set(format, cached)
  }
  return cached
}

const decode: DecodeFn = async (format, bytes) => (await codec(format)).decode(bytes)

// ---------------------------------------------------------------------------
// Seeded fixture image
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sourceImage(size = 96, seed = 0xbead): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const texture = (rand() - 0.5) * 30
      data[o] = (x / (size - 1)) * 210 + texture
      data[o + 1] = 60 + (y / (size - 1)) * 160 + texture
      data[o + 2] = 200 - (x / (size - 1)) * 120 + texture
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

// ---------------------------------------------------------------------------
// The writer's part: build bytes and a matching ledger entry
// ---------------------------------------------------------------------------

type Fixture = {
  entry: LedgerEntryV1
  outputBytes: Uint8Array
  sourceBytes: Uint8Array
}

async function buildFixture(referenceSize: number, quality: number): Promise<Fixture> {
  const src = sourceImage()
  const png = await codec('png')
  const jpeg = await codec('jpeg')

  // PNG is lossless, so the decoded source is pixel-identical to src and the
  // reference derivation below sees exactly the pixels the writer saw.
  const sourceBytes = await png.encode(src, {})
  const ref = deriveReference(src, { w: referenceSize, h: referenceSize })
  if (!ref) throw new Error('fixture reference derivation failed')

  const outputBytes = await jpeg.encode(ref, { quality })
  const out = await jpeg.decode(outputBytes)
  const s = ssim(ref, out)
  const dE = deltaE(ref, out).mean

  const entry: LedgerEntryV1 = {
    v: 1,
    ts: '2026-07-25T18:04:11Z',
    asset: 'public/img/hero.jpg',
    sourceHash: await sha256Hex(sourceBytes),
    outputHash: await sha256Hex(outputBytes),
    sourceRecovered: null,
    reference: { w: ref.width, h: ref.height, hash: await hashRawImage(ref) },
    decision: 'encoded',
    reason: null,
    output: { format: 'jpeg', quality, bytes: outputBytes.length },
    before: { format: 'png', bytes: sourceBytes.length },
    metrics: { ssim: s, deltaE: dE, distortion: distortion(s, dE) },
    weight: null,
    lambda: null,
    provenance: null,
    encoder: 'mozjpeg via @jsquash/jpeg',
    tool: 'cupel@0.0.0',
  }
  return { entry, outputBytes, sourceBytes }
}

async function toVerifyFile(name: string, bytes: Uint8Array): Promise<VerifyFile> {
  return { name, hash: await sha256Hex(bytes), bytes }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyLedger against real wasm codecs', () => {
  it(
    'confirms an honest receipt when reference dimensions equal the source',
    { timeout: LONG },
    async () => {
      const { entry, outputBytes, sourceBytes } = await buildFixture(96, 75)
      const parsed = parseLedger(JSON.stringify(entry))
      const files = [
        await toVerifyFile('hero.jpg', outputBytes),
        await toVerifyFile('hero-source.png', sourceBytes),
      ]
      const { reports, summary } = await verifyLedger(parsed, files, decode)
      expect(summary).toMatchObject({ entries: 1, pass: 1, fail: 0, unverifiable: 0 })
      const report = reports[0]
      expect(report?.classification).toBe('verifiable')
      expect(report?.verdict).toBe('pass')
      expect(report?.referenceHashMatch).toBe(true)
      // Same decoder on both sides of the receipt: the numbers must agree
      // essentially exactly, far inside the cross-decoder tolerance.
      for (const m of report?.metrics ?? []) {
        expect(Math.abs(m.measured - m.recorded)).toBeLessThan(1e-12)
      }
    },
  )

  it(
    'confirms an honest receipt through the downscaled-reference path',
    { timeout: LONG },
    async () => {
      const { entry, outputBytes, sourceBytes } = await buildFixture(48, 75)
      const parsed = parseLedger(JSON.stringify(entry))
      const files = [
        await toVerifyFile('hero.jpg', outputBytes),
        await toVerifyFile('hero-source.png', sourceBytes),
      ]
      const { reports } = await verifyLedger(parsed, files, decode)
      expect(reports[0]?.verdict).toBe('pass')
      expect(reports[0]?.referenceHashMatch).toBe(true)
    },
  )

  it(
    'refutes a receipt when different bytes ship under the recorded name',
    { timeout: LONG },
    async () => {
      const { entry, sourceBytes } = await buildFixture(96, 75)
      // The writer recorded q75 bytes; someone ships a q40 encode instead.
      const tampered = await buildFixture(96, 40)
      const parsed = parseLedger(JSON.stringify(entry))
      const files = [
        await toVerifyFile('hero.jpg', tampered.outputBytes),
        await toVerifyFile('hero-source.png', sourceBytes),
      ]
      const { reports, summary } = await verifyLedger(parsed, files, decode)
      expect(summary.fail).toBe(1)
      expect(reports[0]?.verdict).toBe('fail')
      expect(reports[0]?.notes.join(' ')).toMatch(/hash/i)
    },
  )

  it(
    'reports progress and mixes verdicts across a multi-entry ledger',
    { timeout: LONG },
    async () => {
      const honest = await buildFixture(96, 75)
      const kept: LedgerEntryV1 = {
        ...honest.entry,
        asset: 'public/img/badge.png',
        decision: 'kept',
        reason: 'already smaller than any candidate',
        outputHash: null,
        output: null,
        metrics: null,
      }
      const missing: LedgerEntryV1 = {
        ...honest.entry,
        asset: 'public/img/elsewhere.jpg',
        outputHash: `sha256:${'e'.repeat(64)}`,
      }
      const text = [honest.entry, kept, missing].map((e) => JSON.stringify(e)).join('\n')
      const files = [
        await toVerifyFile('hero.jpg', honest.outputBytes),
        await toVerifyFile('hero-source.png', honest.sourceBytes),
        // badge.png "kept" claim: the file still hashes to its source.
        await toVerifyFile('badge.png', honest.sourceBytes),
      ]
      const seen: Array<[number, number]> = []
      const { reports, summary } = await verifyLedger(parseLedger(text), files, decode, (done, total) =>
        seen.push([done, total]),
      )
      expect(summary).toMatchObject({ entries: 3, pass: 2, fail: 0, unverifiable: 1 })
      expect(reports.map((r) => r.classification)).toEqual([
        'verifiable',
        'not-applicable',
        'file-missing',
      ])
      expect(seen).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ])
    },
  )
})
