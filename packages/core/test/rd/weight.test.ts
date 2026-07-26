import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AREA_EXPONENT,
  roleFactorFor,
  viewportFactorAtDepth,
  visualWeight,
} from '../../src/rd/weight.js'

describe('visualWeight', () => {
  it('is area^alpha with both factors defaulted to 1', () => {
    expect(visualWeight({ displayAreaCssPx: 10000 })).toBeCloseTo(Math.pow(10000, 0.6), 12)
  })

  it('multiplies in viewport and role factors per brief 3.3', () => {
    const w = visualWeight({ displayAreaCssPx: 10000, viewportFactor: 0.3, roleFactor: 1.5 })
    expect(w).toBeCloseTo(Math.pow(10000, 0.6) * 0.3 * 1.5, 12)
  })

  it('defaults alpha to 0.6 and accepts an override', () => {
    expect(DEFAULT_AREA_EXPONENT).toBe(0.6)
    expect(visualWeight({ displayAreaCssPx: 512 * 384 }, 0.5)).toBeCloseTo(
      Math.sqrt(512 * 384),
      9,
    )
  })

  it('is sublinear in area: doubling area less than doubles weight', () => {
    const one = visualWeight({ displayAreaCssPx: 40000 })
    const two = visualWeight({ displayAreaCssPx: 80000 })
    expect(two).toBeGreaterThan(one)
    expect(two).toBeLessThan(2 * one)
    expect(two / one).toBeCloseTo(Math.pow(2, 0.6), 12)
  })

  it('gives zero weight to zero display area', () => {
    expect(visualWeight({ displayAreaCssPx: 0 })).toBe(0)
  })

  it('rejects invalid inputs instead of returning NaN', () => {
    expect(() => visualWeight({ displayAreaCssPx: Number.NaN })).toThrow(/displayAreaCssPx/i)
    expect(() => visualWeight({ displayAreaCssPx: -1 })).toThrow(/displayAreaCssPx/i)
    expect(() => visualWeight({ displayAreaCssPx: 1, viewportFactor: -0.1 })).toThrow(
      /viewportFactor/i,
    )
    expect(() => visualWeight({ displayAreaCssPx: 1, roleFactor: Number.NaN })).toThrow(
      /roleFactor/i,
    )
    expect(() => visualWeight({ displayAreaCssPx: 1 }, 0)).toThrow(/alpha/i)
    expect(() => visualWeight({ displayAreaCssPx: 1 }, 1.2)).toThrow(/alpha/i)
  })
})

describe('viewportFactorAtDepth', () => {
  it('is 1.0 above the fold (depth 0 and anything on-screen)', () => {
    expect(viewportFactorAtDepth(0)).toBe(1)
    expect(viewportFactorAtDepth(-3)).toBe(1)
  })

  it('decays to 0.3 at two viewport heights down and stays there', () => {
    expect(viewportFactorAtDepth(2)).toBeCloseTo(0.3, 12)
    expect(viewportFactorAtDepth(5)).toBeCloseTo(0.3, 12)
    expect(viewportFactorAtDepth(100)).toBeCloseTo(0.3, 12)
  })

  it('decreases monotonically between the fold and two viewports', () => {
    const depths = [0, 0.5, 1, 1.5, 2]
    const factors = depths.map(viewportFactorAtDepth)
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i] ?? Number.NaN).toBeLessThan(factors[i - 1] ?? Number.NaN)
    }
    // Midpoint of the linear decay.
    expect(viewportFactorAtDepth(1)).toBeCloseTo(0.65, 12)
  })

  it('rejects non-finite depth', () => {
    expect(() => viewportFactorAtDepth(Number.NaN)).toThrow(/depth/i)
  })
})

describe('roleFactorFor', () => {
  it('maps roles to the brief 3.3 factors', () => {
    expect(roleFactorFor('lcp')).toBe(1.5)
    expect(roleFactorFor('content')).toBe(1)
    expect(roleFactorFor('decorative')).toBe(0.6)
  })
})
