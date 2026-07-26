// Guards on the webpack settings the production build depends on.
//
// Both of these were paid for in failed builds. The extensionAlias is what lets
// core's ESM-style ".js" specifiers resolve to .ts source, and turning the
// filesystem cache off in production is what stops the deployment restoring a
// cache written by a different chunk graph, which fails the build inside
// RealContentHashPlugin with a message about an asset referencing a hash that is
// not in the compilation.
//
// Neither can be caught by building: a cold build passes with or without them.
import { describe, expect, it } from 'vitest'

type WebpackConfig = {
  resolve: { alias: Record<string, unknown>; extensionAlias?: Record<string, string[]> }
  module: { rules: unknown[] }
  cache?: unknown
}

type WebpackContext = {
  dev: boolean
  /** @next/mdx appends its loader after Next's, so the hook needs this. */
  defaultLoaders: { babel: unknown }
}

type NextConfig = {
  webpack: (config: WebpackConfig, context: WebpackContext) => WebpackConfig
}

function context(dev: boolean): WebpackContext {
  return { dev, defaultLoaders: { babel: 'next-swc-loader' } }
}

async function loadConfig(): Promise<NextConfig> {
  const mod = (await import('../next.config.mjs')) as { default: NextConfig }
  return mod.default
}

function freshConfig(): WebpackConfig {
  // Shaped like what Next hands the hook: resolve aliases, a rules array for
  // the MDX loader to append to, and the filesystem cache it has set up.
  return {
    resolve: { alias: {}, extensionAlias: {} },
    module: { rules: [] },
    cache: { type: 'filesystem' },
  }
}

describe('next webpack config', () => {
  it('resolves core ESM ".js" specifiers to TypeScript source', async () => {
    const config = await loadConfig()
    const out = config.webpack(freshConfig(), context(false))
    expect(out.resolve.extensionAlias?.['.js']).toEqual(['.ts', '.tsx', '.js'])
  })

  it('does not reuse a filesystem cache in production builds', async () => {
    const config = await loadConfig()
    const out = config.webpack(freshConfig(), context(false))
    expect(out.cache).toBe(false)
  })

  it('leaves the development cache alone', async () => {
    // The edit loop is the one place this cache genuinely pays for itself.
    const config = await loadConfig()
    const out = config.webpack(freshConfig(), context(true))
    expect(out.cache).toEqual({ type: 'filesystem' })
  })
})
