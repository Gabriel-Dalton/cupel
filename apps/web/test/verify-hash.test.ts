import { describe, expect, it } from 'vitest'
import type { RawImage } from '@cupel/core'
import { hashRawImage, sha256Hex, toHex } from '../lib/verify/hash'

// Known SHA-256 digests, from FIPS 180-2 test vectors. The ledger's
// sourceHash and outputHash are 'sha256:<lowercase hex>' over the raw file
// bytes, so the hasher must agree with every other SHA-256 on earth.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('sha256Hex', () => {
  it('hashes the empty input to the well-known digest, with the ledger prefix', async () => {
    await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(`sha256:${EMPTY_SHA256}`)
  })

  it('hashes "abc" to the FIPS test vector digest', async () => {
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(`sha256:${ABC_SHA256}`)
  })

  it('hashes a subarray view by its visible bytes only', async () => {
    const wide = new TextEncoder().encode('xxabcxx')
    const view = wide.subarray(2, 5)
    await expect(sha256Hex(view)).resolves.toBe(`sha256:${ABC_SHA256}`)
  })
})

describe('toHex', () => {
  it('zero-pads every byte to two lowercase digits', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff')
  })
})

describe('hashRawImage', () => {
  const img = (fill: number): RawImage => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16).fill(fill),
  })

  it('is the sha256 of the raw RGBA bytes', async () => {
    const image = img(7)
    await expect(hashRawImage(image)).resolves.toBe(await sha256Hex(new Uint8Array(image.data)))
  })

  it('is deterministic and sensitive to a single pixel change', async () => {
    const a = await hashRawImage(img(7))
    const b = await hashRawImage(img(7))
    expect(a).toBe(b)
    const tampered = img(7)
    tampered.data[5] = 8
    expect(await hashRawImage(tampered)).not.toBe(a)
  })
})
