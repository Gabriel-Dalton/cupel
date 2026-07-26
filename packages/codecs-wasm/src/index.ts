import { ENCODER_DEFAULT_QUALITY } from '@cupel/core'
import type { EncodeOptions, Encoder, RawImage } from '@cupel/core'
import avifPkg from '@jsquash/avif/package.json'
import jpegPkg from '@jsquash/jpeg/package.json'
import pngPkg from '@jsquash/png/package.json'
import webpPkg from '@jsquash/webp/package.json'

export type CodecFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Precompiled WASM modules keyed by role. In the browser, bundlers resolve
 * the .wasm assets and this can be omitted. In plain Node (tests, CLI use),
 * the caller reads the .wasm files shipped inside the @jsquash packages and
 * hands them in precompiled; this package never touches the filesystem.
 *
 * Which .wasm file matches which role, per format:
 * - jpeg: codec/enc/mozjpeg_enc.wasm and codec/dec/mozjpeg_dec.wasm
 * - webp: codec/enc/webp_enc_simd.wasm when the runtime supports WASM SIMD
 *   (which is what @jsquash/webp's init selects there), codec/enc/webp_enc.wasm
 *   otherwise, and codec/dec/webp_dec.wasm
 * - avif: codec/enc/avif_enc.wasm (in plain Node the package never selects the
 *   threaded avif_enc_mt build) and codec/dec/avif_dec.wasm
 * - png: codec/pkg/squoosh_png_bg.wasm serves both roles; passing it as either
 *   key (or both) is sufficient
 */
export type WasmModules = {
  encode?: WebAssembly.Module
  decode?: WebAssembly.Module
}

// The published @jsquash typings for the emscripten based codecs declare
// init(moduleOptionOverrides?) only, but the shipped JS also accepts a
// precompiled WebAssembly.Module as the first argument. This is the runtime
// truth we call through.
type ModuleInit = (module?: WebAssembly.Module) => Promise<unknown>

// What every @jsquash decode resolves to (an ImageData, polyfilled in Node).
type ImageDataLike = {
  data: Uint8ClampedArray
  width: number
  height: number
}

// The jsquash packages hold their emscripten or wasm-bindgen instance in
// module scope, one per package entry point, so init must run exactly once
// per format and role for the whole process. First wasmCodec call for a
// format wins; later calls with different modules reuse the existing
// instance.
const initialized = new Map<string, Promise<unknown>>()

function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  const cached = initialized.get(key)
  if (cached) return cached as Promise<T>
  const fresh = make()
  initialized.set(key, fresh)
  return fresh
}

function clampQuality(q: number | undefined, fallback: number): number {
  if (q === undefined || !Number.isFinite(q)) return fallback
  return Math.min(100, Math.max(1, Math.round(q)))
}

/**
 * Same defensive check as the node adapter. Without it the wasm encoders
 * silently read uninitialized heap memory (jpeg, webp) or panic opaquely
 * inside the wasm module (png) when the data length disagrees with the
 * dimensions.
 */
function assertDimensionsMatchData(img: RawImage): void {
  const expected = img.width * img.height * 4
  if (
    !Number.isInteger(img.width) ||
    !Number.isInteger(img.height) ||
    img.width <= 0 ||
    img.height <= 0 ||
    img.data.length !== expected
  ) {
    throw new Error(
      `RawImage dimensions do not match data length: ${img.width}x${img.height} RGBA ` +
        `requires ${expected} bytes, got ${img.data.length}`,
    )
  }
}

/** Copies bytes into a fresh, tightly sized ArrayBuffer, as the codecs want. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer as ArrayBuffer
}

/**
 * Builds the ImageData shaped object the encoders take. The png and avif
 * encoders wrap data.data.buffer directly, so the view must span its entire
 * buffer; copy when it does not.
 */
function toImageData(img: RawImage): ImageData {
  const spansBuffer =
    img.data.byteOffset === 0 && img.data.byteLength === img.data.buffer.byteLength
  const data = spansBuffer ? img.data : img.data.slice()
  return { data, width: img.width, height: img.height, colorSpace: 'srgb' } as ImageData
}

function toRawImage(result: ImageDataLike | null | undefined): RawImage {
  if (!result) throw new Error('Decoding error')
  return {
    width: result.width,
    height: result.height,
    data: new Uint8ClampedArray(result.data),
  }
}

