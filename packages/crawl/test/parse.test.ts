import { describe, expect, it } from 'vitest'
import { parseHtml } from '../src/parse.js'

const PAGE = 'https://example.com/blog/post.html'

describe('parseHtml: <img> discovery', () => {
  it('discovers an img with src, declared dimensions, and loading attribute', () => {
    const html = '<img src="/hero.jpg" width="1200" height="800" loading="eager">'
    const [found] = parseHtml(html, PAGE)
    expect(found?.asset.url).toBe('https://example.com/hero.jpg')
    expect(found?.asset.declaredWidth).toBe(1200)
    expect(found?.asset.declaredHeight).toBe(800)
    expect(found?.asset.referrerPage).toBe(PAGE)
    expect(found?.kind).toBe('img')
    expect(found?.lazy).toBe(false)
  })

  it('marks loading="lazy" images', () => {
    const [found] = parseHtml('<img src="a.jpg" loading="lazy">', PAGE)
    expect(found?.lazy).toBe(true)
  })

  it('resolves relative, root relative, and protocol relative URLs', () => {
    const html = '<img src="a.jpg"><img src="/b.jpg"><img src="//cdn.example.net/c.jpg">'
    const urls = parseHtml(html, PAGE).map((f) => f.asset.url)
    expect(urls).toEqual([
      'https://example.com/blog/a.jpg',
      'https://example.com/b.jpg',
      'https://cdn.example.net/c.jpg',
    ])
  })

  it('skips data: URI images', () => {
    expect(parseHtml('<img src="data:image/gif;base64,R0lGOD">', PAGE)).toEqual([])
  })

  it('skips img elements with no usable source', () => {
    expect(parseHtml('<img alt="decorative">', PAGE)).toEqual([])
  })

  it('parses srcset into candidates, largest first, and keeps src as the asset url', () => {
    const html = '<img src="fallback.jpg" srcset="a.jpg 640w, b.jpg 1280w">'
    const [found] = parseHtml(html, PAGE)
    expect(found?.asset.url).toBe('https://example.com/blog/fallback.jpg')
    expect(found?.asset.srcset).toEqual([
      { url: 'https://example.com/blog/b.jpg', descriptor: '1280w' },
      { url: 'https://example.com/blog/a.jpg', descriptor: '640w' },
    ])
  })

  it('uses the largest srcset candidate as the url when src is missing', () => {
    const [found] = parseHtml('<img srcset="a.jpg 640w, b.jpg 1280w">', PAGE)
    expect(found?.asset.url).toBe('https://example.com/blog/b.jpg')
  })

  it('ignores width/height attributes that are not positive integers', () => {
    const [found] = parseHtml('<img src="a.jpg" width="banana" height="0">', PAGE)
    expect(found?.asset.declaredWidth).toBeUndefined()
    expect(found?.asset.declaredHeight).toBeUndefined()
  })
})

describe('parseHtml: <picture>', () => {
  it('merges source srcsets into the img asset, largest first', () => {
    const html = [
      '<picture>',
      '<source srcset="a.avif 2400w" type="image/avif">',
      '<source srcset="b.webp 1200w" type="image/webp">',
      '<img src="c.jpg" width="800" height="600">',
      '</picture>',
    ].join('')
    const found = parseHtml(html, PAGE)
    expect(found).toHaveLength(1)
    expect(found[0]?.asset.url).toBe('https://example.com/blog/c.jpg')
    expect(found[0]?.asset.srcset?.map((c) => c.descriptor)).toEqual(['2400w', '1200w'])
  })
})

