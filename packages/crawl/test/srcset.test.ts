import { describe, expect, it } from 'vitest'
import { parseSrcset } from '../src/parse.js'

const BASE = 'https://example.com/dir/page.html'

describe('parseSrcset', () => {
  it('orders width descriptor candidates largest first', () => {
    const out = parseSrcset('small.jpg 640w, large.jpg 1280w, medium.jpg 960w', BASE)
    expect(out.map((c) => c.descriptor)).toEqual(['1280w', '960w', '640w'])
    expect(out[0]?.url).toBe('https://example.com/dir/large.jpg')
  })

  it('orders density descriptor candidates largest first', () => {
    const out = parseSrcset('a.jpg 1x, b.jpg 2x', BASE)
    expect(out.map((c) => c.descriptor)).toEqual(['2x', '1x'])
  })

  it('sorts fractional densities numerically', () => {
    const out = parseSrcset('a.jpg 1.5x, b.jpg 2x, c.jpg 0.5x', BASE)
    expect(out.map((c) => c.descriptor)).toEqual(['2x', '1.5x', '0.5x'])
  })

  it('defaults a missing descriptor to 1x', () => {
    const out = parseSrcset('a.jpg 2x, b.jpg', BASE)
    expect(out).toEqual([
      { url: 'https://example.com/dir/a.jpg', descriptor: '2x' },
      { url: 'https://example.com/dir/b.jpg', descriptor: '1x' },
    ])
  })

  it('orders width descriptors before density descriptors in mixed lists', () => {
    // A mixed list is invalid srcset, but tolerated: w candidates carry an
    // absolute size, so they are the stronger "largest first" evidence.
    const out = parseSrcset('a.jpg 2x, b.jpg 640w', BASE)
    expect(out.map((c) => c.descriptor)).toEqual(['640w', '2x'])
  })

  it('tolerates trailing commas, newlines, and extra whitespace', () => {
    const out = parseSrcset('  a.jpg   640w ,\n b.jpg 1280w , ', BASE)
    expect(out.map((c) => c.descriptor)).toEqual(['1280w', '640w'])
  })

  it('skips data: URI candidates, including the comma inside the data URI', () => {
    const out = parseSrcset('data:image/gif;base64,R0lGOD 1x, real.jpg 2x', BASE)
    expect(out).toEqual([{ url: 'https://example.com/dir/real.jpg', descriptor: '2x' }])
  })

  it('drops candidates with malformed descriptors', () => {
    const out = parseSrcset('good.jpg 640w, bad.jpg banana', BASE)
    expect(out).toEqual([{ url: 'https://example.com/dir/good.jpg', descriptor: '640w' }])
  })

  it('returns empty for empty or whitespace-only input', () => {
    expect(parseSrcset('', BASE)).toEqual([])
    expect(parseSrcset('   ', BASE)).toEqual([])
  })

  it('resolves candidate URLs against the page URL', () => {
    const out = parseSrcset('/img/a.jpg 800w, ../b.jpg 400w', BASE)
    expect(out[0]?.url).toBe('https://example.com/img/a.jpg')
    expect(out[1]?.url).toBe('https://example.com/b.jpg')
  })

  it('deduplicates identical url and descriptor pairs', () => {
    const out = parseSrcset('a.jpg 640w, a.jpg 640w', BASE)
    expect(out).toHaveLength(1)
  })
})
