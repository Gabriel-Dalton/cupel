import { describe, expect, it } from 'vitest'
import { wordpressRecoverer } from '../src/wordpress.js'
import { asset } from './helpers/assets.js'

const UPLOADS = 'https://blog.example.com/wp-content/uploads/2024/03'

describe('wordpressRecoverer.match', () => {
  const matching = [
    `${UPLOADS}/photo-800x600.jpg`,
    `${UPLOADS}/hero-scaled.jpg`,
    `${UPLOADS}/pic-rotated.png`,
    `${UPLOADS}/team-scaled-1024x683.jpg`,
    `${UPLOADS}/banner-2560x1440.webp`,
    `${UPLOADS}/photo-150x150.jpg?ver=2`,
  ]
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(wordpressRecoverer.match(asset(url))).toBe(true)
    })
  }

  const nonMatching = [
    // No size or variant suffix: nothing to strip.
    `${UPLOADS}/photo.jpg`,
    // A year in the filename is not a WIDTHxHEIGHT token.
    `${UPLOADS}/screenshot-2024.png`,
    // Not an image extension.
    `${UPLOADS}/app-800x600.js`,
    // Stripping the suffix would leave an empty filename.
    `${UPLOADS}/-800x600.jpg`,
    // No filename extension at all.
    'https://blog.example.com/about',
  ]
  for (const url of nonMatching) {
    it(`rejects ${url}`, () => {
      expect(wordpressRecoverer.match(asset(url))).toBe(false)
    })
  }
})

describe('wordpressRecoverer.propose', () => {
  it('strips a -WxH thumbnail suffix, bare original first, -scaled second', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/photo-800x600.jpg`))
    expect(candidates.map((c) => c.url)).toEqual([
      `${UPLOADS}/photo.jpg`,
      `${UPLOADS}/photo-scaled.jpg`,
    ])
    for (const c of candidates) {
      expect(c.via).toBe('wordpress')
      expect(c.rationale.length).toBeGreaterThan(0)
    }
  })

  it('drops a bare -scaled suffix to reach the true original', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/hero-scaled.jpg`))
    expect(candidates.map((c) => c.url)).toEqual([`${UPLOADS}/hero.jpg`])
  })

  it('drops a bare -rotated suffix to reach the true original', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/pic-rotated.png`))
    expect(candidates.map((c) => c.url)).toEqual([`${UPLOADS}/pic.png`])
  })

  it('handles a stacked -scaled-WxH suffix, bare original first', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/team-scaled-1024x683.jpg`))
    expect(candidates.map((c) => c.url)).toEqual([
      `${UPLOADS}/team.jpg`,
      `${UPLOADS}/team-scaled.jpg`,
    ])
  })

  it('preserves the query string on every candidate', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/photo-150x150.jpg?ver=2`))
    expect(candidates.map((c) => c.url)).toEqual([
      `${UPLOADS}/photo.jpg?ver=2`,
      `${UPLOADS}/photo-scaled.jpg?ver=2`,
    ])
  })

  it('mentions the stripped token in the rationale', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/photo-800x600.jpg`))
    expect(candidates[0]?.rationale).toContain('800x600')
  })

  it('returns no candidates for a non-matching asset', async () => {
    const candidates = await wordpressRecoverer.propose(asset(`${UPLOADS}/photo.jpg`))
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    const inputs = [
      `${UPLOADS}/photo-800x600.jpg`,
      `${UPLOADS}/hero-scaled.jpg`,
      `${UPLOADS}/team-scaled-1024x683.jpg`,
    ]
    for (const url of inputs) {
      const candidates = await wordpressRecoverer.propose(asset(url))
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.map((c) => c.url)).not.toContain(url)
    }
  })
})
