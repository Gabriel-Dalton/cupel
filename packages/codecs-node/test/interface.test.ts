import { describe, expect, it } from 'vitest'
import { sharpCodec } from '../src/index.js'

describe('codecs-node placeholder', () => {
  it('exports the sharpCodec factory', () => {
    expect(typeof sharpCodec).toBe('function')
  })
})
