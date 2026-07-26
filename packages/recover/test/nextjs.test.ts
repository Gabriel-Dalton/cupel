import { describe, expect, it } from 'vitest'
import { nextjsRecoverer } from '../src/nextjs.js'
import { asset } from './helpers/assets.js'

describe('nextjsRecoverer.match', () => {
  const matching = [
    'https://shop.example.com/_next/image?url=%2Fimages%2Fhero-banner.jpg&w=1920&q=75',
    'https://site.example.com/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fphoto.jpg&w=828&q=60',
    // Deployed under a basePath.
    'https://site.example.com/app/_next/image?url=%2Fimg%2Fa.png&w=640&q=75',
    // Relative asset URL, still the optimizer route.
    '/_next/image?url=%2Fimg%2Fa.png&w=640&q=75',
  ]
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(nextjsRecoverer.match(asset(url))).toBe(true)
    })
  }

  const nonMatching = [
    // Optimizer route but no url param to unwrap.
    'https://site.example.com/_next/image?w=640&q=75',
    // A url param on some other proxy route is not the Next.js optimizer.
    'https://site.example.com/proxy?url=%2Fimg%2Fa.png',
    // Not the /_next/image segment.
    'https://site.example.com/x_next/image?url=%2Fimg%2Fa.png',
    // A plain image.
    'https://site.example.com/images/hero.jpg',
  ]
  for (const url of nonMatching) {
    it(`rejects ${url}`, () => {
      expect(nextjsRecoverer.match(asset(url))).toBe(false)
    })
  }
})

describe('nextjsRecoverer.propose', () => {
  it('unwraps a site-relative url param against the page origin', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset('https://shop.example.com/_next/image?url=%2Fimages%2Fhero-banner.jpg&w=1920&q=75'),
    )
    expect(candidates.map((c) => c.url)).toEqual([
      'https://shop.example.com/images/hero-banner.jpg',
    ])
    expect(candidates[0]?.via).toBe('nextjs')
  })

  it('unwraps an absolute remote url param as-is', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset(
        'https://site.example.com/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fphoto.jpg&w=828&q=60',
      ),
    )
    expect(candidates.map((c) => c.url)).toEqual(['https://cdn.example.com/photo.jpg'])
  })

  it('keeps the decoded path bare when the asset URL has no origin', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset('/_next/image?url=%2Fimg%2Fa.png&w=640&q=75'),
    )
    expect(candidates.map((c) => c.url)).toEqual(['/img/a.png'])
  })

  it('mentions the served width in the rationale', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset('https://shop.example.com/_next/image?url=%2Fimages%2Fhero.jpg&w=1920&q=75'),
    )
    expect(candidates[0]?.rationale).toContain('w=1920')
  })

  it('returns no candidates when the url param is malformed percent-encoding', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset('https://site.example.com/_next/image?url=%E0%A4%A&w=640&q=75'),
    )
    expect(candidates).toEqual([])
  })

  it('returns no candidates for a non-matching asset', async () => {
    const candidates = await nextjsRecoverer.propose(
      asset('https://site.example.com/images/hero.jpg'),
    )
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    const url = 'https://shop.example.com/_next/image?url=%2Fimages%2Fhero.jpg&w=1920&q=75'
    const candidates = await nextjsRecoverer.propose(asset(url))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.map((c) => c.url)).not.toContain(url)
  })
})
