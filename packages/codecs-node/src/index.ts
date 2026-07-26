import type { Encoder } from '@cupel/core'

export type CodecFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Returns an Encoder backed by sharp for the given format.
 */
export function sharpCodec(format: CodecFormat): Encoder {
  void format
  throw new Error('not implemented yet')
}
