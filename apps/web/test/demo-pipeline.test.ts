// The landing page demo, run against the real wasm codecs in Node.
//
// This is the test that keeps the front page honest. The copy next to the
// picker makes three specific promises: the fresh photo gets noticeably
// smaller, the already compressed copy gets refused, and the photo saved as
// PNG saves a lot. If any of those stops being true, this fails and the claim
// gets fixed before it ships.
//
// The wasm builds cannot self-load in plain Node, so the modules are read from
// the @jsquash packages and handed to wasmCodec precompiled, the same
// injection path the adapter tests use.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Encoder, RawImage } from '@cupel/core'
import { wasmCodec } from '@cupel/codecs-wasm'
import type { CodecFormat } from '@cupel/codecs-wasm'
import { buildSampleFile, runDemo, type DemoCodecs, type EncodeFormat } from '../lib/demo/pipeline'
import { buildScene } from '../lib/demo/scenes'

const LONG = 240_000

const WASM_PATHS: Record<EncodeFormat, { encode: string; decode: string }> = {
  jpeg: { encode: 'codec/enc/mozjpeg_enc.wasm', decode: 'codec/dec/mozjpeg_dec.wasm' },
  png: { encode: 'codec/pkg/squoosh_png_bg.wasm', decode: 'codec/pkg/squoosh_png_bg.wasm' },
  webp: { encode: 'codec/enc/webp_enc.wasm', decode: 'codec/dec/webp_dec.wasm' },
}

async function compileWasm(format: string, rel: string): Promise<WebAssembly.Module> {
  const url = new URL(
    `../../../packages/codecs-wasm/node_modules/@jsquash/${format}/${rel}`,
    import.meta.url,
  )
  return WebAssembly.compile(await readFile(fileURLToPath(url)))
}

const codecCache = new Map<CodecFormat, Promise<Encoder>>()

function codec(format: EncodeFormat): Promise<Encoder> {
  let cached = codecCache.get(format)
  if (!cached) {
    cached = (async () => {
      const paths = WASM_PATHS[format]
      return wasmCodec(format, {
        encode: await compileWasm(format, paths.encode),
        decode: await compileWasm(format, paths.decode),
      })
    })()
    codecCache.set(format, cached)
  }
  return cached
}

const codecs: DemoCodecs = {
  async encode(format, image, quality) {
    return (await codec(format)).encode(image, quality === null ? {} : { quality })
  },
  async decode(format, bytes) {
    return (await codec(format)).decode(bytes)
  },
}

describe('demo scenes', () => {
  it('are deterministic and fully opaque', () => {
    const a = buildScene('coast')
    const b = buildScene('coast')
    expect(a.width).toBe(720)
    expect(a.height).toBe(480)
    expect(Array.from(a.data.slice(0, 4096))).toEqual(Array.from(b.data.slice(0, 4096)))
    for (let i = 3; i < a.data.length; i += 4) {
      if (a.data[i] !== 255) throw new Error(`alpha at pixel ${(i - 3) / 4} is not opaque`)
    }
  })

  it('draws two visibly different scenes', () => {
    const coast = buildScene('coast')
    const garden = buildScene('garden')
    let differing = 0
    for (let i = 0; i < coast.data.length; i += 4) {
      if (Math.abs((coast.data[i] ?? 0) - (garden.data[i] ?? 0)) > 24) differing++
    }
    // Two different photographs, not one image with a filter on it.
    expect(differing).toBeGreaterThan(0.4 * (coast.width * coast.height))
  })
})

describe('the three landing page promises', () => {
  it('sample one: a fresh photo gets meaningfully smaller', { timeout: LONG }, async () => {
    const file = await buildSampleFile('fresh', codecs)
    const result = await runDemo(file, codecs)

    expect(result.verdict, `expected a saving, got: ${result.technicalReason}`).toBe('saved')
    expect(result.output).not.toBeNull()
    // The copy says "much smaller". Hold it to at least a quarter off.
    expect(result.output?.savedFraction).toBeGreaterThan(0.25)
    // And it has to still look like the original.
    expect(result.output?.similarity).toBeGreaterThan(0.97)
    expect(result.quality.left).toBe('plenty')
  })

  it(
    'sample two: a photo the pipeline already crushed is refused, and costs nothing to refuse',
    { timeout: LONG },
    async () => {
      const file = await buildSampleFile('squeezed', codecs)
      const result = await runDemo(file, codecs)

      expect(result.verdict, `expected a refusal, got: ${result.technicalReason}`).toBe('stopped')
      expect(result.output).toBeNull()
      expect(result.quality.left).toBe('none')
      // Refusing must happen before any encode runs.
      expect(result.candidatesMeasured).toBe(0)
      expect(result.technicalReason).toMatch(/headroom none/)
    },
  )

  it('sample three: a photo saved as PNG saves a lot', { timeout: LONG }, async () => {
    const file = await buildSampleFile('png', codecs)
    const result = await runDemo(file, codecs)

    expect(result.verdict, `expected a saving, got: ${result.technicalReason}`).toBe('saved')
    // The copy calls this "the biggest easy win there is".
    expect(result.output?.savedFraction).toBeGreaterThan(0.7)
    expect(result.output?.similarity).toBeGreaterThan(0.97)
  })

  it(
    'the two coast samples are the same picture at different sizes',
    { timeout: LONG },
    async () => {
      const fresh = await buildSampleFile('fresh', codecs)
      const squeezed = await buildSampleFile('squeezed', codecs)
      // Same scene, so the crushed copy must be the smaller file.
      expect(squeezed.bytes.length).toBeLessThan(fresh.bytes.length)
      expect(fresh.container).toBe('jpeg')
      expect(squeezed.container).toBe('jpeg')
    },
  )
})

describe('runDemo on arbitrary input', () => {
  it('refuses a container it cannot read rather than guessing', async () => {
    const bogus: RawImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
    void bogus
    await expect(
      runDemo({ bytes: new Uint8Array([1, 2, 3]), container: 'gif' }, codecs),
    ).rejects.toThrow(/jpeg, png, and webp/)
  })
})
