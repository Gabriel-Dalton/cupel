// Tests run in Node. The @jsquash wasm builds cannot self-load there (their
// default path uses fetch on an import.meta.url relative asset), so each test
// reads the .wasm files shipped inside the installed packages, precompiles
// them, and hands them to wasmCodec through the modules parameter. That is
// exactly the injection path a non-bundler consumer would use.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ENCODER_DEFAULT_QUALITY } from '@cupel/core'
import type { Encoder, RawImage } from '@cupel/core'
import { wasmCodec, type CodecFormat, type WasmModules } from '../src/index.js'

// ---------------------------------------------------------------------------
// Procedural fixtures. These mirror packages/core/test/helpers/fixtures.ts but
// are defined locally: cross package imports of another package's test
// helpers are not part of this package's surface.
// ---------------------------------------------------------------------------

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

function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number, number],
): RawImage {
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

/** Independent uniform RGB noise, opaque alpha. */
function noiseImage(width: number, height: number, seed = 1): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => [
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    255,
  ])
}

/** Noise on all four channels, exercising alpha in lossless roundtrips. */
function noiseImageWithAlpha(width: number, height: number, seed = 1): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => [
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
  ])
}

/** Smooth left to right luminance ramp. */
function horizontalGradient(width: number, height: number): RawImage {
  return makeImage(width, height, (x) => {
    const v = Math.round((x / Math.max(1, width - 1)) * 255)
    return [v, v, v, 255]
  })
}

function meanAbsErrorRGB(a: RawImage, b: RawImage): number {
  expect(b.data.length).toBe(a.data.length)
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0))
      n++
    }
  }
  return sum / n
}

function everyAlphaIs255(img: RawImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if ((img.data[i] ?? 0) !== 255) return false
  }
  return true
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

// ---------------------------------------------------------------------------
// Wasm module loading
// ---------------------------------------------------------------------------

function jsquashDir(name: string): string {
  const require = createRequire(import.meta.url)
  try {
    // The @jsquash packages ship no exports map, so package.json resolves.
    return path.dirname(require.resolve(`@jsquash/${name}/package.json`))
  } catch {
    // Fallback for stricter resolution setups: pnpm links this package's
    // dependencies into its own node_modules directory.
    return fileURLToPath(new URL(`../node_modules/@jsquash/${name}`, import.meta.url))
  }
}

async function compileWasm(name: string, relPath: string): Promise<WebAssembly.Module> {
  const bytes = await readFile(path.join(jsquashDir(name), ...relPath.split('/')))
  return WebAssembly.compile(bytes)
}

// @jsquash/webp's encode init picks the SIMD glue when wasm-feature-detect
// reports SIMD support, so the precompiled module has to match. This probe is
// the exact module wasm-feature-detect validates.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])
const hasSimd = WebAssembly.validate(SIMD_PROBE)

const WASM_PATHS: Record<CodecFormat, { encode: string; decode: string }> = {
  jpeg: { encode: 'codec/enc/mozjpeg_enc.wasm', decode: 'codec/dec/mozjpeg_dec.wasm' },
  // One wasm-bindgen module serves both png directions.
  png: { encode: 'codec/pkg/squoosh_png_bg.wasm', decode: 'codec/pkg/squoosh_png_bg.wasm' },
  webp: {
    encode: hasSimd ? 'codec/enc/webp_enc_simd.wasm' : 'codec/enc/webp_enc.wasm',
    decode: 'codec/dec/webp_dec.wasm',
  },
  // In plain Node, @jsquash/avif's encode init always selects the single
  // threaded build, never avif_enc_mt.
  avif: { encode: 'codec/enc/avif_enc.wasm', decode: 'codec/dec/avif_dec.wasm' },
}

const codecCache = new Map<CodecFormat, Promise<Encoder>>()

