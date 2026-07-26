import type { RawImage } from '@cupel/core'

/**
 * Content addressing for verification, via Web Crypto. The ledger records
 * 'sha256:<lowercase hex>' over raw file bytes (BRIEF section 7), so this
 * module must agree bit for bit with whatever wrote the ledger. Web Crypto
 * is available in every browser this page targets and in Node 20+, so the
 * same code runs under vitest and in the page.
 */

export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return hex
}

/** SHA-256 of the given bytes, in the ledger's 'sha256:<hex>' form. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh, tightly sized buffer first: subarray views must hash
  // by their visible bytes only, and a fresh Uint8Array is always backed by
  // a plain ArrayBuffer, which is what BufferSource requires.
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return `sha256:${toHex(new Uint8Array(digest))}`
}

/**
 * Content address for derived pixels (the ledger's reference.hash): SHA-256
 * over the raw RGBA bytes, row major, no dimension header. Dimensions are
 * recorded alongside the hash in the entry, so hashing them again would be
 * redundant.
 */
export async function hashRawImage(img: RawImage): Promise<string> {
  return sha256Hex(new Uint8Array(img.data))
}
