import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { gitStatus, guardRefusal } from '../src/lib/git.js'
import { tempDir } from './fixtures.js'

const run = promisify(execFile)

/**
 * The guard that keeps receipts meaningful. Every branch of the matrix is
 * covered here because the failure mode is silent: a guard that quietly
 * stops firing lets cupel mix its rewrites into unreviewed edits, and
 * nobody notices until a diff is unreadable.
 */

async function git(cwd: string, args: string[]): Promise<void> {
  await run(
    'git',
    ['-c', 'user.name=cupel test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, windowsHide: true },
  )
}

describe('git guard', () => {
  it('allows a directory that is not in a repository at all', async () => {
    const dir = await tempDir('cupel-git-none-')
    try {
      const status = await gitStatus(dir.path)
      expect(status.inRepo).toBe(false)
      expect(guardRefusal(status)).toBeNull()
    } finally {
      await dir.cleanup()
    }
  })

  it('allows a clean repository and refuses a dirty one', async () => {
    const dir = await tempDir('cupel-git-clean-')
    try {
      await git(dir.path, ['init'])
      await writeFile(join(dir.path, 'photo.jpg'), 'pretend bytes')
      await git(dir.path, ['add', '.'])
      await git(dir.path, ['commit', '-m', 'baseline'])

      const clean = await gitStatus(dir.path)
      expect(clean.inRepo).toBe(true)
      expect(clean.inRepo && clean.dirty).toEqual([])
      expect(guardRefusal(clean)).toBeNull()

      // A modified tracked file makes the target dirty.
      await writeFile(join(dir.path, 'photo.jpg'), 'different bytes')
      const modified = await gitStatus(dir.path)
      expect(modified.inRepo && modified.dirty).toContain('photo.jpg')

      const refusal = guardRefusal(modified)
      expect(refusal).not.toBeNull()
      expect(refusal).toContain('refusing to write')
      expect(refusal).toContain('committed baseline')
      expect(refusal).toContain('--force')
    } finally {
      await dir.cleanup()
    }
  }, 60_000)

  it('counts an untracked file as dirty', async () => {
    const dir = await tempDir('cupel-git-untracked-')
    try {
      await git(dir.path, ['init'])
      await writeFile(join(dir.path, 'seed.txt'), 'seed')
      await git(dir.path, ['add', '.'])
      await git(dir.path, ['commit', '-m', 'baseline'])

      // An untracked asset that a write would overwrite is exactly as
      // unreviewable as a modified one.
      await writeFile(join(dir.path, 'new.jpg'), 'pretend bytes')
      const status = await gitStatus(dir.path)
      expect(status.inRepo && status.dirty).toContain('new.jpg')
      expect(guardRefusal(status)).not.toBeNull()
    } finally {
      await dir.cleanup()
    }
  }, 60_000)
})
