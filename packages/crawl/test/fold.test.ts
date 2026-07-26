import { describe, expect, it } from 'vitest'
import type { DisplayEstimate } from '../src/dims.js'
import { estimateFold } from '../src/fold.js'

const VP = { width: 1440, height: 900 }

function sized(width: number, height: number, lazy = false) {
  return { display: { width, height, estimated: true } satisfies DisplayEstimate, lazy }
}

function unsized() {
  return { display: { estimated: false } satisfies DisplayEstimate, lazy: false }
}

describe('estimateFold: above-the-fold heuristic', () => {
  it('treats every non-lazy asset as above the fold when no heights are known', () => {
    // With no height information the heuristic is deliberately optimistic:
    // unknown heights contribute nothing to the stack, so nothing is pushed
    // below the fold. The alternative (guessing below-fold) would silently
    // deflate weights in the allocator; over-weighting is the safer error.
    const result = estimateFold([unsized(), unsized(), unsized()], VP)
    expect(result.aboveFold).toEqual([true, true, true])
  })

  it('stacks estimated heights in document order to find the fold', () => {
    // Assets are assumed to stack vertically: each top offset is the sum of
    // the estimated heights before it. Tops here are 0, 500, and 1000, and
    // only tops strictly inside the 900px viewport are above the fold.
    const result = estimateFold([sized(600, 500), sized(600, 500), sized(600, 500)], VP)
    expect(result.aboveFold).toEqual([true, true, false])
  })

  it('treats loading="lazy" as below the fold regardless of position', () => {
    // loading="lazy" is an author signal that the image is not needed for
    // first paint. The lazy asset still occupies layout space: tops are
    // 0, 600, and 900, so the third asset falls below the fold because of it.
    const result = estimateFold([sized(800, 600, true), sized(400, 300), sized(100, 100)], VP)
    expect(result.aboveFold).toEqual([false, true, false])
  })

  it('returns empty output for empty input', () => {
    const result = estimateFold([], VP)
    expect(result.aboveFold).toEqual([])
    expect(result.lcpIndex).toBeUndefined()
  })
})

describe('estimateFold: LCP guess', () => {
  it('guesses the largest estimated above-fold area as the LCP', () => {
    const result = estimateFold([sized(800, 600), sized(1000, 500)], VP)
    expect(result.lcpIndex).toBe(1)
  })

  it('breaks area ties in favour of the earliest element in document order', () => {
    // Documented tie-break: equal areas go to the first asset in document
    // order, because earlier markup tends to paint earlier.
    const result = estimateFold([sized(800, 600), sized(600, 800)], VP)
    expect(result.lcpIndex).toBe(0)
  })

  it('never picks a below-fold asset as the LCP', () => {
    // The second asset is far larger but its top offset (900) is at the
    // fold, so the smaller above-fold asset wins.
    const result = estimateFold([sized(400, 900), sized(1400, 900)], VP)
    expect(result.aboveFold).toEqual([true, false])
    expect(result.lcpIndex).toBe(0)
  })

  it('ignores assets without a full width and height estimate', () => {
    const widthOnly = { display: { width: 1200, estimated: true } satisfies DisplayEstimate, lazy: false }
    const result = estimateFold([widthOnly, sized(10, 10)], VP)
    expect(result.lcpIndex).toBe(1)
  })

  it('guesses no LCP when nothing above the fold has a full estimate', () => {
    const result = estimateFold([unsized(), sized(1400, 900, true)], VP)
    expect(result.lcpIndex).toBeUndefined()
  })
})
