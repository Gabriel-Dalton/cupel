import { describe, expect, it } from 'vitest'
import {
  allRecoverers,
  cdnRecoverer,
  createGitHistoryRecoverer,
  gitHistoryRecoverer,
  nextjsRecoverer,
  retinaRecoverer,
  shopifyRecoverer,
  srcsetRecoverer,
  wordpressRecoverer,
} from '../src/index.js'

describe('allRecoverers registry', () => {
  it('lists all seven recoverers, platform-specific ones first', () => {
    expect(allRecoverers).toEqual([
      wordpressRecoverer,
      nextjsRecoverer,
      shopifyRecoverer,
      cdnRecoverer,
      srcsetRecoverer,
      retinaRecoverer,
      gitHistoryRecoverer,
    ])
  })

  it('gives every recoverer a unique name and the SourceRecoverer shape', () => {
    const names = allRecoverers.map((r) => r.name)
    expect(new Set(names).size).toBe(allRecoverers.length)
    expect(names).toEqual([
      'wordpress',
      'nextjs',
      'shopify',
      'cdn',
      'srcset',
      'retina',
      'git-history',
    ])
    for (const r of allRecoverers) {
      expect(typeof r.match).toBe('function')
      expect(typeof r.propose).toBe('function')
    }
  })

  it('exposes the git-history factory for injecting a runner', () => {
    expect(typeof createGitHistoryRecoverer).toBe('function')
    const custom = createGitHistoryRecoverer(async () => '')
    expect(custom.name).toBe('git-history')
  })
})
