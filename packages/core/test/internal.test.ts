import { describe, expect, it } from 'vitest'
import { toGrayscale } from '../src/internal/luma.js'
import { bilinearResize, normalizeLongEdge } from '../src/internal/resample.js'
import { horizontalGradient, noiseImage, solid } from './helpers/fixtures.js'

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

describe('normalizeLongEdge', () => {
  it('scales the long edge down and preserves aspect', () => {
    const img = solid(2048, 1024, [1, 2, 3])
    const norm = normalizeLongEdge(img, 1024)
    expect(norm.width).toBe(1024)
    expect(norm.height).toBe(512)
  })

  it('never upscales', () => {
    const img = solid(100, 50, [1, 2, 3])
    const norm = normalizeLongEdge(img, 1024)
    expect(norm.width).toBe(100)
    expect(norm.height).toBe(50)
  })
})
