// Brand guard for the reader-facing surfaces.
//
// brand.md bans certain words from top-level copy and the repo protocol bans
// dash characters in every file. This test reads the shipped sources so a copy
// edit that drifts off-brand fails CI instead of shipping.
//
// The landing page and the demo are included because they are the first thing
// anyone sees, and because the whole point of the rewrite was to get the
// metallurgy vocabulary and the marketing filler out of them.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

const SURFACES = [
  join(WEB_ROOT, 'app', 'verify'),
  join(WEB_ROOT, 'lib', 'verify'),
  join(WEB_ROOT, 'app', '_demo'),
  join(WEB_ROOT, 'lib', 'demo'),
]

/** Individual files that are reader-facing but not in a guarded directory. */
const FILES = [join(WEB_ROOT, 'app', 'page.tsx'), join(WEB_ROOT, 'app', 'layout.tsx')]

// From brand.md section 5, "Never in top-level copy".
const BANNED = [
  // Metallurgy: the name is enough.
  /\bbone ash\b/i,
  /\bore\b/i,
  /\bsmelting\b/i,
  /\bcrucible\b/i,
  // Marketing filler.
  /\bintelligent\b/i,
  /\bseamless(ly)?\b/i,
  /\bmagic(al)?\b/i,
  /\brevolutionary\b/i,
  /\beffortless(ly)?\b/i,
  /\bcutting edge\b/i,
  /\bblazing fast\b/i,
  // AI tells.
  /\bleverage[sd]?\b/i,
  /\bunlock[s]?\b/i,
  /\bdelve[sd]?\b/i,
  /\btapestry\b/i,
]

/**
 * No dash characters in prose. Em dash and en dash are banned outright; the
 * hyphen is not, because code identifiers, CSS properties, and file names all
 * need it.
 */
const LONG_DASH = /[–—]/

/**
 * Mojibake: a UTF-8 sequence that has been read as latin-1 somewhere in the
 * toolchain. This is here because it actually happened: a shell rewrite turned
 * a middle dot into "Â·" and it shipped to the browser before anyone noticed.
 */
const MOJIBAKE = /Â.|â€|Ã[-¿]/

async function readSurfaceFiles(): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = []
  for (const dir of SURFACES) {
    for (const name of await readdir(dir)) {
      if (!/\.(tsx?|css|mdx?)$/.test(name)) continue
      const path = join(dir, name)
      out.push({ path, text: await readFile(path, 'utf8') })
    }
  }
  for (const path of FILES) {
    out.push({ path, text: await readFile(path, 'utf8') })
  }
  return out
}

describe('brand guard', () => {
  it('has files to guard', async () => {
    const files = await readSurfaceFiles()
    expect(files.length).toBeGreaterThan(6)
  })

  it('contains no em or en dashes anywhere', async () => {
    for (const file of await readSurfaceFiles()) {
      expect(LONG_DASH.test(file.text), `${file.path} contains a long dash`).toBe(false)
    }
  })

  it('contains no banned brand words', async () => {
    for (const file of await readSurfaceFiles()) {
      for (const pattern of BANNED) {
        expect(pattern.test(file.text), `${file.path} matches banned ${pattern}`).toBe(false)
      }
    }
  })

  it('contains no mis-decoded characters', async () => {
    for (const file of await readSurfaceFiles()) {
      expect(MOJIBAKE.test(file.text), `${file.path} looks like mojibake`).toBe(false)
    }
  })

  it('does not use a monospaced typeface', async () => {
    // brand.md section 7: numbers line up with tabular figures instead.
    // Terminal type makes the tool look like it is only for people who live
    // in terminals, which is the audience limit the redesign exists to break.
    for (const file of await readSurfaceFiles()) {
      expect(/font-mono|ui-monospace/.test(file.text), `${file.path} reaches for a mono font`).toBe(
        false,
      )
    }
  })
})
