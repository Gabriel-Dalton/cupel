import { describe, expect, it } from 'vitest'
import { laplacianSharpness } from '../../src/metrics/laplacian.js'
import {
  gaussianBlur,
  makeImage,
  mulberry32,
  noiseImage,
  solid,
  upscale2x,
} from '../helpers/fixtures.js'

/**
 * 90 percent solid gray frame with one 128x128 noise patch. Defined locally
 * because fixtures.ts has no composite fixture. Deterministic: makeImage
 * visits pixels in row major order, so the seeded PRNG stream is stable.
 */
function solidWithNoisePatch(
  width: number,
  height: number,
  patchX: number,
  patchY: number,
  patchSize: number,
  seed = 7,
): ReturnType<typeof makeImage> {
  const rand = mulberry32(seed)
  return makeImage(width, height, (x, y) => {
    const inPatch = x >= patchX && x < patchX + patchSize && y >= patchY && y < patchY + patchSize
    if (!inPatch) return [128, 128, 128, 255]
    return [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256), 255]
  })
}

describe('laplacianSharpness', () => {
  it('reports zero for a solid image', () => {
    const { p95, tilesEvaluated } = laplacianSharpness(solid(256, 256, [128, 128, 128]))
    expect(p95).toBeLessThan(1e-9)
    expect(tilesEvaluated).toBeGreaterThan(0)
  })

  it('scores a sharp image far above its blurred version, monotonically in sigma', () => {
    const base = noiseImage(512, 384, 42)
    const sharp = laplacianSharpness(base).p95
    const blurred = laplacianSharpness(gaussianBlur(base, 2.0)).p95
    expect(sharp).toBeGreaterThan(5 * blurred)

    // Strictly decreasing over sigmas [0, 1.0, 2.0]. sigma 0 is a clone of
    // the base, so this also pins "no blur" as the maximum of the series.
    const series = [0, 1.0, 2.0].map((s) => laplacianSharpness(gaussianBlur(base, s)).p95)
    const s0 = series[0] ?? 0
    const s1 = series[1] ?? 0
    const s2 = series[2] ?? 0
    expect(s0).toBeGreaterThan(s1)
    expect(s1).toBeGreaterThan(s2)
  })

  it('keeps a 2x upscale lower but on a comparable scale', () => {
    // Why these two readings differ at all: normalizeLongEdge deliberately
    // never upscales (a documented deviation from the brief's literal
    // "resize so the long edge is 1024"). Under literal upscaling semantics
    // the 512x384 base would be bilinearly upscaled to 1024x768, which is
    // exactly what upscale2x produces, so both fixtures would normalize to
    // identical pixels and the ratio would be exactly 1.0. Because the base
    // is instead measured at its native 512 scale, the comparison is
    // native-scale noise versus interpolated noise, and the gap is large:
    // the 3x3 Laplacian is a second difference operator whose power
    // response grows roughly like frequency^4, so halving every normalized
    // frequency collapses the response, and bilinear interpolation
    // additionally attenuates what remains. Both images are at or below
    // the 1024 long edge, so normalization resizes neither; the empirical
    // ratio for white noise is stable at 29.0 to 29.4 across seeds. The
    // sanity ceiling of 40 proves the two readings stay within a bounded,
    // same-order-of-magnitude band instead of diverging arbitrarily, while
    // the strict "lower" assertion carries the real meaning of the test.
    const base = noiseImage(512, 384, 42)
    const up = upscale2x(base)
    expect(up.width).toBe(1024)
    expect(up.height).toBe(768)
    const basP = laplacianSharpness(base).p95
    const upP = laplacianSharpness(up).p95
    expect(upP).toBeLessThan(basP)
    expect(basP).toBeLessThan(40 * upP)
  })

  it('still separates a 2x upscale when normalization engages (weak regime)', () => {
    // Both fixtures here are ABOVE the 1024 long edge, so both pass through
    // the area-average downscale before measurement. The upscaled image is
    // downscaled harder (2800 -> 1024 vs 1400 -> 1024), which averages away
    // much of the softness that distinguishes it, so the separation in this
    // regime is weak: measured base/upscaled ratio is about 2.0 (11699 vs
    // 5854, seed 42), versus about 29x below the normalized scale. Only the
    // direction is asserted; detecting upscaling of large images is
    // spectrum.ts effectiveResolution's job, not this metric's.
    const base = noiseImage(1400, 1050, 42)
    const up = upscale2x(base)
    const basP = laplacianSharpness(base).p95
    const upP = laplacianSharpness(up).p95
    expect(upP).toBeLessThan(basP)
    // Sanity floor so a future change cannot silently widen this into the
    // below-normalized-scale regime's 29x separation and invalidate the
    // "weak" characterization without this test noticing.
    expect(basP).toBeLessThan(4 * upP)
  })

  it('pins the residual measurement-scale cliff for identical-statistics noise', () => {
    // White noise at 1024x768 is measured natively; at 1100x825 it is area
    // averaged down to 1024x768 first. The two readings differ by a factor
    // of about 3.6 (measured 3.63 to 3.64 across seeds 1, 42, 99), and that
    // residual is honest measurement physics, in two parts:
    //   1. Information-theoretic: the 1100x825 image carries real detail
    //      above the 1024-scale Nyquist limit that no resampler can
    //      represent at the measurement scale; even an ideal brick-wall
    //      filter would read lower here.
    //   2. Filter rolloff: the area filter is not brick-wall, so it also
    //      attenuates retained frequencies near Nyquist, and the
    //      Laplacian's roughly frequency^4 power response amplifies that.
    // What the area filter FIXED is the old bilinear path's aliasing and
    // phase dependence: point-sampled bilinear skipped source pixels below
    // scale 0.5, so readings for identical-statistics noise bounced back
    // UP as images got larger (21860 at scale 0.64, 22444 at scale 0.32,
    // versus 16069 at scale 0.93). With area averaging the readings decay
    // with scale instead; the deep-downscale assertion below fails on the
    // bilinear path.
    const at1024 = laplacianSharpness(noiseImage(1024, 768, 42)).p95
    const at1100 = laplacianSharpness(noiseImage(1100, 825, 42)).p95
    const ratio = at1024 / at1100
    expect(ratio).toBeGreaterThan(3.4)
    expect(ratio).toBeLessThan(3.9)
    // Aliasing regression pin: a much larger identical-statistics image
    // must read lower than a slightly larger one, not higher. Bilinear
    // measured 22444 (3200x2400) vs 16069 (1100x825); area measures 3804
    // vs 14038.
    const at3200 = laplacianSharpness(noiseImage(3200, 2400, 42)).p95
    expect(at3200).toBeLessThan(at1100)
  })

  it('rates one sharp region as sharp, unlike a mean would', () => {
    // This is the reason p95 was chosen over the mean: a portrait with one
    // in-focus face in a sea of bokeh IS a sharp image. One genuinely sharp
    // tile pushes the upper percentiles up even when 90 percent of tiles
    // are flat, while a mean would dilute the signal toward zero.
    const flat = laplacianSharpness(solid(512, 384, [128, 128, 128])).p95
    const patched = laplacianSharpness(solidWithNoisePatch(512, 384, 100, 100, 128)).p95
    expect(patched).toBeGreaterThan(100 * flat)
    // Guard against the trivial pass (flat is 0): the patched value must
    // also be large in absolute terms.
    expect(patched).toBeGreaterThan(1000)
  })

  it('evaluates the expected tile count', () => {
    // 1024x1024 input: no resize, response grid is 1022x1022. Tiling by 64
    // gives 15 full tiles plus a 62px partial per axis, and 62 >= 16 so the
    // partials count: 16 x 16 = 256 tiles.
    const { tilesEvaluated } = laplacianSharpness(noiseImage(1024, 1024, 3))
    expect(tilesEvaluated).toBeGreaterThan(0)
    expect(tilesEvaluated).toBe(256)
  })

  it('falls back to a single whole-response tile for tiny images', () => {
    // 10x10 input: response grid is 8x8, below the 16x16 partial tile
    // minimum, so the regular tiling yields nothing. The whole response is
    // then evaluated as one tile rather than returning NaN.
    const { p95, tilesEvaluated } = laplacianSharpness(noiseImage(10, 10, 5))
    expect(tilesEvaluated).toBe(1)
    expect(Number.isFinite(p95)).toBe(true)
    expect(p95).toBeGreaterThan(0)
  })

  it('throws on images smaller than 3x3', () => {
    expect(() => laplacianSharpness(solid(2, 2, [0, 0, 0]))).toThrow()
    expect(() => laplacianSharpness(solid(100, 2, [0, 0, 0]))).toThrow()
    expect(() => laplacianSharpness(solid(2, 100, [0, 0, 0]))).toThrow()
  })
})
