import createMDX from '@next/mdx'
import remarkGfm from 'remark-gfm'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // .mdx files under content/ are imported as modules by the docs route.
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  // @cupel/core and @cupel/codecs-wasm are consumed as TypeScript source
  // (their package mains point at src/index.ts), so Next must transpile
  // them. This is deliberate: the landing page runs the real shipped
  // measurement code at build time, and the playground's sweep worker runs
  // the real wasm codec adapters in the browser. The @jsquash packages
  // reference their .wasm binaries with new URL(..., import.meta.url),
  // which webpack 5 emits as hashed static assets without extra config.
  transpilePackages: ['@cupel/core', '@cupel/codecs-wasm'],
  webpack: (config, { dev }) => {
    // core uses ESM-style ".js" specifiers that resolve to .ts source files.
    // tsc resolves these natively; webpack needs the standard extensionAlias.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }

    /*
     * Production builds do not reuse webpack's filesystem cache.
     *
     * The deployment restores .next/cache between builds. When the chunk graph
     * moves, which it does whenever a client component is added or a boundary
     * shifts, webpack can restore a cached asset that references a module hash
     * no longer in the compilation, and RealContentHashPlugin fails the build:
     *
     *   Cached asset static/chunks/webpack-<hash>.js references <hash> which is
     *   not in the compilation
     *
     * That happened on this branch, which moved the docs code blocks behind a
     * client component. The failure is not reproducible from a cold build, so
     * neither CI nor a local build can catch it: the only reliable fix is to
     * not read a cache that a different graph wrote.
     *
     * The cost is a cold compile every time. On a site this size that is
     * seconds, and it buys a build whose result depends on the commit alone,
     * which is worth more here than the seconds are. Dev keeps its cache, so
     * nobody's edit loop gets slower.
     */
    if (!dev) config.cache = false

    return config
  },
}

// remark-gfm is what makes pipe tables parse. Without it a markdown table in
// a doc renders as one run of literal pipe characters in a paragraph, which is
// exactly what the architecture page shipped. It also brings GFM strikethrough,
// task lists, and bare-URL autolinking, all of which the docs already assume.
const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkGfm],
  },
})

export default withMDX(nextConfig)
