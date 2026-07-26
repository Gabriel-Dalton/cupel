import type { RawImage } from '@cupel/core'

/**
 * Ingest: everything between "the visitor dropped bytes" and "we hold a
 * measurement reference". Container sniffing from signature bytes, alpha
 * flattening, and the area-average downscale that caps the reference.
 *
 * Platform pure on purpose: operates on Uint8Array and RawImage only, so it
 * runs identically in the worker and in the Node test suite.
 */

/**
 * The reference cap: images whose long edge exceeds this are downscaled
 * before the sweep. 1024 keeps a full sweep tolerable in single threaded
 * wasm and matches the scale the core sharpness metric normalizes to. The
 * page discloses the cap whenever it is applied.
 */
export const MAX_REFERENCE_EDGE = 1024

/**
 * Refusal threshold for input files. Decoding a larger file would lock the
 * tab rather than measure anything, so the page refuses it outright and
 * says so.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

/** The containers the wasm codecs can decode. */
export type SniffedContainer = 'jpeg' | 'png' | 'webp' | 'avif'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/**
 * Identifies the container from signature bytes alone. File extensions and
 * MIME types are claims; the bytes are evidence. Returns null for anything the
 * wasm codecs cannot decode, and the caller turns that into a refusal.
 *
 * avif is an ISO-BMFF ftyp box: the major brand or any compatible brand
 * must be avif or avis (the animated variant).
 */
export function sniffContainer(bytes: Uint8Array): SniffedContainer | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'png'
  }
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
    return 'webp'
  }
  if (bytes.length >= 12 && asciiAt(bytes, 4, 'ftyp')) {
    const boxSize =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
    const end = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length)
    // Major brand at 8, compatible brands from 16, four bytes each.
    if (asciiAt(bytes, 8, 'avif') || asciiAt(bytes, 8, 'avis')) return 'avif'
    for (let off = 16; off + 4 <= end; off += 4) {
      if (asciiAt(bytes, off, 'avif') || asciiAt(bytes, off, 'avis')) return 'avif'
    }
  }
  return null
}

/** True when any pixel is not fully opaque. */
export function hasTransparency(img: RawImage): boolean {
  const { data } = img
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 255) !== 255) return true
  }
  return false
}

/**
 * Source-over composite onto white, the same convention the codec adapters
 * use before a jpeg encode (mozjpeg has no alpha channel). Applying it once
 * to the reference keeps every candidate measured against the same pixels
 * instead of quietly penalizing the formats that drop alpha.
 */
export function flattenOntoWhite(img: RawImage): RawImage {
  const src = img.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a = (src[i + 3] ?? 255) / 255
    const inverse = (1 - a) * 255
    out[i] = (src[i] ?? 0) * a + inverse
    out[i + 1] = (src[i + 1] ?? 0) * a + inverse
    out[i + 2] = (src[i + 2] ?? 0) * a + inverse
    out[i + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

/**
 * The dimensions an image takes after capping its long edge, aspect ratio
 * preserved, short edge rounded but never below one pixel. Images already
 * inside the cap keep their dimensions exactly.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) return { width, height }
  const scale = maxEdge / long
  const scaled = (edge: number) => (edge === long ? maxEdge : Math.max(1, Math.round(edge * scale)))
  return { width: scaled(width), height: scaled(height) }
}

/**
 * Area-average downscale (box filter with exact fractional pixel coverage).
 * Every source pixel contributes weight proportional to how much of it the
 * destination pixel covers, so a uniform image survives exactly and byte
 * values round half up. Returns the input object untouched when the image
 * is already inside the cap.
 */
export function downscaleTo(img: RawImage, maxEdge: number): RawImage {
  const target = fitWithin(img.width, img.height, maxEdge)
  if (target.width === img.width && target.height === img.height) return img

  const { width: sw, height: sh, data: src } = img
  const { width: dw, height: dh } = target
  const xRatio = sw / dw
  const yRatio = sh / dh
  const out = new Uint8ClampedArray(dw * dh * 4)

  for (let dy = 0; dy < dh; dy++) {
    const yStart = dy * yRatio
    const yEnd = (dy + 1) * yRatio
    const y0 = Math.floor(yStart)
    const y1 = Math.min(Math.ceil(yEnd), sh)
    for (let dx = 0; dx < dw; dx++) {
      const xStart = dx * xRatio
      const xEnd = (dx + 1) * xRatio
      const x0 = Math.floor(xStart)
      const x1 = Math.min(Math.ceil(xEnd), sw)

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let total = 0
      for (let sy = y0; sy < y1; sy++) {
        const cy = Math.min(sy + 1, yEnd) - Math.max(sy, yStart)
        if (cy <= 0) continue
        for (let sx = x0; sx < x1; sx++) {
          const cx = Math.min(sx + 1, xEnd) - Math.max(sx, xStart)
          if (cx <= 0) continue
          const w = cx * cy
          const o = (sy * sw + sx) * 4
          r += (src[o] ?? 0) * w
          g += (src[o + 1] ?? 0) * w
          b += (src[o + 2] ?? 0) * w
          a += (src[o + 3] ?? 0) * w
          total += w
        }
      }
      const d = (dy * dw + dx) * 4
      out[d] = Math.round(r / total)
      out[d + 1] = Math.round(g / total)
      out[d + 2] = Math.round(b / total)
      out[d + 3] = Math.round(a / total)
    }
  }
  return { width: dw, height: dh, data: out }
}

export type PreparedReference = {
  reference: RawImage
  /** True when transparency was composited onto white before measuring. */
  flattened: boolean
  /** True when the long edge exceeded the cap and the image was downscaled. */
  downscaled: boolean
}

/**
 * Builds the measurement reference from a decoded image: flatten first when
 * any transparency exists (so the downscale averages already-composited
 * pixels), then cap the long edge. When neither applies, the decoded image
 * itself is the reference, returned by identity.
 */
export function prepareReference(
  img: RawImage,
  maxEdge: number = MAX_REFERENCE_EDGE,
): PreparedReference {
  const flattened = hasTransparency(img)
  const flat = flattened ? flattenOntoWhite(img) : img
  const scaled = downscaleTo(flat, maxEdge)
  return { reference: scaled, flattened, downscaled: scaled !== flat }
}
