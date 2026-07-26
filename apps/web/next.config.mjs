import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // .mdx files under content/ are imported as modules by the docs route.
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  // @cupel/core is consumed as TypeScript source (its package main points at
  // src/index.ts), so Next must transpile it. This is deliberate: the landing
  // page runs the real shipped measurement code at build time.
  transpilePackages: ['@cupel/core'],
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

const withMDX = createMDX({})

export default withMDX(nextConfig)
