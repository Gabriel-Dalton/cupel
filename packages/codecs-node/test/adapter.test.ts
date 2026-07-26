import { describe, expect, it } from 'vitest'
import { ENCODER_DEFAULT_QUALITY } from '@cupel/core'
import type { RawImage } from '@cupel/core'
import { sharpCodec } from '../src/index.js'

// Local procedural fixtures. Core's test helpers are off limits from this
// package, so the small subset needed here is redefined locally.

/** Small, fast, seeded PRNG. Deterministic across platforms. */
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

type PixelFn = (x: number, y: number) => [number, number, number, number]

function makeImage(width: number, height: number, fn: PixelFn): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }
  return { width, height, data }
}

/** Smooth left to right luminance ramp, fully opaque. */
function horizontalGradient(width: number, height: number): RawImage {
  return makeImage(width, height, (x) => {
    const v = Math.round((x / Math.max(1, width - 1)) * 255)
    return [v, v, v, 255]
  })
}

/**
 * Independent uniform RGB noise. Alpha is either opaque or varied but never
 * 0: lossless encoders are allowed to rewrite RGB under fully transparent
 * pixels (libwebp does unless its exact flag is set), and that freedom would
 * make a byte for byte comparison test the wrong thing.
 */
function noiseImage(width: number, height: number, seed = 1, opaque = false): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => [
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    opaque ? 255 : 1 + Math.floor(rand() * 255),
  ])
}

/** Mean absolute error over RGB channels only. Alpha is asserted separately. */
function meanAbsErrorRgb(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  expect(a.length).toBe(b.length)
  let sum = 0
  let n = 0
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue
    sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    n++
  }
  return sum / n
}

function countMismatches(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  expect(a.length).toBe(b.length)
  let mismatches = 0
  for (let i = 0; i < a.length; i++) {
    if ((a[i] ?? -1) !== (b[i] ?? -2)) mismatches++
  }
  return mismatches
}

/** Index of the first differing byte, or -1 when the arrays are identical. */
function firstByteMismatch(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return i
  }
  return a.length === b.length ? -1 : len
}

function expectSameBytes(a: Uint8Array, b: Uint8Array, label: string): void {
  expect(a.length, `${label}: byte length`).toBe(b.length)
  expect(firstByteMismatch(a, b), `${label}: first differing byte index`).toBe(-1)
}

const FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const

describe('sharpCodec lossless roundtrips', () => {
  it('png roundtrip is byte for byte identical', async () => {
    const codec = sharpCodec('png')
    const img = noiseImage(32, 32, 7)
    const bytes = await codec.encode(img, {})
    const back = await codec.decode(bytes)
    expect(back.width).toBe(32)
    expect(back.height).toBe(32)
    expect(back.data).toBeInstanceOf(Uint8ClampedArray)
    expect(back.data.length).toBe(img.data.length)
    expect(countMismatches(back.data, img.data)).toBe(0)
  })

  it('webp lossless roundtrip is byte for byte identical', async () => {
    const codec = sharpCodec('webp')
    const img = noiseImage(32, 32, 11)
    const bytes = await codec.encode(img, { lossless: true })
    const back = await codec.decode(bytes)
    expect(back.width).toBe(32)
    expect(back.height).toBe(32)
    expect(back.data.length).toBe(img.data.length)
    expect(countMismatches(back.data, img.data)).toBe(0)
  })
})

describe('sharpCodec lossy roundtrips', () => {
  it('jpeg q90 on a smooth gradient stays close and returns opaque alpha', async () => {
    const codec = sharpCodec('jpeg')
    const img = horizontalGradient(64, 64)
    const bytes = await codec.encode(img, { quality: 90 })
    const back = await codec.decode(bytes)
    expect(back.width).toBe(64)
    expect(back.height).toBe(64)
    expect(meanAbsErrorRgb(back.data, img.data)).toBeLessThan(6)
    for (let i = 3; i < back.data.length; i += 4) {
      if ((back.data[i] ?? 0) !== 255) {
        throw new Error(`alpha not 255 at byte ${i}: ${back.data[i]}`)
      }
    }
  })

  it('avif q50 roundtrips a 48x48 image with correct dimensions', async () => {
    const codec = sharpCodec('avif')
    const img = horizontalGradient(48, 48)
    const bytes = await codec.encode(img, { quality: 50 })
    expect(bytes.length).toBeGreaterThan(0)
    const back = await codec.decode(bytes)
    expect(back.width).toBe(48)
    expect(back.height).toBe(48)
    expect(back.data.length).toBe(48 * 48 * 4)
  })
})

