import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UnreadableInput, examine } from '../src/lib/analyze.js'
import { hasImageExtension, sniffContainer } from '../src/lib/sniff.js'
import { renderReport, reportJson } from '../src/inspect/report.js'
import { encodeJpeg, encodePng, flatGraphic, photoLike, tempDir } from './fixtures.js'

describe('container sniffing', () => {
  it('identifies containers from magic bytes, not the extension', async () => {
    expect(sniffContainer(await encodeJpeg(photoLike(64), 80))).toBe('jpeg')
    expect(sniffContainer(await encodePng(flatGraphic(64)))).toBe('png')
    expect(sniffContainer(new TextEncoder().encode('<?xml version="1.0"?><svg></svg>'))).toBe('svg')
    expect(sniffContainer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(null)
  })

  it('does not mistake a heic ftyp box for avif', () => {
    const heic = new Uint8Array(16)
    heic.set(new TextEncoder().encode('ftyp'), 4)
    heic.set(new TextEncoder().encode('heic'), 8)
    expect(sniffContainer(heic)).toBe(null)
  })

  it('recognizes image extensions case insensitively', () => {
    expect(hasImageExtension('a.JPG')).toBe(true)
    expect(hasImageExtension('a.webp')).toBe(true)
    expect(hasImageExtension('a.txt')).toBe(false)
    expect(hasImageExtension('noextension')).toBe(false)
  })
})

describe('examine', () => {
  let dir: Awaited<ReturnType<typeof tempDir>>

  beforeAll(async () => {
    dir = await tempDir('cupel-inspect-')
  })
  afterAll(async () => {
    await dir.cleanup()
  })

  it('produces provenance for a decodable file', async () => {
    const path = join(dir.path, 'photo.jpg')
    await writeFile(path, await encodeJpeg(photoLike(128), 90))
    const examined = await examine(path)

    expect(examined.container).toBe('jpeg')
    expect(examined.provenance).not.toBeNull()
    expect(examined.provenance?.declaredResolution).toEqual({ w: 128, h: 128 })
    // A q90 encode should be recovered from the quantization tables to
    // within the documented 2 point accuracy.
    expect(examined.provenance?.estimatedOriginalQuality).toBeGreaterThanOrEqual(88)
    expect(examined.provenance?.evidence.length).toBeGreaterThan(0)
  })

  it('reports an svg without rasterizing it', async () => {
    const path = join(dir.path, 'logo.svg')
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    const examined = await examine(path)

    expect(examined.container).toBe('svg')
    expect(examined.image).toBeNull()
    expect(examined.provenance).toBeNull()
    expect(examined.note).toContain('never rasterizes')
  })

  it('refuses unreadable and unrecognized input', async () => {
    await expect(examine(join(dir.path, 'missing.jpg'))).rejects.toBeInstanceOf(UnreadableInput)

    const junk = join(dir.path, 'junk.png')
    await writeFile(junk, 'this is not an image')
    await expect(examine(junk)).rejects.toThrow(/not a recognized image container/)
  })
})

describe('inspect report', () => {
  it('renders the evidence and the json shape', async () => {
    const dir = await tempDir('cupel-report-')
    try {
      const path = join(dir.path, 'photo.jpg')
      await writeFile(path, await encodeJpeg(photoLike(96), 75))
      const examined = await examine(path)

      const text = renderReport(examined)
      expect(text).toContain('declared resolution')
      expect(text).toContain('headroom')
      expect(text).toContain('Evidence')

      const parsed = JSON.parse(reportJson(examined)) as Record<string, unknown>
      expect(parsed['container']).toBe('jpeg')
      expect(parsed['fileBytes']).toBeGreaterThan(0)
      expect(parsed['provenance']).not.toBeNull()
    } finally {
      await dir.cleanup()
    }
  })
})
