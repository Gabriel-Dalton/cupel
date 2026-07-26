import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_CAPS, auditDirectory, auditUrl } from '../src/audit/engine.js'
import { estimateRecoverable } from '../src/audit/recoverable.js'
import { auditJson, renderAudit } from '../src/audit/render.js'
import { encodeJpeg, encodePng, flatGraphic, photoLike, tempDir } from './fixtures.js'

describe('recoverable-bytes model', () => {
  const base = {
    container: 'jpeg' as const,
    fileBytes: 100_000,
    headroom: 'normal' as const,
    estimatedOriginalQuality: 80,
    blockingScore: null,
    declaredArea: null,
    displayArea: null,
  }

  it('claims nothing when cupel would refuse to re-encode', () => {
    const estimate = estimateRecoverable({ ...base, headroom: 'none' })
    expect(estimate.bytes).toBe(0)
    expect(estimate.fraction).toBe(0)
    expect(estimate.basis.join(' ')).toContain('refuse')
  })

  it('finds more slack in a high quality source than a modest one', () => {
    const high = estimateRecoverable({ ...base, estimatedOriginalQuality: 95 })
    const modest = estimateRecoverable({ ...base, estimatedOriginalQuality: 75 })
    expect(high.fraction).toBeGreaterThan(modest.fraction)
  })

  it('treats a photographic png as the worst case it knows', () => {
    const laundered = estimateRecoverable({ ...base, container: 'png', blockingScore: 0.9 })
    const graphic = estimateRecoverable({ ...base, container: 'png', blockingScore: 0.01 })
    expect(laundered.fraction).toBeGreaterThan(graphic.fraction)
    expect(laundered.basis.join(' ')).toContain('DCT seams')
  })

  it('composes oversize with format instead of summing past 100%', () => {
    const estimate = estimateRecoverable({
      ...base,
      estimatedOriginalQuality: 95,
      declaredArea: 4_000_000,
      displayArea: 250_000,
    })
    expect(estimate.fraction).toBeLessThanOrEqual(0.95)
    expect(estimate.fraction).toBeGreaterThan(0.9)
    expect(estimate.basis.join(' ')).toContain('oversize')
  })

  it('ignores oversize inside the high-DPI slop band', () => {
    const estimate = estimateRecoverable({
      ...base,
      declaredArea: 1_000_000,
      displayArea: 900_000,
    })
    expect(estimate.basis.join(' ')).not.toContain('oversize')
  })
})

describe('directory audit', () => {
  it('reports every file, refuses nothing silently, and never writes', async () => {
    const dir = await tempDir('cupel-audit-dir-')
    try {
      await writeFile(join(dir.path, 'photo.jpg'), await encodeJpeg(photoLike(96), 92))
      await writeFile(join(dir.path, 'graphic.png'), await encodePng(flatGraphic(96)))
      await writeFile(join(dir.path, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
      await writeFile(join(dir.path, 'notes.txt'), 'not an image')

      const report = await auditDirectory(dir.path)

      // The .txt is not an image and is not counted; the svg is.
      expect(report.assets.map((a) => a.ref).sort()).toEqual([
        'graphic.png',
        'logo.svg',
        'photo.jpg',
      ])
      expect(report.mode).toBe('directory')
      expect(report.pixelsDecoded).toBe(true)
      expect(report.totals.bytes).toBeGreaterThan(0)

      const text = renderAudit(report)
      expect(text).toContain('Rollup')
      expect(text).toContain('modelled not measured')
      expect(JSON.parse(auditJson(report))).toHaveProperty('totals')
    } finally {
      await dir.cleanup()
    }
  })
})

describe('url audit caps', () => {
  const PAGE = `<!doctype html><html><body>${Array.from(
    { length: 80 },
    (_, i) => `<img src="/img${i}.jpg" width="100" height="100">`,
  ).join('')}</body></html>`

  function pageFetcher(html: string): typeof fetch {
    return (async (url: string) => {
      // robots.txt: allow everything.
      if (url.endsWith('/robots.txt')) {
        return { ok: true, status: 200, url, text: async () => 'User-agent: *\nAllow: /' }
      }
      return { ok: true, status: 200, url, text: async () => html }
    }) as unknown as typeof fetch
  }

  it('stops at the asset cap and says so in the output', async () => {
    let assetRequests = 0
    const jpeg = await encodeJpeg(photoLike(64), 85)

    const report = await auditUrl('https://example.test/', {
      pageFetcher: pageFetcher(PAGE),
      assetFetcher: async (_url, _init) => {
        assetRequests++
        return new Response(jpeg, {
          status: 206,
          headers: { 'content-range': `bytes 0-${jpeg.length - 1}/${jpeg.length}` },
        })
      },
    })

    expect(assetRequests).toBe(AUDIT_CAPS.maxAssets)
    expect(report.assets).toHaveLength(AUDIT_CAPS.maxAssets)
    expect(report.truncations.join(' ')).toContain('asset cap')
    // Header-only evidence: quality recovered, generations honestly absent.
    expect(report.assets[0]?.estimatedOriginalQuality).toBeGreaterThanOrEqual(83)
    expect(report.assets[0]?.generations).toBeNull()
    expect(report.pixelsDecoded).toBe(false)
  })

  it('reports a failed asset fetch rather than dropping the asset silently', async () => {
    const report = await auditUrl('https://example.test/', {
      pageFetcher: pageFetcher('<img src="/broken.jpg" width="10" height="10">'),
      assetFetcher: async () => new Response('nope', { status: 500 }),
    })

    expect(report.assets).toHaveLength(0)
    expect(report.truncations.join(' ')).toContain('fetch failed')
  })

  it('honours a robots.txt disallow and inspects nothing', async () => {
    const report = await auditUrl('https://example.test/', {
      pageFetcher: (async (url: string) => ({
        ok: true,
        status: 200,
        url,
        text: async () => (url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /' : PAGE),
      })) as unknown as typeof fetch,
      assetFetcher: async () => {
        throw new Error('no asset fetch should happen when robots disallows the page')
      },
    })

    expect(report.assets).toHaveLength(0)
    expect(report.truncations.join(' ')).toMatch(/robots/i)
  })
})
