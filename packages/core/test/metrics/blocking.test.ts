import { describe, expect, it } from 'vitest'
import type { RawImage } from '../../src/types.js'
import { blockingScore } from '../../src/metrics/blocking.js'
import { blockQuantize8, horizontalGradient, noiseImage, solid } from '../helpers/fixtures.js'

/**
 * Crops `left` pixels off the left edge and `top` off the top edge. Defined
 * locally because the fixtures module has no crop helper; the phase
 * sensitivity test needs one to knock block boundaries off the x % 8 === 0
 * grid without changing any pixel values.
 */
function crop(img: RawImage, left: number, top: number): RawImage {
  const width = img.width - left
  const height = img.height - top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((y + top) * img.width + (x + left)) * 4
      const dst = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        data[dst + c] = img.data[src + c] ?? 0
      }
    }
  }
  return { width, height, data }
}

describe('blockingScore', () => {
  it('scores a synthetic 8x8 blocked image high on both axes', () => {
    // Inside each quantized block the image is constant, so interior
    // gradients are ~0 while boundary gradients stay large. The ratio must
    // come out far above neutral on both axes independently.
    const blocked = blockQuantize8(noiseImage(256, 256, 42))
    const score = blockingScore(blocked)
    expect(score.horizontal).toBeGreaterThan(2.0)
    expect(score.vertical).toBeGreaterThan(2.0)
    expect(score.combined).toBeGreaterThan(2.0)
  })

  it('scores a smooth gradient low', () => {
    const score = blockingScore(horizontalGradient(256, 256))
    expect(score.combined).toBeLessThan(1.2)
  })

  it('returns exactly 1.0 for blockQuantize8 of a solid image', () => {
    // Quantizing a solid leaves it solid: flat everywhere, neutral by the
    // flat image convention, not merely close to 1.
    const score = blockingScore(blockQuantize8(solid(256, 256, [90, 160, 220])))
    expect(score.horizontal).toBe(1)
    expect(score.vertical).toBe(1)
    expect(score.combined).toBe(1)
  })

  it('scores pure noise near 1.0, no privileged boundaries', () => {
    const score = blockingScore(noiseImage(256, 256, 7))
    expect(score.combined).toBeGreaterThan(0.9)
    expect(score.combined).toBeLessThan(1.1)
  })

  it('is phase sensitive: a 4 px crop off left and top drops the score', () => {
    // After the crop the real block boundaries sit at x % 8 === 4, so a
    // correct x % 8 === 0 detector must see far less boundary energy. An
    // off-by-one in the boundary column indexing would invert this ordering.
    const aligned = blockQuantize8(noiseImage(256, 256, 11))
    const shifted = crop(aligned, 4, 4)
    const alignedScore = blockingScore(aligned)
    const shiftedScore = blockingScore(shifted)
    expect(alignedScore.combined).toBeGreaterThan(1.5 * shiftedScore.combined)
  })

  it('returns exactly neutral for a flat solid image', () => {
    const score = blockingScore(solid(64, 64, [128, 128, 128]))
    expect(score).toEqual({ horizontal: 1, vertical: 1, combined: 1 })
  })

  it('handles non multiple-of-8 dimensions without throwing', () => {
    const img = blockQuantize8(noiseImage(250, 131, 3))
    expect(() => blockingScore(img)).not.toThrow()
    const score = blockingScore(img)
    expect(Number.isFinite(score.horizontal)).toBe(true)
    expect(Number.isFinite(score.vertical)).toBe(true)
    expect(Number.isFinite(score.combined)).toBe(true)
  })

  it('returns neutral for an axis too small to measure', () => {
    // Width 16 is below the 17 px minimum extent, so the horizontal axis
    // has no statistically meaningful boundary/interior split and must be
    // reported as neutral. The 64 px vertical axis is still measured.
    const score = blockingScore(noiseImage(16, 64, 5))
    expect(score.horizontal).toBe(1)
    expect(Number.isFinite(score.vertical)).toBe(true)
  })
})
