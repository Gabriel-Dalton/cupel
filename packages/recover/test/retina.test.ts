import { describe, expect, it } from 'vitest'
import { retinaRecoverer } from '../src/retina.js'
import { asset } from './helpers/assets.js'

const IMG = 'https://site.example.com/img'

describe('retinaRecoverer.match', () => {
  const matching = [`${IMG}/logo.png`, `${IMG}/banner.webp`, `${IMG}/sprite.png?v=3`]
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(retinaRecoverer.match(asset(url))).toBe(true)
    })
  }

  const nonMatching = [
    // Already carries a density marker.
    `${IMG}/photo@2x.jpg`,
    `${IMG}/photo@3x.jpg`,
    // Vector, no raster retina sibling to look for.
    `${IMG}/icon.svg`,
    // Not an image.
    `${IMG}/report.pdf`,
    // No filename extension.
    'https://site.example.com/image',
  ]
  for (const url of nonMatching) {
    it(`rejects ${url}`, () => {
      expect(retinaRecoverer.match(asset(url))).toBe(false)
    })
  }
})

describe('retinaRecoverer.propose', () => {
  it('proposes @2x then @3x siblings', async () => {
    const candidates = await retinaRecoverer.propose(asset(`${IMG}/logo.png`))
    expect(candidates.map((c) => c.url)).toEqual([`${IMG}/logo@2x.png`, `${IMG}/logo@3x.png`])
    for (const c of candidates) {
      expect(c.via).toBe('retina')
      expect(c.rationale.length).toBeGreaterThan(0)
    }
  })

  it('works for webp', async () => {
    const candidates = await retinaRecoverer.propose(asset(`${IMG}/banner.webp`))
    expect(candidates.map((c) => c.url)).toEqual([
      `${IMG}/banner@2x.webp`,
      `${IMG}/banner@3x.webp`,
    ])
  })

  it('preserves the query string', async () => {
    const candidates = await retinaRecoverer.propose(asset(`${IMG}/sprite.png?v=3`))
    expect(candidates.map((c) => c.url)).toEqual([
      `${IMG}/sprite@2x.png?v=3`,
      `${IMG}/sprite@3x.png?v=3`,
    ])
  })

  it('returns no candidates for an asset that already has a marker', async () => {
    const candidates = await retinaRecoverer.propose(asset(`${IMG}/photo@2x.jpg`))
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    const url = `${IMG}/logo.png`
    const candidates = await retinaRecoverer.propose(asset(url))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.map((c) => c.url)).not.toContain(url)
  })
})
