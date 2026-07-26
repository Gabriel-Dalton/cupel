import { describe, expect, it } from 'vitest'
import { CIE76_JND_DELTA_E, DEFAULT_KAPPA, distortion } from '../../src/rd/distortion.js'

describe('distortion', () => {
  it('is exactly 0 for a perfect reproduction (ssim 1, deltaE 0)', () => {
    expect(distortion(1, 0)).toBe(0)
  })

  it('matches the brief formula d = (1 - ssim) + kappa * min(deltaE / 2.3, 1)', () => {
    // Below the JND: deltaE 1.15 is exactly half of 2.3, so the chroma term
    // contributes kappa * 0.5.
    expect(distortion(0.95, 1.15, 0.5)).toBeCloseTo(0.05 + 0.5 * 0.5, 12)
    expect(distortion(0.9, 0, 0.5)).toBeCloseTo(0.1, 12)
  })

  it('saturates the deltaE term at the CIE76 just-noticeable-difference', () => {
    // Any deltaE at or beyond 2.3 contributes exactly kappa, no more. A
    // catastrophic chroma error must not be able to dominate the SSIM term
    // without bound.
    expect(distortion(1, CIE76_JND_DELTA_E, 0.5)).toBeCloseTo(0.5, 12)
    expect(distortion(1, 100, 0.5)).toBeCloseTo(0.5, 12)
    expect(distortion(1, 1e9, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('defaults kappa to 0.5 per the brief', () => {
    expect(DEFAULT_KAPPA).toBe(0.5)
    expect(distortion(0.98, 4.6)).toBeCloseTo(distortion(0.98, 4.6, 0.5), 15)
  })

  it('is monotone: worse ssim or larger deltaE never decreases distortion', () => {
    expect(distortion(0.9, 1)).toBeGreaterThan(distortion(0.95, 1))
    expect(distortion(0.95, 2)).toBeGreaterThan(distortion(0.95, 1))
    // Beyond saturation, more deltaE changes nothing.
    expect(distortion(0.95, 50)).toBe(distortion(0.95, 10))
  })

  it('exposes the JND constant used for normalization', () => {
    expect(CIE76_JND_DELTA_E).toBe(2.3)
  })

  it('rejects non-finite or out-of-range inputs instead of returning NaN', () => {
    expect(() => distortion(Number.NaN, 0)).toThrow(/ssim/i)
    expect(() => distortion(1.5, 0)).toThrow(/ssim/i)
    expect(() => distortion(-1.5, 0)).toThrow(/ssim/i)
    expect(() => distortion(1, Number.NaN)).toThrow(/deltaE/i)
    expect(() => distortion(1, -0.1)).toThrow(/deltaE/i)
    expect(() => distortion(1, 0, Number.NaN)).toThrow(/kappa/i)
    expect(() => distortion(1, 0, -0.5)).toThrow(/kappa/i)
  })

  it('accepts slightly negative ssim (anti-correlated windows are legal)', () => {
    // Windowed SSIM means can dip below zero on adversarial content; the
    // distortion model must accept that and produce a value above 1.
    expect(distortion(-0.2, 0)).toBeCloseTo(1.2, 12)
  })
})
