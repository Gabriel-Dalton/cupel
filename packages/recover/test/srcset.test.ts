import { describe, expect, it } from 'vitest'
import { srcsetRecoverer } from '../src/srcset.js'
import { asset } from './helpers/assets.js'

const IMG = 'https://site.example.com/img'

describe('srcsetRecoverer.match', () => {
  it('matches when the srcset holds a URL other than the one in use', () => {
    const a = asset(`${IMG}/photo-800.jpg`, {
      srcset: [
        { url: `${IMG}/photo-1600.jpg`, descriptor: '1600w' },
        { url: `${IMG}/photo-800.jpg`, descriptor: '800w' },
      ],
    })
    expect(srcsetRecoverer.match(a)).toBe(true)
  })

  it('rejects an asset without a srcset', () => {
    expect(srcsetRecoverer.match(asset(`${IMG}/photo.jpg`))).toBe(false)
  })

  it('rejects an asset with an empty srcset', () => {
    expect(srcsetRecoverer.match(asset(`${IMG}/photo.jpg`, { srcset: [] }))).toBe(false)
  })

  it('rejects a srcset that only lists the URL already in use', () => {
    const a = asset(`${IMG}/photo.jpg`, {
      srcset: [{ url: `${IMG}/photo.jpg`, descriptor: '800w' }],
    })
    expect(srcsetRecoverer.match(a)).toBe(false)
  })
})

describe('srcsetRecoverer.propose', () => {
  it('proposes only entries larger than the current one, largest first', async () => {
    const a = asset(`${IMG}/photo-800.jpg`, {
      srcset: [
        { url: `${IMG}/photo-400.jpg`, descriptor: '400w' },
        { url: `${IMG}/photo-1600.jpg`, descriptor: '1600w' },
        { url: `${IMG}/photo-800.jpg`, descriptor: '800w' },
        { url: `${IMG}/photo-1200.jpg`, descriptor: '1200w' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.map((c) => c.url)).toEqual([
      `${IMG}/photo-1600.jpg`,
      `${IMG}/photo-1200.jpg`,
    ])
    expect(candidates[0]?.via).toBe('srcset')
    expect(candidates[0]?.rationale).toContain('1600w')
  })

  it('handles density descriptors', async () => {
    const a = asset(`${IMG}/logo.png`, {
      srcset: [
        { url: `${IMG}/logo@2x.png`, descriptor: '2x' },
        { url: `${IMG}/logo.png`, descriptor: '1x' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.map((c) => c.url)).toEqual([`${IMG}/logo@2x.png`])
  })

  it('treats a missing descriptor as 1x', async () => {
    const a = asset(`${IMG}/logo.png`, {
      srcset: [
        { url: `${IMG}/logo.png`, descriptor: '' },
        { url: `${IMG}/logo@2x.png`, descriptor: '2x' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.map((c) => c.url)).toEqual([`${IMG}/logo@2x.png`])
  })

  it('skips entries whose unit cannot be compared to the current one', async () => {
    const a = asset(`${IMG}/photo-800.jpg`, {
      srcset: [
        { url: `${IMG}/photo-1600.jpg`, descriptor: '1600w' },
        { url: `${IMG}/photo-hd.jpg`, descriptor: '2x' },
        { url: `${IMG}/photo-800.jpg`, descriptor: '800w' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.map((c) => c.url)).toEqual([`${IMG}/photo-1600.jpg`])
  })

  it('proposes every other entry, largest first, when the current URL is not listed', async () => {
    const a = asset(`${IMG}/thumb.jpg`, {
      srcset: [
        { url: `${IMG}/wide-800.jpg`, descriptor: '800w' },
        { url: `${IMG}/wide-1600.jpg`, descriptor: '1600w' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.map((c) => c.url)).toEqual([`${IMG}/wide-1600.jpg`, `${IMG}/wide-800.jpg`])
  })

  it('proposes nothing when the current entry is already the largest', async () => {
    const a = asset(`${IMG}/photo-1600.jpg`, {
      srcset: [
        { url: `${IMG}/photo-1600.jpg`, descriptor: '1600w' },
        { url: `${IMG}/photo-800.jpg`, descriptor: '800w' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    const a = asset(`${IMG}/photo-800.jpg`, {
      srcset: [
        { url: `${IMG}/photo-800.jpg`, descriptor: '800w' },
        { url: `${IMG}/photo-1600.jpg`, descriptor: '1600w' },
      ],
    })
    const candidates = await srcsetRecoverer.propose(a)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.map((c) => c.url)).not.toContain(a.url)
  })
})
