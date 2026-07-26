import { describe, expect, it } from 'vitest'
import { wasmCodec } from '../src/index.js'

describe('codecs-wasm placeholder', () => {
  it('exports the wasmCodec factory', () => {
    expect(typeof wasmCodec).toBe('function')
  })
})
