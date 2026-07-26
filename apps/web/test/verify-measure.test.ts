import { describe, expect, it } from 'vitest'
import { CIE76_JND_DELTA_E, DEFAULT_KAPPA, deltaE, distortion, ssim } from '@cupel/core'
import type { LedgerEntryV1, RawImage } from '@cupel/core'
import { hashRawImage } from '../lib/verify/hash'
import {
  DELTA_E_TOLERANCE,
  DISTORTION_TOLERANCE,
  SSIM_TOLERANCE,
  deriveReference,
  remeasure,
  supportedFormat,
} from '../lib/verify/measure'
import type { DecodeFn, VerifyFile } from '../lib/verify/types'

// ---------------------------------------------------------------------------
// Deterministic fixtures, generated in code. mulberry32 is the same seeded
// PRNG the rest of the repo's tests use.
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

/** A smooth two-axis gradient with mild seeded texture, opaque alpha. */
function sourceImage(size = 32, seed = 0x5eed): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const texture = (rand() - 0.5) * 24
      data[o] = (x / (size - 1)) * 220 + texture
      data[o + 1] = (y / (size - 1)) * 200 + texture
      data[o + 2] = 128 + texture
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** The source with seeded noise added, standing in for a lossy decode. */
function degrade(img: RawImage, seed = 42, amplitude = 10): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(img.data)
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 2 * amplitude
    data[i] = (data[i] ?? 0) + n
    data[i + 1] = (data[i + 1] ?? 0) + n
    data[i + 2] = (data[i + 2] ?? 0) + n
  }
  return { width: img.width, height: img.height, data }
}

const SRC = sourceImage()
const OUT = degrade(SRC)

// Byte tags let the fake decoder return the right image without any real
// codec work: decode sees only the VerifyFile bytes it was handed.
const SOURCE_TAG = new Uint8Array([1])
const OUTPUT_TAG = new Uint8Array([2])

function fakeDecode(images: { source: RawImage; output: RawImage }): DecodeFn {
  return (_format, bytes) => {
    if (bytes[0] === 1) return Promise.resolve(images.source)
    if (bytes[0] === 2) return Promise.resolve(images.output)
    return Promise.reject(new Error('fake decode: unknown byte tag'))
  }
}

function verifyFile(name: string, bytes: Uint8Array): VerifyFile {
  return { name, hash: `sha256:${'f'.repeat(64)}`, bytes }
}

