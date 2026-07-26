import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEWPORT, estimateDisplayDims } from '../src/dims.js'

const VP = { width: 1440, height: 900 }

describe('DEFAULT_VIEWPORT', () => {
  it('is the assumed desktop viewport of 1440x900', () => {
    // BRIEF does not pin a number, so 1440x900 is the documented default;
    // see the crawl package README and the PageCrawl notes.
    expect(DEFAULT_VIEWPORT).toEqual({ width: 1440, height: 900 })
  })
})

describe('estimateDisplayDims', () => {
  it('uses width/height attributes as pixel estimates', () => {
    const d = estimateDisplayDims({ attrWidth: 800, attrHeight: 600, css: {} }, VP)
    expect(d).toEqual({ width: 800, height: 600, estimated: true })
  })

  it('lets CSS declarations override attributes', () => {
    const d = estimateDisplayDims({ attrWidth: 800, attrHeight: 600, css: { width: '400px' } }, VP)
    expect(d.width).toBe(400)
    expect(d.height).toBe(600)
  })

  it('resolves percentages against the assumed viewport', () => {
    const d = estimateDisplayDims({ css: { width: '50%', height: '50%' } }, VP)
    expect(d.width).toBe(720)
    expect(d.height).toBe(450)
  })

  it('resolves vw and vh units against the assumed viewport', () => {
    const d = estimateDisplayDims({ css: { width: '25vw', height: '40vh' } }, VP)
    expect(d.width).toBe(360)
    expect(d.height).toBe(360)
  })

  it('clamps the estimated width to the viewport and scales attribute height with it', () => {
    const d = estimateDisplayDims({ attrWidth: 2880, attrHeight: 1800, css: {} }, VP)
    expect(d.width).toBe(1440)
    expect(d.height).toBe(900)
  })

  it('keeps an explicit CSS height when clamping width', () => {
    const d = estimateDisplayDims({ attrWidth: 2880, css: { height: '500px' } }, VP)
    expect(d).toEqual({ width: 1440, height: 500, estimated: true })
  })

  it('ignores values it cannot resolve statically: auto, em, calc', () => {
    const d = estimateDisplayDims({ css: { width: 'auto', height: 'calc(100% - 2rem)' } }, VP)
    expect(d).toEqual({ estimated: false })
    expect(estimateDisplayDims({ css: { width: '10em' } }, VP).estimated).toBe(false)
  })

  it('returns no estimate when nothing is declared', () => {
    const d = estimateDisplayDims({ css: {} }, VP)
    expect(d.estimated).toBe(false)
    expect(d.width).toBeUndefined()
    expect(d.height).toBeUndefined()
  })

  it('ignores zero and negative lengths', () => {
    const d = estimateDisplayDims({ css: { width: '0px', height: '-5px' } }, VP)
    expect(d.estimated).toBe(false)
  })
})
