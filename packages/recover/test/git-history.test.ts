import { describe, expect, it } from 'vitest'
import { createGitHistoryRecoverer, type GitRunner } from '../src/git-history.js'
import { asset } from './helpers/assets.js'

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)
const HASH_C = 'c'.repeat(40)

/**
 * git log --follow --format=%H --name-only output: hash line, blank line,
 * then the file's name as it existed at that commit. HASH_C shows the file
 * under its pre-rename path, which --follow surfaces.
 */
const LOG_OUTPUT = [
  HASH_A,
  '',
  'assets/hero.jpg',
  '',
  HASH_B,
  '',
  'assets/hero.jpg',
  '',
  HASH_C,
  '',
  'img/hero-original.jpg',
  '',
].join('\n')

const BLOB_SIZES: Record<string, string> = {
  [`${HASH_A}:assets/hero.jpg`]: '120000',
  [`${HASH_B}:assets/hero.jpg`]: '480000',
  [`${HASH_C}:img/hero-original.jpg`]: '910000',
}

function fakeRunner(overrides: {
  toplevel?: string
  log?: string
  sizes?: Record<string, string>
  failCatFileFor?: string
  calls?: { args: readonly string[]; cwd: string }[]
}): GitRunner {
  return async (args, cwd) => {
    overrides.calls?.push({ args, cwd })
    if (args[0] === 'rev-parse') return `${overrides.toplevel ?? '/repo'}\n`
    if (args[0] === 'log') return overrides.log ?? LOG_OUTPUT
    if (args[0] === 'cat-file') {
      const spec = args[2] ?? ''
      if (overrides.failCatFileFor !== undefined && spec.startsWith(overrides.failCatFileFor)) {
        throw new Error(`fatal: path does not exist: ${spec}`)
      }
      const size = (overrides.sizes ?? BLOB_SIZES)[spec]
      if (size === undefined) throw new Error(`fatal: not a valid object name: ${spec}`)
      return `${size}\n`
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`)
  }
}

const HERO = asset('https://site.example.com/assets/hero.jpg', {
  localPath: '/repo/assets/hero.jpg',
  bytes: 120000,
})

describe('gitHistoryRecoverer.match', () => {
  it('matches only assets with a localPath, without invoking git', () => {
    const recoverer = createGitHistoryRecoverer(async () => {
      throw new Error('match must never shell out')
    })
    expect(recoverer.match(HERO)).toBe(true)
    expect(recoverer.match(asset('https://site.example.com/assets/hero.jpg'))).toBe(false)
    expect(recoverer.match(asset('x', { localPath: '' }))).toBe(false)
  })
})

describe('gitHistoryRecoverer.propose', () => {
  it('proposes larger historical blobs, largest first, following renames', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({}))
    const candidates = await recoverer.propose(HERO)
    expect(candidates.map((c) => c.url)).toEqual([
      `git:${HASH_C}:img/hero-original.jpg`,
      `git:${HASH_B}:assets/hero.jpg`,
    ])
    expect(candidates[0]?.via).toBe('git-history')
    expect(candidates[0]?.rationale).toContain('910000')
  })

  it('skips blobs no larger than the current file', async () => {
    // HASH_A's blob is exactly asset.bytes, so it must not be proposed.
    const recoverer = createGitHistoryRecoverer(fakeRunner({}))
    const candidates = await recoverer.propose(HERO)
    expect(candidates.map((c) => c.url)).not.toContain(`git:${HASH_A}:assets/hero.jpg`)
  })

  it('baselines against the newest commit blob when asset.bytes is unknown', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({}))
    const candidates = await recoverer.propose(
      asset('https://site.example.com/assets/hero.jpg', { localPath: '/repo/assets/hero.jpg' }),
    )
    expect(candidates.map((c) => c.url)).toEqual([
      `git:${HASH_C}:img/hero-original.jpg`,
      `git:${HASH_B}:assets/hero.jpg`,
    ])
  })

  it('normalizes Windows paths and runs git from the repo toplevel', async () => {
    const calls: { args: readonly string[]; cwd: string }[] = []
    const recoverer = createGitHistoryRecoverer(fakeRunner({ toplevel: 'C:/repo', calls }))
    const candidates = await recoverer.propose(
      asset('hero.jpg', { localPath: 'C:\\repo\\assets\\hero.jpg', bytes: 120000 }),
    )
    expect(candidates.length).toBeGreaterThan(0)
    const logCall = calls.find((c) => c.args[0] === 'log')
    expect(logCall?.cwd).toBe('C:/repo')
    expect(logCall?.args).toContain('assets/hero.jpg')
  })

  it('returns no candidates when the file is outside the repo toplevel', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({ toplevel: '/elsewhere' }))
    const candidates = await recoverer.propose(HERO)
    expect(candidates).toEqual([])
  })

  it('returns no candidates when git fails entirely', async () => {
    const recoverer = createGitHistoryRecoverer(async () => {
      throw new Error('fatal: not a git repository')
    })
    const candidates = await recoverer.propose(HERO)
    expect(candidates).toEqual([])
  })

  it('returns no candidates when the log is empty', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({ log: '\n' }))
    const candidates = await recoverer.propose(HERO)
    expect(candidates).toEqual([])
  })

  it('skips a commit whose blob cannot be read and keeps the rest', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({ failCatFileFor: HASH_B }))
    const candidates = await recoverer.propose(HERO)
    expect(candidates.map((c) => c.url)).toEqual([`git:${HASH_C}:img/hero-original.jpg`])
  })

  it('never proposes the input URL or local path', async () => {
    const recoverer = createGitHistoryRecoverer(fakeRunner({}))
    const candidates = await recoverer.propose(HERO)
    expect(candidates.length).toBeGreaterThan(0)
    const urls = candidates.map((c) => c.url)
    expect(urls).not.toContain(HERO.url)
    expect(urls).not.toContain(HERO.localPath)
  })
})
