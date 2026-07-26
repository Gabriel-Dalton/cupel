import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Platform modules that @cupel/core must never import. The list covers the
// node: prefix form and the bare form of every commonly reached-for builtin,
// plus the codec packages that belong in the adapter layers.
const coreForbiddenModules = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'stream',
  'stream/web',
  'buffer',
  'child_process',
  'util',
  'worker_threads',
  'events',
  'http',
  'https',
  'net',
  'tls',
  'url',
  'zlib',
  'assert',
  'module',
  'process',
  'v8',
  'vm',
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The one architectural rule enforced mechanically: @cupel/core is
    // platform neutral. No node builtins, no codec packages, no platform
    // globals. CI fails if this is violated.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: '@cupel/core is platform neutral. Node builtins are not allowed.',
            },
            {
              group: coreForbiddenModules,
              message: '@cupel/core is platform neutral. Node builtins are not allowed.',
            },
            {
              group: ['sharp', '@jsquash/*'],
              message:
                'Codecs are injected through the Encoder interface. They never appear in core.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'Buffer',
          message: '@cupel/core uses Uint8Array and Uint8ClampedArray, never Buffer.',
        },
        { name: 'process', message: '@cupel/core is platform neutral.' },
        { name: '__dirname', message: '@cupel/core is platform neutral.' },
        { name: '__filename', message: '@cupel/core is platform neutral.' },
        { name: 'require', message: '@cupel/core is ESM only and platform neutral.' },
      ],
    },
  },
)
