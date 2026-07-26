// Brand guard for the /verify surface. brand.md bans certain words from
// top-level copy and the repo protocol bans em dashes in every file. This
// test reads the shipped sources so a copy edit that drifts off-brand fails
// CI instead of shipping.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

const SURFACES = [
  join(WEB_ROOT, 'app', 'verify'),
  join(WEB_ROOT, 'lib', 'verify'),
]

// From brand.md section 3, "Words to Ban (from top-level copy)".
const BANNED = [
  /\bbone ash\b/i,
  /\bore\b/i,
  /\bsmelting\b/i,
  /\bintelligent\b/i,
  /\bseamless(ly)?\b/i,
  /\bmagic(al)?\b/i,
]

const EM_DASH = /—/

async function readSurfaceFiles(): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = []
  for (const dir of SURFACES) {
    for (const name of await readdir(dir)) {
      if (!/\.(tsx?|css|mdx?)$/.test(name)) continue
      const path = join(dir, name)
      out.push({ path, text: await readFile(path, 'utf8') })
    }
  }
  return out
}

describe('verify page brand guard', () => {
  it('has files to guard', async () => {
    const files = await readSurfaceFiles()
    expect(files.length).toBeGreaterThan(0)
  })

  it('contains no em dashes anywhere', async () => {
    for (const file of await readSurfaceFiles()) {
      expect(EM_DASH.test(file.text), `${file.path} contains an em dash`).toBe(false)
    }
  })

  it('contains no banned brand words', async () => {
    for (const file of await readSurfaceFiles()) {
      for (const pattern of BANNED) {
        expect(pattern.test(file.text), `${file.path} matches banned ${pattern}`).toBe(false)
      }
    }
  })
})
