import { defineConfig } from 'vitest/config'

export default defineConfig({
  // tsconfig leaves JSX for Next to transform, so tell esbuild to use the
  // automatic runtime here. Without it a test that renders a component to
  // markup fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
})
