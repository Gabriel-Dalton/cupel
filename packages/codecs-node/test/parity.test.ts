// Browser parity. The playground computes its numbers with the wasm adapter
// while the pipeline uses the node adapter, so the two must agree or the
// playground's credibility is gone. This suite runs identical RawImage inputs
// through both adapters, cross decodes every payload with both, and asserts
// the resulting SSIM values agree to within 1e-6. Drift fails CI loudly.
//
// Wasm loading mirrors packages/codecs-wasm/test/adapter.test.ts: the
// @jsquash builds cannot self load under plain Node (their default path
// fetches an import.meta.url relative asset), so the .wasm binaries shipped
// inside the installed packages are read, precompiled, and injected through
// wasmCodec's modules parameter.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENCODER_DEFAULT_QUALITY, ssim } from '@cupel/core'
import type { Encoder, RawImage } from '@cupel/core'
import { sharpCodec, type CodecFormat } from '../src/index.js'

// This package's tsconfig uses lib ES2022 without DOM, so neither the
// WebAssembly global value nor @cupel/codecs-wasm's TS source (which is typed
// against DOM's ImageData) can enter this tsc program. The wasm side is
// therefore reached through a type erased dynamic import plus local
// structural types, with compiled modules handled as opaque values.
type WasmModule = unknown

type WasmCodecModule = {
  wasmCodec: (
    format: CodecFormat,
    modules?: { encode?: WasmModule; decode?: WasmModule },
  ) => Encoder
}

// Node provides the WebAssembly global at runtime; type the two calls used
// here structurally since lib ES2022 declares no WebAssembly value.
const WA = (
  globalThis as unknown as {
    WebAssembly: {
      compile(bytes: Uint8Array): Promise<WasmModule>
      validate(bytes: Uint8Array): boolean
    }
  }
).WebAssembly

let wasmPkg: Promise<WasmCodecModule> | undefined

function loadWasmPkg(): Promise<WasmCodecModule> {
  if (!wasmPkg) {
    // The specifier is widened to string on purpose: a statically analyzable
    // import would pull the DOM typed source into this program and fail
    // typecheck. The runtime import resolves the workspace package fine.
    const specifier: string = '@cupel/codecs-wasm'
    wasmPkg = import(/* @vite-ignore */ specifier) as Promise<WasmCodecModule>
  }
  return wasmPkg
}

// ---------------------------------------------------------------------------
// Procedural fixtures, defined locally: other packages' test helpers are not
// part of their public surface.
// ---------------------------------------------------------------------------

const SIZE = 48
const SSIM_TOLERANCE = 1e-6

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
 * Seeded uniform RGB noise. When withAlpha is set, alpha varies over 1..255
 * but never hits 0: lossless encoders are allowed to rewrite RGB under fully
 * transparent pixels unless an exact flag is set, and the two adapters differ
 * on that flag, so alpha 0 would test encoder freedom rather than parity.
 */
function noiseImage(width: number, height: number, seed: number, withAlpha: boolean): RawImage {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => [
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    withAlpha ? 1 + Math.floor(rand() * 255) : 255,
  ])
}

const LOSSLESS_FIXTURES: ReadonlyArray<{ name: string; img: RawImage }> = [
  { name: 'alpha noise', img: noiseImage(SIZE, SIZE, 7, true) },
  { name: 'gradient', img: horizontalGradient(SIZE, SIZE) },
]

// Lossy formats flatten or drop alpha (jpeg) or carry it in a separate plane,
// so opaque fixtures keep the comparison about codec reconstruction only.
const LOSSY_FIXTURES: ReadonlyArray<{ name: string; img: RawImage }> = [
  { name: 'opaque noise', img: noiseImage(SIZE, SIZE, 13, false) },
  { name: 'gradient', img: horizontalGradient(SIZE, SIZE) },
]

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/** Index of the first differing byte, or -1 when the arrays are identical. */
function firstByteMismatch(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return i
  }
  return a.length === b.length ? -1 : len
}

function maxChannelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let max = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    if (d > max) max = d
  }
  return max
}

