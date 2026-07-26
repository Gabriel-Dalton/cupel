import { describe, expect, it } from 'vitest'
import { cdnRecoverer } from '../src/cdn.js'
import { asset } from './helpers/assets.js'

describe('cdnRecoverer.match', () => {
  const matching = [
    'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1610000000/samples/food.jpg',
    'https://res.cloudinary.com/demo/image/upload/w_800/q_auto,f_auto/v1/hero.jpg',
    'https://res.cloudinary.com/acme/image/upload/c_scale,w_500/products/shoe.png',
    'https://images.acme.imgix.net/photos/beach.jpg?w=768&h=512&fit=crop&auto=format',
    'https://cdn.acme.com/a.jpg?w=400&v=abc123',
    'https://cdn.acme.com/b.png?q=80&fm=webp&dpr=2',
  ]
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(cdnRecoverer.match(asset(url))).toBe(true)
    })
  }

  const nonMatching = [
    // Cloudinary URL with no transformation segment.
    'https://res.cloudinary.com/demo/image/upload/v1/hero.jpg',
    // A folder with an underscore is not a transformation segment.
    'https://res.cloudinary.com/acme/image/upload/my_photos/pic.jpg',
    // Version param alone is not a transform.
    'https://cdn.acme.com/a.jpg?v=abc',
    // The Next.js optimizer route belongs to the nextjs recoverer.
    'https://acme.com/_next/image?url=%2Fa.jpg&w=640&q=75',
    // Transform-shaped query on a non-image path.
    'https://api.acme.com/render?w=500',
    // Nothing to strip at all.
    'https://cdn.acme.com/a.jpg',
  ]
  for (const url of nonMatching) {
    it(`rejects ${url}`, () => {
      expect(cdnRecoverer.match(asset(url))).toBe(false)
    })
  }
})

describe('cdnRecoverer.propose', () => {
  it('removes a Cloudinary transformation segment', async () => {
    const candidates = await cdnRecoverer.propose(
      asset(
        'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1610000000/samples/food.jpg',
      ),
    )
    expect(candidates[0]?.url).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1610000000/samples/food.jpg',
    )
    expect(candidates[0]?.via).toBe('cdn')
  })

  it('removes chained Cloudinary transformation segments', async () => {
    const candidates = await cdnRecoverer.propose(
      asset('https://res.cloudinary.com/demo/image/upload/w_800/q_auto,f_auto/v1/hero.jpg'),
    )
    expect(candidates[0]?.url).toBe('https://res.cloudinary.com/demo/image/upload/v1/hero.jpg')
  })

  it('handles a Cloudinary URL without a version segment', async () => {
    const candidates = await cdnRecoverer.propose(
      asset('https://res.cloudinary.com/acme/image/upload/c_scale,w_500/products/shoe.png'),
    )
    expect(candidates[0]?.url).toBe(
      'https://res.cloudinary.com/acme/image/upload/products/shoe.png',
    )
  })

  it('strips imgix-style transform query params', async () => {
    const candidates = await cdnRecoverer.propose(
      asset('https://images.acme.imgix.net/photos/beach.jpg?w=768&h=512&fit=crop&auto=format'),
    )
    expect(candidates.map((c) => c.url)).toEqual(['https://images.acme.imgix.net/photos/beach.jpg'])
  })

  it('keeps non-transform query params such as a version', async () => {
    const candidates = await cdnRecoverer.propose(asset('https://cdn.acme.com/a.jpg?w=400&v=abc123'))
    expect(candidates.map((c) => c.url)).toEqual(['https://cdn.acme.com/a.jpg?v=abc123'])
  })

  it('drops the query entirely when every param is a transform', async () => {
    const candidates = await cdnRecoverer.propose(asset('https://cdn.acme.com/b.png?q=80&fm=webp&dpr=2'))
    expect(candidates.map((c) => c.url)).toEqual(['https://cdn.acme.com/b.png'])
  })

  it('proposes the fully cleaned URL first when both path and query strip', async () => {
    const candidates = await cdnRecoverer.propose(
      asset('https://res.cloudinary.com/demo/image/upload/w_100/v1/a.jpg?q=50'),
    )
    const urls = candidates.map((c) => c.url)
    expect(urls[0]).toBe('https://res.cloudinary.com/demo/image/upload/v1/a.jpg')
    expect(urls).toContain('https://res.cloudinary.com/demo/image/upload/v1/a.jpg?q=50')
    expect(urls).toContain('https://res.cloudinary.com/demo/image/upload/w_100/v1/a.jpg')
  })

  it('mentions the removed transforms in the rationale', async () => {
    const candidates = await cdnRecoverer.propose(
      asset('https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1/food.jpg'),
    )
    expect(candidates[0]?.rationale).toContain('w_400,h_300,c_fill')
  })

  it('returns no candidates for a non-matching asset', async () => {
    const candidates = await cdnRecoverer.propose(asset('https://cdn.acme.com/a.jpg?v=abc'))
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    const inputs = [
      'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1/food.jpg',
      'https://images.acme.imgix.net/photos/beach.jpg?w=768&h=512',
      'https://res.cloudinary.com/demo/image/upload/w_100/v1/a.jpg?q=50',
    ]
    for (const url of inputs) {
      const candidates = await cdnRecoverer.propose(asset(url))
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.map((c) => c.url)).not.toContain(url)
    }
  })
})