function codec(format: CodecFormat): Promise<Encoder> {
  let cached = codecCache.get(format)
  if (!cached) {
    cached = (async () => {
      const paths = WASM_PATHS[format]
      const modules: WasmModules =
        format === 'png'
          ? await (async () => {
              const shared = await compileWasm(format, paths.decode)
              return { encode: shared, decode: shared }
            })()
          : {
              encode: await compileWasm(format, paths.encode),
              decode: await compileWasm(format, paths.decode),
            }
      return wasmCodec(format, modules)
    })()
    codecCache.set(format, cached)
  }
  return cached
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wasmCodec adapter', () => {
  it('exposes id, format, and capabilities per format', async () => {
    const png = await codec('png')
    expect(png.id).toBe('jsquash-png')
    expect(png.format).toBe('png')
    expect(png.capabilities.lossless).toBe(true)
    // Lossless-only formats advertise [0, 0] per the core Encoder contract.
    expect(png.capabilities.qualityRange).toEqual([0, 0])
    const jpeg = await codec('jpeg')
    expect(jpeg.id).toBe('jsquash-jpeg')
    expect(jpeg.supportsAlpha).toBe(false)
    expect(jpeg.capabilities.lossless).toBe(false)
    await expect(jpeg.version()).resolves.toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('png roundtrip is pixel identical on 32x32 seeded noise', async () => {
    const png = await codec('png')
    const img = noiseImageWithAlpha(32, 32, 7)
    const bytes = await png.encode(img, {})
    expect(bytes.length).toBeGreaterThan(0)
    const back = await png.decode(bytes)
    expect(back.width).toBe(32)
    expect(back.height).toBe(32)
    expect(back.data).toEqual(img.data)
  })

  it('webp lossless roundtrip is pixel identical on 32x32 seeded noise', async () => {
    const webp = await codec('webp')
    const img = noiseImage(32, 32, 11)
    const bytes = await webp.encode(img, { lossless: true })
    expect(bytes.length).toBeGreaterThan(0)
    const back = await webp.decode(bytes)
    expect(back.width).toBe(32)
    expect(back.height).toBe(32)
    expect(back.data).toEqual(img.data)
  })

  it('jpeg q90 roundtrip on a smooth gradient stays close and fully opaque', async () => {
    const jpeg = await codec('jpeg')
    const img = horizontalGradient(64, 32)
    const bytes = await jpeg.encode(img, { quality: 90 })
    const back = await jpeg.decode(bytes)
    expect(back.width).toBe(64)
    expect(back.height).toBe(32)
    expect(meanAbsErrorRGB(img, back)).toBeLessThan(6)
    expect(everyAlphaIs255(back)).toBe(true)
  })

  it('webp lossy q40 produces fewer bytes than q90 on noise', async () => {
    const webp = await codec('webp')
    const img = noiseImage(64, 64, 42)
    const q40 = await webp.encode(img, { quality: 40 })
    const q90 = await webp.encode(img, { quality: 90 })
    expect(q40.length).toBeGreaterThan(0)
    expect(q40.length).toBeLessThan(q90.length)
  })

  it('avif roundtrip on 32x32 at quality 50', async () => {
    const avif = await codec('avif')
    const img = horizontalGradient(32, 32)
    const bytes = await avif.encode(img, { quality: 50 })
    expect(bytes.length).toBeGreaterThan(0)
    const back = await avif.decode(bytes)
    expect(back.width).toBe(32)
    expect(back.height).toBe(32)
    // q50 on a smooth achromatic ramp should land very close to the source.
    expect(meanAbsErrorRGB(img, back)).toBeLessThan(12)
    expect(everyAlphaIs255(back)).toBe(true)
  })

  it('decode of garbage bytes rejects', async () => {
    // No valid jpeg (FFD8) or png (89504E47) magic anywhere in this buffer.
    const garbage = new Uint8Array(256).fill(0xab)
    const jpeg = await codec('jpeg')
    await expect(jpeg.decode(garbage)).rejects.toThrow()
    const png = await codec('png')
    await expect(png.decode(garbage)).rejects.toThrow()
  })

  it('encode rejects mismatched dimensions with a clear message', async () => {
    // Without the guard the wasm encoders read uninitialized heap (jpeg,
    // webp) or panic opaquely inside the module (png).
    const bad: RawImage = { width: 32, height: 32, data: new Uint8ClampedArray(16) }
    for (const format of ['jpeg', 'webp', 'png'] as const) {
      const enc = await codec(format)
      await expect(enc.encode(bad, {}), format).rejects.toThrow(
        /dimensions do not match data length/i,
      )
    }
  })
})

describe('wasmCodec default quality', () => {
  it('jpeg encode with {} is byte identical to the shared default quality', async () => {
    const jpeg = await codec('jpeg')
    const img = noiseImage(48, 48, 21)
    const omitted = await jpeg.encode(img, {})
    const explicit = await jpeg.encode(img, { quality: ENCODER_DEFAULT_QUALITY.jpeg })
    expect(omitted.length).toBeGreaterThan(0)
    expectSameBytes(omitted, explicit, 'jpeg omitted vs explicit default')
  })

  it('webp encode with {} is byte identical to the shared default quality', async () => {
    const webp = await codec('webp')
    const img = noiseImage(48, 48, 21)
    const omitted = await webp.encode(img, {})
    const explicit = await webp.encode(img, { quality: ENCODER_DEFAULT_QUALITY.webp })
    expect(omitted.length).toBeGreaterThan(0)
    expectSameBytes(omitted, explicit, 'webp omitted vs explicit default')
  })

  it('quality NaN falls back to the format default, byte identical', async () => {
    const img = noiseImage(48, 48, 23)
    for (const format of ['jpeg', 'webp'] as const) {
      const enc = await codec(format)
      const fromNaN = await enc.encode(img, { quality: Number.NaN })
      const fromDefault = await enc.encode(img, { quality: ENCODER_DEFAULT_QUALITY[format] })
      expectSameBytes(fromNaN, fromDefault, `${format} NaN vs default`)
    }
  })
})

describe('wasmCodec avif lossless', () => {
  it('emits no console.warn and roundtrips exactly', async () => {
    const avif = await codec('avif')
    const img = noiseImage(16, 16, 31)
    const warn = vi.spyOn(console, 'warn')
    try {
      const bytes = await avif.encode(img, { lossless: true, quality: 50 })
      expect(bytes.length).toBeGreaterThan(0)
      // @jsquash/avif warns 'AVIF lossless: Quality setting is ignored...'
      // when quality is passed alongside lossless. The adapter must omit it.
      expect(warn).not.toHaveBeenCalled()
      const back = await avif.decode(bytes)
      expect(back.data).toEqual(img.data)
    } finally {
      warn.mockRestore()
    }
  })
})
