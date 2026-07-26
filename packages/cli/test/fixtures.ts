import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RawImage } from '@cupel/core'
import { sharpCodec } from '@cupel/codecs-node'

/**
 * Shared generated fixtures. No binary files are ever committed: every test
 * image is synthesized here from a seeded PRNG, so the corpus is
 * reproducible, reviewable in a diff, and identical on every machine.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Photograph-like content: smooth structure plus fine noise, which is what
 * makes a quality ladder produce a real curve instead of a flat line.
 */
export function photoLike(size: number, seed = 7): RawImage {
  const rand = mulberry32(seed)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const structure = 60 * Math.sin(x / 17) * Math.cos(y / 23) + 30 * Math.sin((x + y) / 9)
      const v = 128 + structure + (rand() - 0.5) * 60
      const o = (y * size + x) * 4
      data[o] = v + 10 * Math.sin(x / 31)
      data[o + 1] = v
      data[o + 2] = v - 10 * Math.cos(y / 41)
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** Flat banded graphic: the case where lossless formats legitimately win. */
export function flatGraphic(size: number): RawImage {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const stripe = Math.floor(y / 16) % 2 === 0
      data[o] = stripe ? 200 : 40
      data[o + 1] = 90
      data[o + 2] = stripe ? 30 : 220
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

export async function encodeJpeg(img: RawImage, quality: number): Promise<Uint8Array> {
  return sharpCodec('jpeg').encode(img, { quality })
}

export async function encodePng(img: RawImage): Promise<Uint8Array> {
  return sharpCodec('png').encode(img, {})
}

/** A temp directory plus its cleanup, for tests that touch the filesystem. */
export async function tempDir(
  prefix = 'cupel-test-',
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) }
}
