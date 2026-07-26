import { describe, expect, it } from 'vitest'
import { buildProgram } from '../src/index.js'

describe('cli registry', () => {
  it('registers all four commands', () => {
    const program = buildProgram()
    const names = program.commands.map((c) => c.name())
    expect(names).toEqual(expect.arrayContaining(['inspect', 'audit', 'write', 'verify']))
  })
})
