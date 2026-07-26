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
  webpack: (config) => {
    // core uses ESM-style ".js" specifiers that resolve to .ts source files.
    // tsc resolves these natively; webpack needs the standard extensionAlias.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
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