describe('sharpCodec lossy size ordering', () => {
  it('jpeg q40 produces fewer bytes than q90 on noise', async () => {
    const codec = sharpCodec('jpeg')
    const img = noiseImage(64, 64, 3, true)
    const low = await codec.encode(img, { quality: 40 })
    const high = await codec.encode(img, { quality: 90 })
    expect(low.length).toBeLessThan(high.length)
  })

  it('webp q40 produces fewer bytes than q90 on noise', async () => {
    const codec = sharpCodec('webp')
    const img = noiseImage(64, 64, 3, true)
    const low = await codec.encode(img, { quality: 40 })
    const high = await codec.encode(img, { quality: 90 })
    expect(low.length).toBeLessThan(high.length)
  })
})

describe('sharpCodec default quality', () => {
  it('jpeg encode with {} is byte identical to the shared default quality', async () => {
    const codec = sharpCodec('jpeg')
    const img = noiseImage(48, 48, 21, true)
    const omitted = await codec.encode(img, {})
    const explicit = await codec.encode(img, { quality: ENCODER_DEFAULT_QUALITY.jpeg })
    expect(omitted.length).toBeGreaterThan(0)
    expectSameBytes(omitted, explicit, 'jpeg omitted vs explicit default')
  })

  it('webp encode with {} is byte identical to the shared default quality', async () => {
    const codec = sharpCodec('webp')
    const img = noiseImage(48, 48, 21, true)
    const omitted = await codec.encode(img, {})
    const explicit = await codec.encode(img, { quality: ENCODER_DEFAULT_QUALITY.webp })
    expect(omitted.length).toBeGreaterThan(0)
    expectSameBytes(omitted, explicit, 'webp omitted vs explicit default')
  })

  it('quality NaN falls back to the format default, byte identical', async () => {
    const img = noiseImage(48, 48, 23, true)
    for (const format of ['jpeg', 'webp'] as const) {
      const codec = sharpCodec(format)
      const fromNaN = await codec.encode(img, { quality: Number.NaN })
      const fromDefault = await codec.encode(img, { quality: ENCODER_DEFAULT_QUALITY[format] })
      expectSameBytes(fromNaN, fromDefault, `${format} NaN vs default`)
    }
  })
})

describe('sharpCodec error handling', () => {
  it('decode rejects garbage bytes', async () => {
    const rand = mulberry32(99)
    const garbage = new Uint8Array(256)
    for (let i = 0; i < garbage.length; i++) garbage[i] = Math.floor(rand() * 256)
    for (const format of FORMATS) {
      await expect(sharpCodec(format).decode(garbage)).rejects.toThrow()
    }
  })

  it('encode rejects an image whose dimensions do not match its data length', async () => {
    const codec = sharpCodec('png')
    const bad: RawImage = { width: 32, height: 32, data: new Uint8ClampedArray(16) }
    await expect(codec.encode(bad, {})).rejects.toThrow(/dimensions|length/i)
  })
})

describe('sharpCodec metadata', () => {
  it('version() returns a non empty string for each format', async () => {
    for (const format of FORMATS) {
      const codec = sharpCodec(format)
      const ver = await codec.version()
      expect(typeof ver).toBe('string')
      expect(ver.length).toBeGreaterThan(0)
      expect(codec.id.length).toBeGreaterThan(0)
      expect(codec.format).toBe(format)
    }
  })

  it('supportsAlpha is false for jpeg and true for png, webp, avif', () => {
    expect(sharpCodec('jpeg').supportsAlpha).toBe(false)
    expect(sharpCodec('png').supportsAlpha).toBe(true)
    expect(sharpCodec('webp').supportsAlpha).toBe(true)
    expect(sharpCodec('avif').supportsAlpha).toBe(true)
  })

  it('lossy formats advertise [1,100]; lossless-only png advertises [0,0]', () => {
    expect(sharpCodec('jpeg').capabilities.qualityRange).toEqual([1, 100])
    expect(sharpCodec('webp').capabilities.qualityRange).toEqual([1, 100])
    expect(sharpCodec('avif').capabilities.qualityRange).toEqual([1, 100])
    expect(sharpCodec('png').capabilities.qualityRange).toEqual([0, 0])
    expect(sharpCodec('jpeg').capabilities.lossless).toBe(false)
    expect(sharpCodec('png').capabilities.lossless).toBe(true)
    expect(sharpCodec('webp').capabilities.lossless).toBe(true)
    expect(sharpCodec('avif').capabilities.lossless).toBe(true)
  })
})
