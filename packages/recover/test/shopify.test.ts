import { describe, expect, it } from 'vitest'
import { shopifyRecoverer } from '../src/shopify.js'
import { asset } from './helpers/assets.js'

const PRODUCTS = 'https://cdn.shopify.com/s/files/1/0123/4567/products'

describe('shopifyRecoverer.match', () => {
  const matching = [
    `${PRODUCTS}/tee_800x800.jpg?v=1650000000`,
    `${PRODUCTS}/tee_800x.jpg`,
    `${PRODUCTS}/tee_x600.jpg`,
    `${PRODUCTS}/tee_800x600_crop_center.jpg`,
    `${PRODUCTS}/hoodie_large.jpg`,
    `${PRODUCTS}/hoodie_grande.jpg`,
    `${PRODUCTS}/hoodie_small.webp`,
    `${PRODUCTS}/hoodie_medium.png`,
    `${PRODUCTS}/mug_100x100@2x.jpg`,
    // Modern storefronts serve from the shop domain under /cdn/shop/.
    'https://store.example.com/cdn/shop/products/candle_600x.png?v=99',
  ]
  for (const url of matching) {
    it(`matches ${url}`, () => {
      expect(shopifyRecoverer.match(asset(url))).toBe(true)
    })
  }

  const nonMatching = [
    // Nothing to strip.
    `${PRODUCTS}/tee.jpg?v=1650000000`,
    // Underscores in a product filename are not size tokens.
    `${PRODUCTS}/blue_shirt.jpg`,
    // Size-shaped token but not a Shopify CDN URL.
    'https://example.com/img/tee_800x.jpg',
    // Not a raster image extension.
    `${PRODUCTS}/logo_800x.svg`,
  ]
  for (const url of nonMatching) {
    it(`rejects ${url}`, () => {
      expect(shopifyRecoverer.match(asset(url))).toBe(false)
    })
  }
})

describe('shopifyRecoverer.propose', () => {
  const table: { input: string; expected: string }[] = [
    {
      input: `${PRODUCTS}/tee_800x800.jpg?v=1650000000`,
      expected: `${PRODUCTS}/tee.jpg?v=1650000000`,
    },
    { input: `${PRODUCTS}/tee_800x.jpg`, expected: `${PRODUCTS}/tee.jpg` },
    { input: `${PRODUCTS}/tee_x600.jpg`, expected: `${PRODUCTS}/tee.jpg` },
    { input: `${PRODUCTS}/tee_800x600_crop_center.jpg`, expected: `${PRODUCTS}/tee.jpg` },
    { input: `${PRODUCTS}/hoodie_grande.jpg`, expected: `${PRODUCTS}/hoodie.jpg` },
    { input: `${PRODUCTS}/mug_100x100@2x.jpg`, expected: `${PRODUCTS}/mug.jpg` },
    {
      input: 'https://store.example.com/cdn/shop/products/candle_600x.png?v=99',
      expected: 'https://store.example.com/cdn/shop/products/candle.png?v=99',
    },
  ]
  for (const { input, expected } of table) {
    it(`proposes ${expected} for ${input}`, async () => {
      const candidates = await shopifyRecoverer.propose(asset(input))
      expect(candidates.map((c) => c.url)).toEqual([expected])
      expect(candidates[0]?.via).toBe('shopify')
    })
  }

  it('mentions the stripped token in the rationale', async () => {
    const candidates = await shopifyRecoverer.propose(asset(`${PRODUCTS}/tee_800x800.jpg?v=1`))
    expect(candidates[0]?.rationale).toContain('_800x800')
  })

  it('returns no candidates for a non-matching asset', async () => {
    const candidates = await shopifyRecoverer.propose(asset(`${PRODUCTS}/blue_shirt.jpg`))
    expect(candidates).toEqual([])
  })

  it('never proposes the input URL itself', async () => {
    for (const { input } of table) {
      const candidates = await shopifyRecoverer.propose(asset(input))
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.map((c) => c.url)).not.toContain(input)
    }
  })
})
