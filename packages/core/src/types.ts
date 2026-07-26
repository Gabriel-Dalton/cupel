/**
 * The one data shape every part of cupel agrees on. RGBA, 4 bytes per pixel,
 * non premultiplied alpha, row major, no padding.
 */
export type RawImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type OutputFormat = 'webp' | 'avif' | 'jpeg' | 'png' | 'keep-original'

export type EncodeOptions = {
  /**
   * 1 to 100 (values outside the range are clamped; non-finite values fall
   * back to the format default). Ignored when lossless is true.
   */
  quality?: number
  lossless?: boolean
}

/**
 * Per format default quality, applied by every adapter when opts.quality is
 * undefined. Defined once here so encode(img, {}) produces the same bitstream
 * on every platform. The values match the jSquash codec defaults; the node
 * adapter deliberately overrides sharp's own jpeg and webp default of 80 with
 * these so the browser playground's numbers stay stable across runtimes.
 */
export const ENCODER_DEFAULT_QUALITY = { jpeg: 75, webp: 75, avif: 50 } as const

/**
 * Codecs are injected. Core never imports an encoder; adapter packages
 * implement this interface (sharp in @cupel/codecs-node, jSquash WASM in
 * @cupel/codecs-wasm) and hand instances in from the outside.
 */
export interface Encoder {
  id: string
  format: OutputFormat
  version(): Promise<string>
  supportsAlpha: boolean
  /**
   * Lossless-only formats (png) advertise qualityRange [0, 0]: the quality
   * knob has no effect there, and the empty range lets callers detect that
   * without format special cases. Lossy-capable formats advertise [1, 100].
   */
  capabilities: {
    qualityRange: [number, number]
    lossless: boolean
  }
  encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array>
  decode(bytes: Uint8Array): Promise<RawImage>
}
