import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    /**
     * Core's tests are numerically heavy by nature: the calibration fixtures
     * run the full provenance analysis (spectrum, Laplacian, blocking) over
     * megapixel images, which comfortably fits vitest's 5s default on a dev
     * machine and does not on a CI runner. 30s is generous enough for the
     * slowest shared runner while staying tight enough that a genuine hang
     * still fails rather than stalling the job. The other packages in this
     * workspace use 120s because they wait on real codecs.
     */
    testTimeout: 30_000,
  },
})
