import { describe, expect, it } from 'vitest'
import type { RawImage } from '@cupel/core'
import {
  MAX_FILE_BYTES,
  MAX_REFERENCE_EDGE,
  downscaleTo,
  fitWithin,
  flattenOntoWhite,
  hasTransparency,
  prepareReference,
  sniffContainer,
} from '../lib/playground/ingest'

/**
 * Ingest: container sniffing from signature bytes, alpha flattening, and the
 * area-average downscale that caps the playground reference. All fixtures
 * are generated in code; no binary blobs.
 */

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

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0))
}

describe('sniffContainer', () => {
  it('recognizes the jpeg SOI marker', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF')])
    expect(sniffContainer(bytes)).toBe('jpeg')
  })

  it('recognizes the png signature', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    expect(sniffContainer(bytes)).toBe('png')
  })

  it('recognizes a RIFF WEBP header', () => {
    const bytes = new Uint8Array([...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')])
    expect(sniffContainer(bytes)).toBe('webp')
  })

  it('recognizes an avif ftyp box by its major brand', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, ...ascii('ftyp'), ...ascii('avif'),
      0x00, 0x00, 0x00, 0x00, ...ascii('avif'), ...ascii('mif1'),
    ])
    expect(sniffContainer(bytes)).toBe('avif')
  })

  it('recognizes an avif ftyp box by a compatible brand when the major brand differs', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, ...ascii('ftyp'), ...ascii('mif1'),
      0x00, 0x00, 0x00, 0x00, ...ascii('miaf'), ...ascii('avif'),
    ])
    expect(sniffContainer(bytes)).toBe('avif')
  })

  it('returns null for a non-avif ftyp box (e.g. an mp4)', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, ...ascii('ftyp'), ...ascii('isom'),
      0x00, 0x00, 0x02, 0x00, ...ascii('isom'), ...ascii('mp41'),
    ])
    expect(sniffContainer(bytes)).toBeNull()
  })

  it('returns null for garbage, truncated, and empty inputs', () => {
    expect(sniffContainer(new Uint8Array(64).fill(0xab))).toBeNull()
    expect(sniffContainer(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffContainer(new Uint8Array([]))).toBeNull()
  })
})

describe('hasTransparency and flattenOntoWhite', () => {
  it('reports transparency only when some alpha is below 255', () => {
    const opaque = makeImage(4, 4, () => [10, 20, 30, 255])
    expect(hasTransparency(opaque)).toBe(false)
    const holed = makeImage(4, 4, (x, y) => [10, 20, 30, x === 3 && y === 3 ? 254 : 255])
    expect(hasTransparency(holed)).toBe(true)
  })

  it('composites onto white: fully transparent becomes white, opaque is untouched', () => {
    const img = makeImage(2, 1, (x) => (x === 0 ? [200, 40, 0, 0] : [200, 40, 0, 255]))
    const flat = flattenOntoWhite(img)
    expect([flat.data[0], flat.data[1], flat.data[2], flat.data[3]]).toEqual([255, 255, 255, 255])
    expect([flat.data[4], flat.data[5], flat.data[6], flat.data[7]]).toEqual([200, 40, 0, 255])
  })

  it('composites partial alpha with source-over arithmetic', () => {
    // a = 51/255 = 0.2: r = 0.2 * 200 + 0.8 * 255 = 244, g = 8 + 204 = 212,
    // b = 0 + 204 = 204. All exact in IEEE754, so the bytes are exact.
    const img = makeImage(1, 1, () => [200, 40, 0, 51])
    const flat = flattenOntoWhite(img)
    expect([flat.data[0], flat.data[1], flat.data[2], flat.data[3]]).toEqual([244, 212, 204, 255])
  })

  it('does not mutate its input', () => {
    const img = makeImage(2, 2, () => [10, 20, 30, 128])
    const before = new Uint8ClampedArray(img.data)
    flattenOntoWhite(img)
    expect(img.data).toEqual(before)
  })
})

describe('fitWithin', () => {
  it('caps the long edge and scales the short edge proportionally', () => {
    expect(fitWithin(4096, 2048, 1024)).toEqual({ width: 1024, height: 512 })
    expect(fitWithin(2048, 4096, 1024)).toEqual({ width: 512, height: 1024 })
  })

  it('leaves images already inside the cap alone', () => {
    expect(fitWithin(100, 50, 1024)).toEqual({ width: 100, height: 50 })
    expect(fitWithin(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024 })
  })

  it('rounds the short edge and never lets it reach zero', () => {
    expect(fitWithin(1000, 333, 100)).toEqual({ width: 100, height: 33 })
    expect(fitWithin(10000, 3, 1024)).toEqual({ width: 1024, height: 1 })
  })
})

describe('downscaleTo', () => {
  it('returns the input object untouched when the image is inside the cap', () => {
    const img = makeImage(8, 8, () => [1, 2, 3, 255])
    expect(downscaleTo(img, 8)).toBe(img)
  })

  it('preserves a uniform color exactly', () => {
    const img = makeImage(64, 64, () => [40, 90, 200, 255])
    const out = downscaleTo(img, 16)
    expect(out.width).toBe(16)
    expect(out.height).toBe(16)
    for (let i = 0; i < out.data.length; i += 4) {
      expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([
        40, 90, 200, 255,
      ])
    }
  })

  it('averages exactly: a 2px checkerboard halved keeps the pattern, quartered goes mid-gray', () => {
    const board = makeImage(8, 8, (x, y) => {
      const v = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 255 : 0
      return [v, v, v, 255]
    })
    // maxEdge 4: each output pixel covers one uniform 2x2 cell.
    const half = downscaleTo(board, 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const want = (x + y) % 2 === 0 ? 255 : 0
        expect(half.data[(y * 4 + x) * 4]).toBe(want)
      }
    }
    // maxEdge 2: each output pixel covers a 4x4 area, half black half white,
    // mean 127.5, which the implementation rounds to 128.
    const quarter = downscaleTo(board, 2)
    for (let i = 0; i < quarter.data.length; i += 4) {
      expect(quarter.data[i]).toBe(128)
    }
  })

  it('respects aspect ratio', () => {
    const img = makeImage(64, 32, () => [7, 7, 7, 255])
    const out = downscaleTo(img, 16)
    expect(out.width).toBe(16)
    expect(out.height).toBe(8)
  })
})

describe('prepareReference', () => {
  it('passes an opaque, in-cap image through by reference', () => {
    const img = makeImage(16, 16, () => [9, 9, 9, 255])
    const prep = prepareReference(img, 1024)
    expect(prep.reference).toBe(img)
    expect(prep.flattened).toBe(false)
    expect(prep.downscaled).toBe(false)
  })

  it('flattens transparency, then downscales, and reports both', () => {
    const img = makeImage(64, 64, () => [10, 20, 30, 0])
    const prep = prepareReference(img, 32)
    expect(prep.flattened).toBe(true)
    expect(prep.downscaled).toBe(true)
    expect(prep.reference.width).toBe(32)
    // Fully transparent input flattens to white before scaling.
    expect(prep.reference.data[0]).toBe(255)
    expect(prep.reference.data[3]).toBe(255)
  })

  it('exports the documented caps', () => {
    expect(MAX_REFERENCE_EDGE).toBe(1024)
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024)
  })
})
