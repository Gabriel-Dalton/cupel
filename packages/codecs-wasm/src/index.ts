import type { Encoder } from '@cupel/core'

export type CodecFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Precompiled WASM modules keyed by role. In the browser, bundlers resolve
 * the .wasm assets and this can be omitted. In plain Node (tests, CLI use),
 * the caller reads the .wasm files shipped inside the @jsquash packages and
 * hands them in precompiled; this package never touches the filesystem.
 */
export type WasmModules = {
  encode?: WebAssembly.Module
  decode?: WebAssembly.Module
}

/**
 * Returns an Encoder backed by the jSquash WASM build for the given format.
 */
export function wasmCodec(format: CodecFormat, modules?: WasmModules): Encoder {
  void format
  void modules
  throw new Error('not implemented yet')
}
