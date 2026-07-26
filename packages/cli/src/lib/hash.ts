import { createHash } from 'node:crypto'
import type { RawImage } from '@cupel/core'

/**
 * Content addressing for the ledger. This MUST agree bit for bit with
 * apps/web/lib/verify/hash.ts, which the /verify page uses to check the
 * same receipts in a browser: 'sha256:<lowercase hex>', over raw file bytes
 * for sourceHash and outputHash, and over raw RGBA bytes (row major, no
 * dimension header) for reference.hash. Node's crypto is used here rather
 * than Web Crypto only because it is synchronous; the digests are identical.
 */

export function sha256Hex(bytes: Uint8Array): string {
  const hash = createHash('sha256')
  hash.update(bytes)
  return `sha256:${hash.digest('hex')}`
}

/** The ledger's reference.hash: sha256 over the derived image's RGBA bytes. */
export function hashRawImage(img: RawImage): string {
  return sha256Hex(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength))
}
