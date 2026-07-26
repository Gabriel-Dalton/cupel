import { build } from 'esbuild'

/**
 * Bundles the CLI into one runnable ESM file.
 *
 * Why a bundle rather than plain tsc output: every @cupel/* package in this
 * workspace publishes its TypeScript source (their exports point at
 * src/index.ts), which vitest and Next transpile on the fly but plain Node
 * cannot load. Bundling resolves all of that at build time, so the shipped
 * artifact is a single file that runs on any Node 20+ with no loader, no
 * transpiler, and no workspace layout to reproduce.
 *
 * sharp stays external because it ships a native binary per platform, which
 * a bundler must not inline. It is therefore a real runtime dependency of
 * this package, declared in package.json.
 *
 * commander is CommonJS and calls require() internally, so an ESM output
 * needs a require shim in the banner. Without it the bundle throws
 * "Dynamic require of node:events is not supported" on the first command.
 */
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['sharp'],
  banner: {
    js: [
      "import { createRequire as __cupelCreateRequire } from 'node:module'",
      'const require = __cupelCreateRequire(import.meta.url)',
    ].join('\n'),
  },
  logLevel: 'info',
})
