import { describe, expect, it } from 'vitest'
import { gaussianBlur, makeImage, noiseImage, solid, upscale2x } from '../helpers/fixtures.js'
import { effectiveResolution, radialPowerSpectrum } from '../../src/metrics/spectrum.js'

describe('radialPowerSpectrum', () => {
  it('returns 64 finite, non negative bins for noise', () => {
    const spec = radialPowerSpectrum(noiseImage(256, 256, 7))
    expect(spec.length).toBe(64)
    for (let b = 0; b < spec.length; b++) {
      const v = spec[b] ?? Number.NaN
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('has near zero DC after mean subtraction, peak at the grating frequency', () => {
    // A horizontal grating at 0.25 cycles/sample puts all of its energy near
    // bin 32 and nothing near DC, so bin 0 isolates the mean subtraction:
    // without it, the mean of 128 would make bin 0 dominate everything.
    const grating = makeImage(256, 256, (x) => {
      const v = Math.round(128 + 100 * Math.sin(2 * Math.PI * 0.25 * x))
      return [v, v, v, 255]
    })
    const spec = radialPowerSpectrum(grating)
    let peak = 0
    let peakBin = 0
    for (let b = 0; b < spec.length; b++) {
      const v = spec[b] ?? 0
      if (v > peak) {
        peak = v
        peakBin = b
      }
    }
    expect(peak).toBeGreaterThan(0)
    expect(peakBin).toBeGreaterThanOrEqual(30)
    expect(peakBin).toBeLessThanOrEqual(34)
    expect(spec[0] ?? 0).toBeLessThan(peak * 1e-3)
  })

  it('accepts non square, non power of two input via the analysis resize', () => {
    const spec = radialPowerSpectrum(noiseImage(200, 100, 3))
    expect(spec.length).toBe(64)
    for (let b = 0; b < spec.length; b++) {
      expect(Number.isFinite(spec[b] ?? Number.NaN)).toBe(true)
    }
  })

  it('throws on images smaller than 16x16', () => {
    expect(() => radialPowerSpectrum(noiseImage(8, 8, 1))).toThrow()
  })
})

describe('effectiveResolution', () => {
  it('reports near full spectrum occupancy for native noise', () => {
    const res = effectiveResolution(noiseImage(256, 256, 42))
    expect(res.declared).toEqual({ w: 256, h: 256 })
    expect(res.cutoffRatio).toBeGreaterThan(0.8)
  })

  it('detects a 2x bilinear upscale as roughly half the declared resolution', () => {
    const base = noiseImage(128, 128, 42)
    const up = upscale2x(base)
    const res = effectiveResolution(up)
    expect(res.declared).toEqual({ w: 256, h: 256 })
    expect(res.cutoffRatio).toBeGreaterThanOrEqual(0.35)
    expect(res.cutoffRatio).toBeLessThanOrEqual(0.65)
    expect(res.effective.w).toBeGreaterThanOrEqual(90)
    expect(res.effective.w).toBeLessThanOrEqual(166)
  })

  it('is strictly monotone under increasing blur', () => {
    const noise = noiseImage(256, 256, 11)
    const native = effectiveResolution(noise).cutoffRatio
    const mild = effectiveResolution(gaussianBlur(noise, 0.8)).cutoffRatio
    const heavy = effectiveResolution(gaussianBlur(noise, 2.0)).cutoffRatio
    expect(heavy).toBeLessThan(mild)
    expect(mild).toBeLessThan(native)
  })

  it('returns the no content minimum for a solid image without crashing', () => {
    const res = effectiveResolution(solid(64, 64, [128, 128, 128]))
    expect(res.cutoffRatio).toBeGreaterThan(0)
    expect(res.cutoffRatio).toBeLessThanOrEqual(0.05)
    expect(Number.isFinite(res.effective.w)).toBe(true)
    expect(Number.isFinite(res.effective.h)).toBe(true)
  })

  it('handles a 200x100 image and rejects an 8x8 image', () => {
    const res = effectiveResolution(noiseImage(200, 100, 5))
    expect(res.declared).toEqual({ w: 200, h: 100 })
    expect(res.cutoffRatio).toBeGreaterThan(0)
    expect(res.cutoffRatio).toBeLessThanOrEqual(1)
    expect(() => effectiveResolution(noiseImage(8, 8, 1))).toThrow()
  })
})