/**
 * mozjpeg has no alpha channel and simply drops it. Composite onto a white
 * background first so semi transparent pixels keep their perceived color,
 * the same convention as the node adapter.
 */
function flattenOntoWhite(img: RawImage): RawImage {
  const src = img.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a = (src[i + 3] ?? 255) / 255
    // Source over white: c' = a * c + (1 - a) * 255
    const inverse = (1 - a) * 255
    out[i] = (src[i] ?? 0) * a + inverse
    out[i + 1] = (src[i + 1] ?? 0) * a + inverse
    out[i + 2] = (src[i + 2] ?? 0) * a + inverse
    out[i + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

// ---------------------------------------------------------------------------
// Per format entry point loaders. Each lazily imports the @jsquash subpath,
// runs its init with the precompiled module when one was provided, and
// memoizes the resulting encode or decode function. When no module is
// provided the package's own default loading applies (the bundler path); in
// plain Node that first call may reject, which is expected and documented on
// wasmCodec.
// ---------------------------------------------------------------------------

function loadJpegEncode(modules?: WasmModules) {
  return once('jpeg:encode', async () => {
    const mod = await import('@jsquash/jpeg/encode.js')
    if (modules?.encode) await (mod.init as unknown as ModuleInit)(modules.encode)
    return mod.default
  })
}

function loadJpegDecode(modules?: WasmModules) {
  return once('jpeg:decode', async () => {
    const mod = await import('@jsquash/jpeg/decode.js')
    if (modules?.decode) await (mod.init as unknown as ModuleInit)(modules.decode)
    return mod.default
  })
}

function loadWebpEncode(modules?: WasmModules) {
  return once('webp:encode', async () => {
    const mod = await import('@jsquash/webp/encode.js')
    if (modules?.encode) await (mod.init as unknown as ModuleInit)(modules.encode)
    return mod.default
  })
}

function loadWebpDecode(modules?: WasmModules) {
  return once('webp:decode', async () => {
    const mod = await import('@jsquash/webp/decode.js')
    if (modules?.decode) await (mod.init as unknown as ModuleInit)(modules.decode)
    return mod.default
  })
}

function loadAvifEncode(modules?: WasmModules) {
  return once('avif:encode', async () => {
    const mod = await import('@jsquash/avif/encode.js')
    if (modules?.encode) await (mod.init as unknown as ModuleInit)(modules.encode)
    return mod.default
  })
}

function loadAvifDecode(modules?: WasmModules) {
  return once('avif:decode', async () => {
    const mod = await import('@jsquash/avif/decode.js')
    if (modules?.decode) await (mod.init as unknown as ModuleInit)(modules.decode)
    return mod.default
  })
}

// One wasm-bindgen module backs both png directions and its internal init is
// a singleton, so initializing either entry point covers the other. Accept
// whichever module key the caller filled in.
function loadPngEncode(modules?: WasmModules) {
  return once('png:encode', async () => {
    const mod = await import('@jsquash/png/encode.js')
    const wasm = modules?.encode ?? modules?.decode
    if (wasm) await mod.init(wasm)
    return mod.default
  })
}

function loadPngDecode(modules?: WasmModules) {
  return once('png:decode', async () => {
    const mod = await import('@jsquash/png/decode.js')
    const wasm = modules?.decode ?? modules?.encode
    if (wasm) await mod.init(wasm)
    return mod.default
  })
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

function jpegCodec(modules?: WasmModules): Encoder {
  return {
    id: 'jsquash-jpeg',
    format: 'jpeg',
    supportsAlpha: false,
    capabilities: { qualityRange: [1, 100], lossless: false },
    version: async () => jpegPkg.version,
    async encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array> {
      assertDimensionsMatchData(img)
      const encode = await loadJpegEncode(modules)
      const flat = flattenOntoWhite(img)
      const buf = await encode(toImageData(flat), {
        quality: clampQuality(opts.quality, ENCODER_DEFAULT_QUALITY.jpeg),
      })
      return new Uint8Array(buf)
    },
    async decode(bytes: Uint8Array): Promise<RawImage> {
      const decode = await loadJpegDecode(modules)
      return toRawImage(await decode(toArrayBuffer(bytes)))
    },
  }
}

function pngCodec(modules?: WasmModules): Encoder {
  return {
    id: 'jsquash-png',
    format: 'png',
    supportsAlpha: true,
    // png is always lossless; quality has no meaning and is ignored. Both
    // adapters advertise [0, 0] per the Encoder.capabilities contract in
    // @cupel/core so callers can tell the knob has no effect.
    capabilities: { qualityRange: [0, 0], lossless: true },
    version: async () => pngPkg.version,
    async encode(img: RawImage, _opts: EncodeOptions): Promise<Uint8Array> {
      assertDimensionsMatchData(img)
      const encode = await loadPngEncode(modules)
      const buf = await encode(toImageData(img))
      return new Uint8Array(buf)
    },
    async decode(bytes: Uint8Array): Promise<RawImage> {
      const decode = await loadPngDecode(modules)
      return toRawImage(await decode(toArrayBuffer(bytes)))
    },
  }
}

function webpCodec(modules?: WasmModules): Encoder {
  return {
    id: 'jsquash-webp',
    format: 'webp',
    supportsAlpha: true,
    capabilities: { qualityRange: [1, 100], lossless: true },
    version: async () => webpPkg.version,
    async encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array> {
      assertDimensionsMatchData(img)
      const encode = await loadWebpEncode(modules)
      const lossless = opts.lossless === true
      const buf = await encode(toImageData(img), {
        quality: clampQuality(opts.quality, ENCODER_DEFAULT_QUALITY.webp),
        // libwebp options are numeric flags, not booleans. exact preserves
        // RGB values in fully transparent pixels, required for a bit exact
        // lossless roundtrip.
        lossless: lossless ? 1 : 0,
        exact: lossless ? 1 : 0,
      })
      return new Uint8Array(buf)
    },
    async decode(bytes: Uint8Array): Promise<RawImage> {
      const decode = await loadWebpDecode(modules)
      return toRawImage(await decode(toArrayBuffer(bytes)))
    },
  }
}

function avifCodec(modules?: WasmModules): Encoder {
  return {
    id: 'jsquash-avif',
    format: 'avif',
    supportsAlpha: true,
    capabilities: { qualityRange: [1, 100], lossless: true },
    version: async () => avifPkg.version,
    async encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array> {
      assertDimensionsMatchData(img)
      const encode = await loadAvifEncode(modules)
      // The @jsquash/avif wrapper translates lossless: true into quality 100,
      // qualityAlpha -1, and YUV444 subsampling itself, and console.warns
      // when a conflicting quality is passed alongside lossless. Omit quality
      // entirely in that case so every lossless encode stays silent.
      const buf = await encode(
        toImageData(img),
        opts.lossless === true
          ? { lossless: true }
          : { quality: clampQuality(opts.quality, ENCODER_DEFAULT_QUALITY.avif) },
      )
      return new Uint8Array(buf)
    },
    async decode(bytes: Uint8Array): Promise<RawImage> {
      const decode = await loadAvifDecode(modules)
      return toRawImage(await decode(toArrayBuffer(bytes)))
    },
  }
}

/**
 * Returns an Encoder backed by the jSquash WASM build for the given format.
 *
 * When modules.encode or modules.decode are provided, the matching @jsquash
 * init function is called with the precompiled WebAssembly.Module before
 * first use (lazily, once, memoized per format and role for the process).
 * Without them the packages load their own .wasm assets, which works under
 * bundlers but rejects on first use in plain Node.
 *
 * decode always copies into a fresh Uint8ClampedArray backed RawImage.
 * encode maps opts.quality (clamped to 1..100; non-finite values fall back
 * to the shared ENCODER_DEFAULT_QUALITY defaults from @cupel/core) onto each
 * codec's native 0..100 quality scale and opts.lossless onto webp's lossless
 * and exact flags and avif's lossless option; png is inherently lossless and
 * jpeg is flattened onto white because mozjpeg has no alpha channel.
 */
export function wasmCodec(format: CodecFormat, modules?: WasmModules): Encoder {
  switch (format) {
    case 'jpeg':
      return jpegCodec(modules)
    case 'png':
      return pngCodec(modules)
    case 'webp':
      return webpCodec(modules)
    case 'avif':
      return avifCodec(modules)
  }
}