describe('parseHtml: CSS backgrounds', () => {
  it('discovers an inline style background-image', () => {
    const html = '<div style="background-image: url(\'/bg.jpg\')"></div>'
    const [found] = parseHtml(html, PAGE)
    expect(found?.kind).toBe('background')
    expect(found?.asset.url).toBe('https://example.com/bg.jpg')
  })

  it('discovers background-image in a same-document style block via class selector', () => {
    const html =
      '<style>.hero { background-image: url("hero-bg.png"); }</style><div class="hero"></div>'
    const [found] = parseHtml(html, PAGE)
    expect(found?.kind).toBe('background')
    expect(found?.asset.url).toBe('https://example.com/blog/hero-bg.png')
  })

  it('matches id and tag selectors', () => {
    const html =
      '<style>#banner { background-image: url(banner.jpg); } header { background-image: url(head.jpg); }</style>' +
      '<header></header><div id="banner"></div>'
    const urls = parseHtml(html, PAGE).map((f) => f.asset.url)
    expect(urls).toContain('https://example.com/blog/banner.jpg')
    expect(urls).toContain('https://example.com/blog/head.jpg')
  })

  it('skips complex selectors: only simple tag, class, and id selectors match', () => {
    const html =
      '<style>.a > .b { background-image: url(x.jpg); } .c:hover { background-image: url(y.jpg); }</style>' +
      '<div class="a"><div class="b"></div></div><div class="c"></div>'
    expect(parseHtml(html, PAGE)).toEqual([])
  })

  it('ignores gradient-only backgrounds and data: URIs', () => {
    const html =
      '<div style="background-image: linear-gradient(#fff, #000)"></div>' +
      '<div style="background-image: url(data:image/png;base64,AAAA)"></div>'
    expect(parseHtml(html, PAGE)).toEqual([])
  })

  it('prefers the inline background over a matched rule for the same element', () => {
    const html =
      '<style>.hero { background-image: url(rule.jpg); }</style>' +
      '<div class="hero" style="background-image: url(inline.jpg)"></div>'
    const found = parseHtml(html, PAGE)
    expect(found).toHaveLength(1)
    expect(found[0]?.asset.url).toBe('https://example.com/blog/inline.jpg')
  })

  it('ignores at-rules entirely, including rules nested inside @media', () => {
    // Viewport-conditional rules cannot be evaluated statically, so a rule
    // inside @media must not produce an asset or influence sizing.
    const html =
      '<style>@import url(other.css); @media (max-width: 600px) { .m { background-image: url(mobile.jpg); } }</style>' +
      '<div class="m"></div>'
    expect(parseHtml(html, PAGE)).toEqual([])
  })
})

describe('parseHtml: sizing inputs', () => {
  it('collects attribute dimensions and inline style declarations', () => {
    const html = '<img src="a.jpg" width="800" height="600" style="width: 50%; height: 300px">'
    const [found] = parseHtml(html, PAGE)
    expect(found?.sizing.attrWidth).toBe(800)
    expect(found?.sizing.attrHeight).toBe(600)
    expect(found?.sizing.css['width']).toBe('50%')
    expect(found?.sizing.css['height']).toBe('300px')
  })

  it('merges matched style block rules with inline style winning', () => {
    const html =
      '<style>.pic { width: 100px; height: 50px; }</style>' +
      '<img class="pic" src="a.jpg" style="width: 200px">'
    const [found] = parseHtml(html, PAGE)
    expect(found?.sizing.css['width']).toBe('200px')
    expect(found?.sizing.css['height']).toBe('50px')
  })

  it('collects width and height from a background rule', () => {
    const html =
      '<style>.banner { background-image: url(b.jpg); width: 600px; height: 200px; }</style>' +
      '<div class="banner"></div>'
    const [found] = parseHtml(html, PAGE)
    expect(found?.sizing.css['width']).toBe('600px')
    expect(found?.sizing.css['height']).toBe('200px')
  })
})

describe('parseHtml: robustness', () => {
  it('does not throw on malformed HTML and still finds images', () => {
    const html = '<div><img src="a.jpg"><p>text</div></span><img src="b.jpg">'
    expect(() => parseHtml(html, PAGE)).not.toThrow()
    expect(parseHtml(html, PAGE)).toHaveLength(2)
  })

  it('returns empty for empty and non-HTML input', () => {
    expect(parseHtml('', PAGE)).toEqual([])
    expect(parseHtml('just some text', PAGE)).toEqual([])
  })

  it('assigns increasing document order indexes across asset kinds', () => {
    const html =
      '<img src="a.jpg"><div style="background-image:url(b.jpg)"></div><img src="c.jpg">'
    const found = parseHtml(html, PAGE)
    expect(found.map((f) => f.documentIndex)).toEqual([0, 1, 2])
    expect(found.map((f) => f.kind)).toEqual(['img', 'background', 'img'])
  })
})
