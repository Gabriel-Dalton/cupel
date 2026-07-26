import type { Container } from '@cupel/core'

/**
 * Container detection from the leading bytes. The extension is never
 * trusted: a .png that is really a JPEG is exactly the kind of laundering
 * cupel exists to notice, so the magic bytes decide and the caller can
 * compare against the name if it wants to complain.
 */

/** Formats the node codecs can decode. svg and gif are sniffed but not decoded. */
export type DecodableContainer = 'jpeg' | 'png' | 'webp' | 'avif'

const DECODABLE: ReadonlySet<Container> = new Set<Container>(['jpeg', 'png', 'webp', 'avif'])

export function isDecodable(container: Container): container is DecodableContainer {
  return DECODABLE.has(container)
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false
  }
  return true
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ?? 0)
  }
  return out
}

/**
 * Returns the container these bytes actually are, or null when nothing
 * recognized. ISO base media brands are read from the ftyp box so heic and
 * avif are not confused with each other: only av01 and avis are reported as
 * avif, and anything else in that family stays null rather than being
 * guessed at.
 */
export function sniffContainer(bytes: Uint8Array): Container | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    return null
  }
  // SVG is text, so look for a root element in the first chunk. A leading
  // XML declaration or comment is common, hence the scan rather than a
  // prefix test.
  const head = ascii(bytes, 0, Math.min(bytes.length, 1024)).toLowerCase()
  if (head.includes('<svg')) return 'svg'
  return null
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.svg',
])

/** True when the path looks like an image worth opening. */
export function hasImageExtension(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase())
}
