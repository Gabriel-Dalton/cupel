import { describe, expect, it } from 'vitest'
import { CUPEL_USER_AGENT, type Fetcher } from '../src/fetcher.js'

describe('CUPEL_USER_AGENT', () => {
  it('contains the project URL so site owners can identify the crawler', () => {
    // BRIEF section 9.3, citizenship: a descriptive User-Agent with the
    // project URL is non-negotiable for a public crawler.
    expect(CUPEL_USER_AGENT).toContain('github.com/Gabriel-Dalton/cupel')
  })

  it('names the tool before the first slash so robots.txt groups can target it', () => {
    // robots-parser matches the robots.txt group token against everything
    // before the first "/" in the UA, lowercased.
    expect(CUPEL_USER_AGENT.split('/')[0]).toBe('cupel-audit')
  })
})

describe('Fetcher', () => {
  it('is satisfied by the platform fetch function', () => {
    // Type-level assertion: the platform fetch must be assignable to the
    // injected Fetcher shape unchanged, otherwise the CLI and the hosted
    // endpoint cannot pass it (or an SSRF-guarded wrapper of it) straight in.
    const f: Fetcher = fetch
    expect(typeof f).toBe('function')
  })
})
