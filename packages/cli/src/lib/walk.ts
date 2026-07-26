import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { hasImageExtension } from './sniff.js'

/**
 * Recursive image discovery for local targets. Symlinks are not followed:
 * a link out of the target directory would let a write escape it, and the
 * writer's containment guarantee is easier to keep if the walk never leaves
 * in the first place.
 */

/** Directories that never hold assets worth auditing or rewriting. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.cupel',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
])

export type WalkResult = {
  /** Absolute paths, sorted, so output is stable across filesystems. */
  files: string[]
  /** Directories skipped by name, reported rather than silently dropped. */
  skipped: string[]
}

export async function walkImages(root: string): Promise<WalkResult> {
  const files: string[] = []
  const skipped: string[] = []

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        skipped.push(`${relative(root, full) || entry.name} (symlink)`)
        continue
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped.push(`${relative(root, full) || entry.name}${sep}`)
          continue
        }
        await visit(full)
        continue
      }
      if (entry.isFile() && hasImageExtension(entry.name)) files.push(full)
    }
  }

  await visit(root)
  files.sort()
  skipped.sort()
  return { files, skipped }
}
