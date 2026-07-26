import { readFile } from 'node:fs/promises'
import { analyzeProvenance } from '@cupel/core'
import type { Container, ProvenanceRecord, RawImage } from '@cupel/core'
import { sharpCodec } from '@cupel/codecs-node'
import type { DecodableContainer } from './sniff.js'
import { isDecodable, sniffContainer } from './sniff.js'

/**
 * One local file, opened and understood as far as it honestly can be.
 * Everything downstream (inspect, audit, write) starts here, so the rules
 * about what is knowable live in one place: the container comes from the
 * bytes, pixels come from sharp, and provenance comes from core. When the
 * container cannot be decoded (svg, gif) there is no ProvenanceRecord at
 * all rather than a fabricated one.
 */

export type Examined = {
  path: string
  bytes: Uint8Array
  container: Container
  /** null for containers this toolchain does not decode (svg, gif). */
  image: RawImage | null
  /** null whenever image is null: provenance needs pixels. */
  provenance: ProvenanceRecord | null
  /** Why provenance is absent, when it is. */
  note: string | null
}

export class UnreadableInput extends Error {}

export async function decodeBytes(
  container: DecodableContainer,
  bytes: Uint8Array,
): Promise<RawImage> {
  return sharpCodec(container).decode(bytes)
}

/**
 * Reads and examines one file. Throws UnreadableInput when the file cannot
 * be opened or the bytes are not a recognized image; a recognized container
 * that cannot be decoded is a normal result carrying a note, not an error,
 * because an audit should list an svg rather than abort on one.
 *
 * EXIF orientation is deliberately NOT applied: the browser verifier does
 * not rotate either, and a receipt is only checkable if both sides derive
 * the reference the same way.
 */
export async function examine(path: string): Promise<Examined> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(path))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new UnreadableInput(`cannot read ${path}: ${message}`)
  }
  if (bytes.length === 0) throw new UnreadableInput(`${path} is empty`)

  const container = sniffContainer(bytes)
  if (container === null) {
    throw new UnreadableInput(
      `${path} is not a recognized image container (jpeg, png, webp, avif, gif, svg)`,
    )
  }

  if (!isDecodable(container)) {
    return {
      path,
      bytes,
      container,
      image: null,
      provenance: null,
      note: `${container} is reported but not decoded: cupel never rasterizes a vector or flattens an animation`,
    }
  }

  let image: RawImage
  try {
    image = await decodeBytes(container, bytes)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      path,
      bytes,
      container,
      image: null,
      provenance: null,
      note: `decode failed: ${message}`,
    }
  }

  return {
    path,
    bytes,
    container,
    image,
    provenance: analyzeProvenance({ container, image, bytes }),
    note: null,
  }
}
