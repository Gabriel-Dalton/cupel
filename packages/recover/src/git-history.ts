import type { DiscoveredAsset } from '@cupel/core'
import type { SourceCandidate, SourceRecoverer } from './types.js'

/**
 * Optimization passes routinely overwrite originals in place, so for a
 * file that lives in a git checkout the history often still holds a larger
 * (or pre-optimization) version. `git log --follow` lists every commit
 * that touched the path under the name it had at the time, and
 * `git cat-file -s` prices each historical blob without checking it out.
 * Blobs larger than today's file become candidates, largest first, as
 * `git:<commit>:<path>` URLs for the verification phase to materialize.
 *
 * This is the one file in the package allowed to touch Node: the real
 * runner shells out to git via child_process. It is injected as a
 * function returning stdout so tests never spawn a process, and the
 * dynamic import below only happens when the default recoverer actually
 * proposes.
 */

/** Runs `git <args>` in `cwd` and resolves with stdout, rejecting on failure. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>

const HASH_LINE_RE = /^[0-9a-f]{40}$/

type HistoryEntry = { hash: string; path: string }

/**
 * Parses `git log --follow --format=%H --name-only` output: each commit
 * prints its hash, a blank line, then the followed path as it existed at
 * that commit. Newest commit first.
 */
function parseLog(output: string): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  let hash: string | null = null
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (HASH_LINE_RE.test(line)) {
      hash = line
      continue
    }
    if (hash !== null) {
      // With --follow on a single path there is one name line per commit;
      // anything further before the next hash is noise and ignored.
      entries.push({ hash, path: line })
      hash = null
    }
  }
  return entries
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

async function proposeFromHistory(
  run: GitRunner,
  asset: DiscoveredAsset,
): Promise<SourceCandidate[]> {
  const localPath = asset.localPath
  if (localPath === undefined || localPath === '') return []
  const file = normalizeSlashes(localPath)
  const slash = file.lastIndexOf('/')
  const fileDir = slash === -1 ? '.' : file.slice(0, slash)

  let toplevel: string
  try {
    toplevel = normalizeSlashes((await run(['rev-parse', '--show-toplevel'], fileDir)).trim())
  } catch {
    // Not a git repository, or git itself is unavailable.
    return []
  }
  if (toplevel === '') return []

  // Case-insensitive prefix match: Windows paths commonly disagree on
  // drive letter or directory case between what the caller walked and what
  // git prints. 8.3 short names (PROGRA~1) are the caller's problem: they
  // must pass canonical paths, since expanding them needs the filesystem.
  const prefix = toplevel.endsWith('/') ? toplevel : `${toplevel}/`
  if (!file.toLowerCase().startsWith(prefix.toLowerCase())) return []
  const relPath = file.slice(prefix.length)
  if (relPath === '') return []

  let logOutput: string
  try {
    logOutput = await run(
      ['log', '--follow', '--format=%H', '--name-only', '--', relPath],
      toplevel,
    )
  } catch {
    return []
  }
  const entries = parseLog(logOutput)
  if (entries.length === 0) return []

  const sized: { entry: HistoryEntry; size: number }[] = []
  for (const entry of entries) {
    try {
      const stdout = await run(['cat-file', '-s', `${entry.hash}:${entry.path}`], toplevel)
      const size = Number.parseInt(stdout.trim(), 10)
      if (Number.isFinite(size) && size >= 0) sized.push({ entry, size })
    } catch {
      // The blob may be missing from a partial clone or the name-only line
      // may not resolve at that commit; skip it and keep the rest.
    }
  }
  if (sized.length === 0) return []

  // Baseline: the file's current size when known, otherwise the newest
  // readable blob (which is what the working copy was last committed as).
  const baseline = asset.bytes ?? sized[0]?.size
  if (baseline === undefined) return []

  const seen = new Set<string>()
  return sized
    .filter(({ size }) => size > baseline)
    .sort((a, b) => b.size - a.size)
    .map(({ entry, size }) => ({
      url: `git:${entry.hash}:${entry.path}`,
      via: 'git-history',
      rationale: `git history holds a ${size} byte version of ${entry.path} at ${entry.hash.slice(0, 12)} (the file is ${baseline} bytes now); an earlier optimization pass may have overwritten the original in place`,
    }))
    .filter((c) => {
      if (c.url === asset.url || c.url === localPath || seen.has(c.url)) return false
      seen.add(c.url)
      return true
    })
}

/** Builds the recoverer around an injected git runner (tests inject fakes). */
export function createGitHistoryRecoverer(run: GitRunner): SourceRecoverer {
  return {
    name: 'git-history',
    match(asset: DiscoveredAsset): boolean {
      return asset.localPath !== undefined && asset.localPath !== ''
    },
    propose(asset: DiscoveredAsset): Promise<SourceCandidate[]> {
      return proposeFromHistory(run, asset)
    },
  }
}

// The package tsconfig is platform neutral (no Node types) and tests never
// reach this runner, so the specifier goes through a plain string variable:
// tsc only resolves module declarations for literal specifiers, and this
// keeps the Node dependency invisible to the type checker while remaining
// a real child_process call at runtime.
const CHILD_PROCESS_SPECIFIER: string = 'node:child_process'

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void

const defaultGitRunner: GitRunner = async (args, cwd) => {
  const mod = (await import(/* @vite-ignore */ CHILD_PROCESS_SPECIFIER)) as {
    execFile: ExecFileFn
  }
  return new Promise<string>((resolve, reject) => {
    mod.execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(error)
    })
  })
}

export const gitHistoryRecoverer: SourceRecoverer = createGitHistoryRecoverer(defaultGitRunner)
