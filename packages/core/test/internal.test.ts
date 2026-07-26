import { describe, expect, it } from 'vitest'
import { toGrayscale } from '../src/internal/luma.js'
import { areaAverageResize, bilinearResize, normalizeLongEdge } from '../src/internal/resample.js'
import { horizontalGradient, makeImage, noiseImage, solid } from './helpers/fixtures.js'

describe('toGrayscale', () => {
  it('maps white to 255 and black to 0', () => {
    const white = toGrayscale(solid(4, 4, [255, 255, 255]))
    const black = toGrayscale(solid(4, 4, [0, 0, 0]))
    expect(Array.from(white)).toEqual(Array(16).fill(255))
    expect(Array.from(black)).toEqual(Array(16).fill(0))
  })

  it('uses Rec. 601 weights', () => {
    const red = toGrayscale(solid(1, 1, [255, 0, 0]))
    expect(red[0]).toBeCloseTo(0.299 * 255, 6)
  })
})

describe('bilinearResize', () => {
  it('identity resize returns equal pixels in a fresh buffer', () => {
    const img = noiseImage(16, 12, 7)
    const same = bilinearResize(img, 16, 12)
    expect(same.data).not.toBe(img.data)
    expect(Array.from(same.data)).toEqual(Array.from(img.data))
  })

  it('keeps solids solid at any scale', () => {
    const img = solid(10, 10, [37, 141, 209])
    const up = bilinearResize(img, 23, 17)
    for (let i = 0; i < up.data.length; i += 4) {
      expect(up.data[i]).toBe(37)
      expect(up.data[i + 1]).toBe(141)
      expect(up.data[i + 2]).toBe(209)
    }
  })

  it('downsamples a gradient monotonically', () => {
    const img = horizontalGradient(64, 8)
    const down = bilinearResize(img, 16, 8)
    const row: number[] = []
    for (let x = 0; x < 16; x++) row.push(down.data[x * 4] ?? -1)
    const sorted = [...row].sort((a, b) => a - b)
    expect(row).toEqual(sorted)
  })
})

describe('areaAverageResize', () => {
  it('identity resize returns equal pixels in a fresh buffer', () => {
    const img = noiseImage(16, 12, 7)
    const same = areaAverageResize(img, 16, 12)
    expect(same.data).not.toBe(img.data)
    expect(Array.from(same.data)).toEqual(Array.from(img.data))
  })

  it('keeps solids solid at non-integer downscale ratios', () => {
    const img = solid(23, 17, [37, 141, 209])
    const down = areaAverageResize(img, 10, 7)
    expect(down.width).toBe(10)
    expect(down.height).toBe(7)
    for (let i = 0; i < down.data.length; i += 4) {
      expect(down.data[i]).toBe(37)
      expect(down.data[i + 1]).toBe(141)
      expect(down.data[i + 2]).toBe(209)
      expect(down.data[i + 3]).toBe(255)
    }
  })

  it('2x downscale of a 1px checkerboard yields the exact box means', () => {
    // Every 2x2 source box holds two 100s and two 200s in each channel, so
    // each output pixel must be exactly 150. Integer boxes mean the weights
    // are all exactly 1 and the mean is exact, no rounding involved.
    const board = makeImage(16, 16, (x, y) => {
      const v = (x + y) % 2 === 0 ? 100 : 200
      return [v, v, v, 255]
    })
    const down = areaAverageResize(board, 8, 8)
    for (let i = 0; i < down.data.length; i += 4) {
      expect(down.data[i]).toBe(150)
      expect(down.data[i + 1]).toBe(150)
      expect(down.data[i + 2]).toBe(150)
      expect(down.data[i + 3]).toBe(255)
    }
  })

  it('downsamples a gradient monotonically at a fractional ratio', () => {
    // 64 -> 24 gives xRatio 8/3, exercising the fractional edge weights.
    const img = horizontalGradient(64, 8)
    const down = areaAverageResize(img, 24, 8)
    const row: number[] = []
    for (let x = 0; x < 24; x++) row.push(down.data[x * 4] ?? -1)
    const sorted = [...row].sort((a, b) => a - b)
    expect(row).toEqual(sorted)
  })

  it('rejects invalid targets like bilinearResize does', () => {
    const img = solid(8, 8, [1, 2, 3])
    expect(() => areaAverageResize(img, 0, 8)).toThrow(/invalid target/)
    expect(() => areaAverageResize(img, 8, -1)).toThrow(/invalid target/)
    expect(() => areaAverageResize(img, 4.5, 8)).toThrow(/invalid target/)
  })
})

describe('normalizeLongEdge', () => {
  it('scales the long edge down and preserves aspect', () => {
    const img = solid(2048, 1024, [1, 2, 3])
    const norm = normalizeLongEdge(img, 1024)
    expect(norm.width).toBe(1024)
    expect(norm.height).toBe(512)
  })

  it('produces the same dimensions as the old bilinear path (fractional case)', () => {
    // 1100x825 scales by 1024/1100: width 1024, height exactly 768. The
    // switch to area averaging changed pixel values, never geometry.
    const img = noiseImage(1100, 825, 3)
    const norm = normalizeLongEdge(img, 1024)
    expect(norm.width).toBe(1024)
    expect(norm.height).toBe(768)
  })

  it('never upscales', () => {
    const img = solid(100, 50, [1, 2, 3])
    const norm = normalizeLongEdge(img, 1024)
    expect(norm.width).toBe(100)
    expect(norm.height).toBe(50)
  })
})
