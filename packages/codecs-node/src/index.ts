import type { EncodeOptions, Encoder, RawImage } from '@cupel/core'
import sharp from 'sharp'

export type CodecFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Maps each format to the underlying codec library reported by
 * sharp.versions. Used for both the encoder id and version(). Some prebuilt
 * sharp binaries omit entries, so every lookup has a fallback: png falls back
 * from spng to libpng, and everything falls back to sharp's own version.
 */
const CODEC_LIB: Record<CodecFormat, { label: string; version: () => string | undefined }> = {
  jpeg: { label: 'mozjpeg', version: () => sharp.versions.mozjpeg },
  png: { label: 'spng', version: () => sharp.versions.spng ?? sharp.versions.png },
  webp: { label: 'libwebp', version: () => sharp.versions.webp },
  avif: { label: 'libheif', version: () => sharp.versions.heif },
}

/** sharp's own encoder defaults, used when opts.quality is absent. */
const DEFAULT_QUALITY: Record<CodecFormat, number> = {
  jpeg: 80,
  png: 0,
  webp: 80,
  avif: 50,
}

function clampQuality(q: number | undefined, fallback: number): number {
  if (q === undefined || !Number.isFinite(q)) return fallback
  return Math.min(100, Math.max(1, Math.round(q)))
}

function assertDimensionsMatchData(img: RawImage): void {
  const expected = img.width * img.height * 4
  if (
    !Number.isInteger(img.width) ||
    !Number.isInteger(img.height) ||
    img.width <= 0 ||
    img.height <= 0 ||
    img.data.length !== expected
  ) {
    throw new Error(
      `RawImage dimensions do not match data length: ${img.width}x${img.height} RGBA ` +
        `requires ${expected} bytes, got ${img.data.length}`,
    )
  }
}

/**
 * Returns an Encoder backed by sharp for the given format.
 *
 * Conventions: decode always returns a fresh Uint8ClampedArray copy, never a
 * view over sharp's Buffer. JPEG cannot carry alpha, so images are flattened
 * onto white before jpeg encode and supportsAlpha is false for jpeg only.
 * qualityRange is [1, 100] for the lossy formats (sharp rejects 0); png is
 * always lossless and ignores quality, advertised as [0, 0] so callers can
 * tell the knob has no effect. Absent quality falls back to sharp's encoder
 * defaults: jpeg 80, webp 80, avif 50.
 */
export function sharpCodec(format: CodecFormat): Encoder {
  const lib = CODEC_LIB[format]
  const libVersion = lib.version() ?? sharp.versions.sharp
  const isJpeg = format === 'jpeg'

  return {
    id: `sharp@${sharp.versions.sharp}/${lib.label}@${libVersion}`,
    format,
    supportsAlpha: !isJpeg,
    capabilities: {
      qualityRange: format === 'png' ? [0, 0] : [1, 100],
      lossless: !isJpeg,
    },

    version(): Promise<string> {
      return Promise.resolve(libVersion)
    },

    async encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array> {
      assertDimensionsMatchData(img)
      const input = sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: img.width, height: img.height, channels: 4 },
      })
      const quality = clampQuality(opts.quality, DEFAULT_QUALITY[format])
      const lossless = opts.lossless === true

      let pipeline: sharp.Sharp
      switch (format) {
        case 'jpeg':
          // JPEG has no alpha channel: composite onto white so translucent
          // pixels degrade predictably instead of being dropped by libvips.
          pipeline = input.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality })
          break
        case 'png':
          pipeline = input.png()
          break
        case 'webp':
          pipeline = input.webp(lossless ? { lossless: true } : { quality })
          break
        case 'avif':
          pipeline = input.avif(lossless ? { lossless: true } : { quality })
          break
      }
      const encoded = await pipeline.toBuffer()
      // Copy out of the Buffer so callers never hold Node pool memory.
      return new Uint8Array(encoded)
    },

    async decode(bytes: Uint8Array): Promise<RawImage> {
      const { data, info } = await sharp(Buffer.from(bytes))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const copy = new Uint8ClampedArray(data.length)
      copy.set(data)
      return { width: info.width, height: info.height, data: copy }
    },
  }
}
