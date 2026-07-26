import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The git guard. A receipt only means something against a committed
 * baseline: if the files being rewritten already had uncommitted edits,
 * nobody can later tell cupel's changes from the ones that were already
 * there, and `git diff` stops being a review tool. So `write --apply`
 * refuses on a dirty target unless the operator overrides it explicitly.
 *
 * Not being in a git repository at all is allowed. The guard exists to keep
 * version control useful, not to require it.
 */

export type GitStatus = { inRepo: false } | { inRepo: true; root: string; dirty: string[] }

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd, windowsHide: true })
  return stdout
}

/**
 * Reports whether `dir` sits inside a git work tree and, if so, which paths
 * under it have uncommitted changes. Untracked files count as dirty: an
 * untracked asset that write would overwrite is exactly as unreviewable as
 * a modified one.
 */
export async function gitStatus(dir: string): Promise<GitStatus> {
  let root: string
  try {
    root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return { inRepo: false }
  }
  if (root === '') return { inRepo: false }

  // --porcelain output is stable across git versions by contract. The path
  // is everything after the two status columns and a space; renames carry
  // "old -> new" and we keep the new side, which is the one on disk.
  const status = await git(dir, ['status', '--porcelain', '--', '.'])
  const dirty = status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3)
      const arrow = path.indexOf(' -> ')
      return arrow >= 0 ? path.slice(arrow + 4) : path
    })
    .map((path) => path.replace(/^"|"$/g, ''))

  return { inRepo: true, root, dirty }
}

export function guardRefusal(status: GitStatus): string | null {
  if (!status.inRepo) return null
  if (status.dirty.length === 0) return null
  const shown = status.dirty.slice(0, 10)
  const more = status.dirty.length - shown.length
  return [
    `refusing to write: ${status.dirty.length} uncommitted change(s) under the target.`,
    'A receipt only means something against a committed baseline, and cupel will not',
    'mix its own rewrites into edits you have not reviewed yet. Commit or stash first,',
    'or pass --force if you accept that the diff will be unreadable.',
    '',
    ...shown.map((path) => `  ${path}`),
    ...(more > 0 ? [`  ... and ${more} more`] : []),
  ].join('\n')
}