async function makeEntry(overrides: Partial<LedgerEntryV1> = {}): Promise<LedgerEntryV1> {
  // Recorded numbers computed by the same shipped core code the verifier
  // runs, so an untampered entry must reproduce within tolerance.
  const s = ssim(SRC, OUT)
  const dE = deltaE(SRC, OUT).mean
  return {
    v: 1,
    ts: '2026-07-25T18:04:11Z',
    asset: 'public/img/hero.jpg',
    sourceHash: `sha256:${'a'.repeat(64)}`,
    outputHash: `sha256:${'b'.repeat(64)}`,
    sourceRecovered: null,
    reference: { w: SRC.width, h: SRC.height, hash: await hashRawImage(SRC) },
    decision: 'encoded',
    reason: null,
    output: { format: 'webp', quality: 75, bytes: 4120 },
    before: { format: 'png', bytes: 31844 },
    metrics: { ssim: s, deltaE: dE, distortion: distortion(s, dE) },
    weight: null,
    lambda: null,
    provenance: null,
    encoder: null,
    tool: 'cupel@0.0.0',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tolerances
// ---------------------------------------------------------------------------

describe('re-measurement tolerances', () => {
  // These constants are part of what the /verify page promises. Anyone whose
  // receipt fails must be able to read exactly how much decoder slack was
  // granted, so changing them is an interface change and must show up here.
  it('pins the documented values', () => {
    expect(SSIM_TOLERANCE).toBe(0.002)
    expect(DELTA_E_TOLERANCE).toBe(0.1)
    // Distortion is derived from the other two (d = (1 - ssim) +
    // kappa * min(deltaE / jnd, 1)), so its tolerance is exactly the
    // worst-case propagation of theirs, never an independent number.
    expect(DISTORTION_TOLERANCE).toBe(
      SSIM_TOLERANCE + DEFAULT_KAPPA * (DELTA_E_TOLERANCE / CIE76_JND_DELTA_E),
    )
  })
})

describe('supportedFormat', () => {
  it('normalizes the formats the wasm codecs can decode', () => {
    expect(supportedFormat('jpeg')).toBe('jpeg')
    expect(supportedFormat('jpg')).toBe('jpeg')
    expect(supportedFormat('JPEG')).toBe('jpeg')
    expect(supportedFormat('png')).toBe('png')
    expect(supportedFormat('webp')).toBe('webp')
    expect(supportedFormat('avif')).toBe('avif')
  })

  it('returns null for anything else', () => {
    expect(supportedFormat('gif')).toBeNull()
    expect(supportedFormat('jxl')).toBeNull()
    expect(supportedFormat('')).toBeNull()
  })
})

describe('deriveReference', () => {
  it('returns a copy when the source already has the reference dimensions', () => {
    const ref = deriveReference(SRC, { w: SRC.width, h: SRC.height })
    expect(ref).not.toBeNull()
    expect(ref?.data).toEqual(SRC.data)
    expect(ref?.data).not.toBe(SRC.data)
  })

  it('downscales when the source is larger', () => {
    const ref = deriveReference(SRC, { w: 16, h: 16 })
    expect(ref?.width).toBe(16)
    expect(ref?.height).toBe(16)
  })

  it('refuses to upscale: a reference larger than the source returns null', () => {
    expect(deriveReference(SRC, { w: 64, h: 64 })).toBeNull()
    // Mixed cases refuse too; fabricating either axis is still fabricating.
    expect(deriveReference(SRC, { w: 16, h: 64 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// remeasure
// ---------------------------------------------------------------------------

describe('remeasure', () => {
  const decode = fakeDecode({ source: SRC, output: OUT })
  const output = verifyFile('hero.jpg', OUTPUT_TAG)
  const source = verifyFile('hero-src.png', SOURCE_TAG)

  it('passes an untampered entry and confirms the reference hash', async () => {
    const result = await remeasure(await makeEntry(), output, source, decode)
    expect(result.verdict).toBe('pass')
    expect(result.referenceHashMatch).toBe(true)
    expect(result.metrics).toHaveLength(3)
    for (const comparison of result.metrics ?? []) {
      expect(comparison.withinTolerance).toBe(true)
      expect(Math.abs(comparison.measured - comparison.recorded)).toBeLessThanOrEqual(
        comparison.tolerance,
      )
    }
  })

  it('fails when the recorded numbers are off by more than the tolerance', async () => {
    const honest = await makeEntry()
    const metrics = honest.metrics
    if (!metrics) throw new Error('fixture must record metrics')
    const doctored = await makeEntry({
      metrics: { ...metrics, ssim: metrics.ssim - 0.05 },
    })
    const result = await remeasure(doctored, output, source, decode)
    expect(result.verdict).toBe('fail')
    const flagged = result.metrics?.find((m) => m.metric === 'ssim')
    expect(flagged?.withinTolerance).toBe(false)
  })

  it('refuses to verify when the reference would need upscaling', async () => {
    const entry = await makeEntry({
      reference: { w: 64, h: 64, hash: `sha256:${'c'.repeat(64)}` },
    })
    const result = await remeasure(entry, output, source, decode)
    expect(result.verdict).toBe('unverifiable')
    expect(result.notes.join(' ')).toMatch(/refus/i)
  })

  it('fails when the output dimensions contradict the recorded reference', async () => {
    const small = degrade(sourceImage(16), 43)
    const result = await remeasure(
      await makeEntry(),
      output,
      source,
      fakeDecode({ source: SRC, output: small }),
    )
    expect(result.verdict).toBe('fail')
    expect(result.notes.join(' ')).toMatch(/16x16/)
  })

  it('is unverifiable for formats the wasm codecs cannot decode', async () => {
    const entry = await makeEntry({ output: { format: 'jxl', quality: 75, bytes: 4120 } })
    const result = await remeasure(entry, output, source, decode)
    expect(result.verdict).toBe('unverifiable')
    expect(result.notes.join(' ')).toMatch(/jxl/)
  })

  it('is unverifiable when a decode throws', async () => {
    const throwing: DecodeFn = () => Promise.reject(new Error('truncated stream'))
    const result = await remeasure(await makeEntry(), output, source, throwing)
    expect(result.verdict).toBe('unverifiable')
    expect(result.notes.join(' ')).toMatch(/truncated stream/)
  })

  it('does not blame the file when metrics disagree AND the reference hash does not match', async () => {
    // If the re-derived reference is not the one the writer measured
    // against, an out-of-tolerance metric may be the verifier's own
    // derivation (resampler, orientation), so the honest verdict is
    // unverifiable, not fail.
    const honest = await makeEntry()
    const metrics = honest.metrics
    if (!metrics) throw new Error('fixture must record metrics')
    const entry = await makeEntry({
      reference: { w: SRC.width, h: SRC.height, hash: `sha256:${'0'.repeat(64)}` },
      metrics: { ...metrics, ssim: metrics.ssim - 0.05 },
    })
    const result = await remeasure(entry, output, source, decode)
    expect(result.verdict).toBe('unverifiable')
    expect(result.referenceHashMatch).toBe(false)
  })

  it('still passes, with a caution note, when only the reference hash disagrees', async () => {
    const entry = await makeEntry({
      reference: { w: SRC.width, h: SRC.height, hash: `sha256:${'0'.repeat(64)}` },
    })
    const result = await remeasure(entry, output, source, decode)
    expect(result.verdict).toBe('pass')
    expect(result.referenceHashMatch).toBe(false)
    expect(result.notes.length).toBeGreaterThan(0)
  })
})
