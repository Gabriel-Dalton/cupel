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
  /** 0 to 100. Ignored when lossless is true. */
  quality?: number
  lossless?: boolean
}

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
  capabilities: {
    qualityRange: [number, number]
    lossless: boolean
  }
  encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array>
  decode(bytes: Uint8Array): Promise<RawImage>
}