function expectPixelIdentical(actual: RawImage, expected: RawImage, label: string): void {
  expect(actual.width, `${label}: width`).toBe(expected.width)
  expect(actual.height, `${label}: height`).toBe(expected.height)
  expect(actual.data.length, `${label}: data length`).toBe(expected.data.length)
  const at = firstByteMismatch(actual.data, expected.data)
  if (at !== -1) {
    throw new Error(
      `${label}: pixels differ, first mismatch at byte ${at} ` +
        `(${actual.data[at] ?? -1} vs ${expected.data[at] ?? -1}), ` +
        `max channel diff ${maxChannelDiff(actual.data, expected.data)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Codec construction. The node side is synchronous; the wasm side precompiles
// the shipped .wasm binaries once per format.
// ---------------------------------------------------------------------------

const nodeCodecs = new Map<CodecFormat, Encoder>()

function nodeCodec(format: CodecFormat): Encoder {
  let cached = nodeCodecs.get(format)
  if (!cached) {
    cached = sharpCodec(format)
    nodeCodecs.set(format, cached)
  }
  return cached
}

function jsquashDir(name: string): string {
  const require = createRequire(import.meta.url)
  try {
    // The @jsquash packages are dependencies of @cupel/codecs-wasm, not of
    // this package, so resolution must start from the wasm package's entry.
    const fromWasmPkg = createRequire(require.resolve('@cupel/codecs-wasm'))
    return path.dirname(fromWasmPkg.resolve(`@jsquash/${name}/package.json`))
  } catch {
    // pnpm workspace layout fallback: the sibling package's own node_modules.
    return fileURLToPath(
      new URL(`../../codecs-wasm/node_modules/@jsquash/${name}`, import.meta.url),
    )
  }
}

async function compileWasm(name: string, relPath: string): Promise<WasmModule> {
  const bytes = await readFile(path.join(jsquashDir(name), ...relPath.split('/')))
  return WA.compile(bytes)
}

// @jsquash/webp's encode init picks the SIMD glue when wasm-feature-detect
// reports SIMD support, so the precompiled module has to match. This probe is
// the exact module wasm-feature-detect validates.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])
const hasSimd = WA.validate(SIMD_PROBE)

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

const wasmCodecs = new Map<CodecFormat, Promise<Encoder>>()

function wasmCodecFor(format: CodecFormat): Promise<Encoder> {
  let cached = wasmCodecs.get(format)
  if (!cached) {
    cached = (async () => {
      const { wasmCodec } = await loadWasmPkg()
      const paths = WASM_PATHS[format]
      const modules =
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
    wasmCodecs.set(format, cached)
  }
  return cached
}

type Side = { name: 'node' | 'wasm'; codec: Encoder }

async function bothCodecs(format: CodecFormat): Promise<[Side, Side]> {
  return [
    { name: 'node', codec: nodeCodec(format) },
    { name: 'wasm', codec: await wasmCodecFor(format) },
  ]
}

// ---------------------------------------------------------------------------
// Capability parity: the two adapters must describe each format identically,
// or callers choosing a codec by capabilities get different behavior per
// platform.
// ---------------------------------------------------------------------------

describe('adapter parity: capabilities', () => {
  it('both adapters report identical supportsAlpha, lossless, and qualityRange', async () => {
    for (const format of ['jpeg', 'png', 'webp', 'avif'] as const) {
      const [nodeSide, wasmSide] = await bothCodecs(format)
      expect(wasmSide.codec.supportsAlpha, `${format}: supportsAlpha`).toBe(
        nodeSide.codec.supportsAlpha,
      )
      expect(wasmSide.codec.capabilities.lossless, `${format}: lossless`).toBe(
        nodeSide.codec.capabilities.lossless,
      )
      expect(wasmSide.codec.capabilities.qualityRange, `${format}: qualityRange`).toEqual(
        nodeSide.codec.capabilities.qualityRange,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Omitted-quality self consistency: each adapter must treat encode(img, {})
// exactly like encode with the shared ENCODER_DEFAULT_QUALITY value, so that
// callers omitting quality stay parity safe across platforms.
// ---------------------------------------------------------------------------

describe('adapter parity: omitted quality uses the shared default', () => {
  it('jpeg encode {} is byte identical to the explicit default on both adapters', async () => {
    const sides = await bothCodecs('jpeg')
    const img = noiseImage(SIZE, SIZE, 13, false)
    for (const side of sides) {
      const omitted = await side.codec.encode(img, {})
      const explicit = await side.codec.encode(img, {
        quality: ENCODER_DEFAULT_QUALITY.jpeg,
      })
      expect(omitted.length, `jpeg ${side.name}: bytes`).toBeGreaterThan(0)
      expect(omitted.length, `jpeg ${side.name}: byte length`).toBe(explicit.length)
      const at = firstByteMismatch(
        new Uint8ClampedArray(omitted.buffer, omitted.byteOffset, omitted.byteLength),
        new Uint8ClampedArray(explicit.buffer, explicit.byteOffset, explicit.byteLength),
      )
      expect(at, `jpeg ${side.name}: first differing byte index`).toBe(-1)
    }
  })
})

// ---------------------------------------------------------------------------
// Lossless formats: every encode from either adapter, decoded by either
// adapter, must reproduce the original exactly. ssim(original, decoded) is
// then exactly 1.0 for all four paths, which satisfies the 1e-6 agreement
// trivially.
// ---------------------------------------------------------------------------

async function assertLosslessParity(format: CodecFormat, opts: { lossless?: boolean }) {
  const sides = await bothCodecs(format)
  for (const { name, img } of LOSSLESS_FIXTURES) {
    for (const enc of sides) {
      const bytes = await enc.codec.encode(img, opts)
      expect(bytes.length, `${format} ${name}, enc ${enc.name}: bytes`).toBeGreaterThan(0)
      for (const dec of sides) {
        const back = await dec.codec.decode(bytes)
        const label = `${format} ${name}, enc ${enc.name}, dec ${dec.name}`
        expectPixelIdentical(back, img, label)
        expect(ssim(img, back), label).toBe(1)
      }
    }
  }
}

describe('adapter parity: png (lossless)', () => {
  it('all four encode/decode paths reproduce the original exactly, ssim 1.0', async () => {
    await assertLosslessParity('png', {})
  })
})

describe('adapter parity: webp lossless', () => {
  it('all four encode/decode paths reproduce the original exactly, ssim 1.0', async () => {
    await assertLosslessParity('webp', { lossless: true })
  })
})

// ---------------------------------------------------------------------------
// Lossy formats: encode once per adapter, then decode those same bytes with
// both adapters and compare the SSIM each side would report.
// ---------------------------------------------------------------------------

describe('adapter parity: webp lossy q75', () => {
  it('both decoders agree on ssim to within 1e-6 for either encoder output', async () => {
    const [nodeSide, wasmSide] = await bothCodecs('webp')
    for (const { name, img } of LOSSY_FIXTURES) {
      for (const enc of [nodeSide, wasmSide]) {
        const bytes = await enc.codec.encode(img, { quality: 75 })
        const decNode = await nodeSide.codec.decode(bytes)
        const decWasm = await wasmSide.codec.decode(bytes)
        // VP8/VP8L reconstruction is spec exact, so the two decoders must
        // produce identical pixels from the same bitstream. Asserting that
        // first gives a far clearer failure than an SSIM delta would.
        expectPixelIdentical(decWasm, decNode, `webp q75 ${name}, enc ${enc.name}`)
        const delta = Math.abs(ssim(img, decNode) - ssim(img, decWasm))
        expect(delta, `webp q75 ${name}, enc ${enc.name}: ssim delta`).toBeLessThanOrEqual(
          SSIM_TOLERANCE,
        )
      }
    }
  })
})

describe('adapter parity: jpeg q75', () => {
  it('both decoders agree on ssim to within 1e-6 for either encoder output', async () => {
    const [nodeSide, wasmSide] = await bothCodecs('jpeg')
    for (const { name, img } of LOSSY_FIXTURES) {
      for (const enc of [nodeSide, wasmSide]) {
        const bytes = await enc.codec.encode(img, { quality: 75 })
        const decNode = await nodeSide.codec.decode(bytes)
        const decWasm = await wasmSide.codec.decode(bytes)
        const delta = Math.abs(ssim(img, decNode) - ssim(img, decWasm))
        expect(delta, `jpeg q75 ${name}, enc ${enc.name}: ssim delta`).toBeLessThanOrEqual(
          SSIM_TOLERANCE,
        )
      }
    }
  })
})

// AVIF needs two tolerances, decided by which encoder produced the bitstream.
// AV1 reconstruction is spec exact, but only for the YUV planes; converting
// 4:2:0 chroma back up to RGB is left to the implementation, and libheif
// (sharp) and libavif (jSquash) use different chroma upsamplers. sharp
// encodes 4:4:4 by default (no upsampling step exists), so node encoded
// bitstreams decode bit identically everywhere and hold strict 1e-6
// (measured delta: exactly 0). jSquash encodes 4:2:0 by default, so on
// chromatic content the two decoders legitimately disagree in the chroma
// channels (measured: max channel diff 88, ssim delta 1.21e-4 on seeded RGB
// noise; achromatic content still measures 0). The jpeg style per channel
// <= 2 bound is an IDCT rounding allowance and does not apply to an
// unspecified upsampling filter, so the wasm encoded side asserts only the
// documented |ssim delta| <= 1e-3 latitude.
const AVIF_WASM_ENCODED_TOLERANCE = 1e-3

describe('adapter parity: avif q50', () => {
  it('decoders agree on ssim: 1e-6 for 4:4:4 (node enc), 1e-3 for 4:2:0 (wasm enc)', async () => {
    const [nodeSide, wasmSide] = await bothCodecs('avif')
    for (const { name, img } of LOSSY_FIXTURES) {
      for (const enc of [nodeSide, wasmSide]) {
        const bytes = await enc.codec.encode(img, { quality: 50 })
        const decNode = await nodeSide.codec.decode(bytes)
        const decWasm = await wasmSide.codec.decode(bytes)
        const delta = Math.abs(ssim(img, decNode) - ssim(img, decWasm))
        const tolerance = enc.name === 'node' ? SSIM_TOLERANCE : AVIF_WASM_ENCODED_TOLERANCE
        expect(delta, `avif q50 ${name}, enc ${enc.name}: ssim delta`).toBeLessThanOrEqual(
          tolerance,
        )
      }
    }
  })
})
