// Issue #7: the BRIEF's allocation floors (globalMinSsim 0.97, aboveFold
// 0.99, see DEFAULT_FLOORS in @cupel/core's rd/allocate) were written
// against standard SSIM's 11x11 gaussian sliding window scale, but cupel
// ships a documented variant: non overlapping 8x8 uniform windows, partial
// edge windows included, population statistics. This suite calibrates the
// variant empirically against sharp's mozjpeg encoder on synthetic
// photo-like content (gradients + seeded noise + edges, generated in code,
// no binary fixtures) and, crucially, measures a faithful in-test reference
// implementation of standard SSIM on the identical encodes, so the floors
// can be transferred between the two scales by measurement instead of
// assumption.
//
// Findings (measured 2026-07, sharp/mozjpeg pinned by the lockfile; the
// exact readings are dumped by the audit test below and pinned with margins
// in the assertions):
//
// 1. Near the floor region (readings at or above 0.96) the two scales agree
//    to within 0.012, and within 0.002 on smooth and grain-structured
//    content. The variant is never more than 0.002 STRICTER than standard
//    SSIM anywhere, and reads up to ~0.04 more forgiving deep below the
//    floors on noise-dominated content, where candidates are dropped under
//    any plausible floor, so the divergence cannot change a floor decision.
// 2. At the quality ladder's granularity (q steps of 5, the only
//    granularity the sweep ever evaluates), the 0.97 and 0.99 floors cross
//    at IDENTICAL ladder rungs under both formulations for every fixture.
//    A floor filter driven by cupel's variant therefore keeps and drops
//    exactly the same ladder candidates as one driven by standard SSIM.
// 3. The floors are content-relative on BOTH scales: grain-heavy content
//    (structured scene) never reaches 0.97 even at q95 under either metric,
//    so the global floor collapses such images to keep-original by design,
//    a property of SSIM itself, not an artifact of cupel's variant.
//
// Conclusion pinned here: the defaults 0.97 (global) and 0.99 (above fold)
// are VALIDATED for cupel's variant, no correction needed. If a future
// encoder or metric change shifts these curves, these assertions fail and
// the recalibration becomes a deliberate, reviewed change (GOVERNANCE.md).
import { beforeAll, describe, expect, it } from 'vitest'
import { ssim } from '@cupel/core'
import type { RawImage } from '@cupel/core'
import { sharpCodec } from '../src/index.js'

const SIZE = 256
const QUALITIES = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95] as const

// The floor defaults under calibration, literal on purpose: DEFAULT_FLOORS
// lives in @cupel/core and this suite validates the numbers themselves.
const GLOBAL_FLOOR = 0.97
const ABOVE_FOLD_FLOOR = 0.99

/** Small, fast, seeded PRNG. Deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type PixelFn = (x: number, y: number) => [number, number, number]

function makeImage(fn: PixelFn): RawImage {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = fn(x, y)
      const o = (y * SIZE + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  return { width: SIZE, height: SIZE, data }
}

/**
 * Smooth sky-like content: a two-axis color gradient with faint film grain
 * (amplitude 4). The easiest photo-like case for JPEG: mostly low frequency
 * energy, so every ladder quality reads high on both scales.
 */
function smoothGradient(): RawImage {
  const rand = mulberry32(101)
  const grain = new Float64Array(SIZE * SIZE)
  for (let i = 0; i < grain.length; i++) grain[i] = (rand() - 0.5) * 4
  return makeImage((x, y) => {
    const g = grain[y * SIZE + x] ?? 0
    return [120 + (x / SIZE) * 90 + g, 140 + (y / SIZE) * 70 + g, 200 - (x / SIZE) * 60 + g]
  })
}

/**
 * Portrait-like content: gradient background, a large soft-edged disc
 * (subject), hard rectangle edges (clothing, frame), moderate film grain
 * (amplitude 8). The grain dominates local variance on the flat regions and
 * JPEG destroys it at every quality, which caps SSIM well below 0.97 under
 * BOTH formulations: the worst realistic case for the global floor.
 */
function structuredScene(): RawImage {
  const rand = mulberry32(202)
  const grain = new Float64Array(SIZE * SIZE)
  for (let i = 0; i < grain.length; i++) grain[i] = (rand() - 0.5) * 8
  const cx = SIZE * 0.5
  const cy = SIZE * 0.42
  const radius = SIZE * 0.27
  return makeImage((x, y) => {
    const g = grain[y * SIZE + x] ?? 0
    let r = 90 + (y / SIZE) * 100
    let gr = 110 + (x / SIZE) * 60
    let b = 150 - (y / SIZE) * 40
    const d = Math.hypot(x - cx, y - cy)
    if (d < radius) {
      // Soft edge over the last 6 pixels of the disc.
      const t = Math.min(1, (radius - d) / 6)
      r = r * (1 - t) + 205 * t
      gr = gr * (1 - t) + 160 * t
      b = b * (1 - t) + 120 * t
    }
    if (y > SIZE * 0.78 && x > SIZE * 0.15 && x < SIZE * 0.85) {
      r = 40
      gr = 45
      b = 60
    }
    return [r + g, gr + g, b + g]
  })
}

/**
 * Foliage-like content: multi frequency sinusoids with strong seeded noise.
 * High frequency energy everywhere: hardest for JPEG at low quality, but the
 * structure is recoverable at high quality, so this is the fixture whose
 * curve actually sweeps through both floors within the ladder.
 */
function texturedScene(): RawImage {
  const rand = mulberry32(303)
  const noise = new Float64Array(SIZE * SIZE)
  for (let i = 0; i < noise.length; i++) noise[i] = (rand() - 0.5) * 48
  return makeImage((x, y) => {
    const n = noise[y * SIZE + x] ?? 0
    const wave =
      18 * Math.sin(x * 0.61) +
      14 * Math.sin(y * 0.83) +
      10 * Math.sin((x + y) * 0.29) +
      8 * Math.sin((x - y) * 0.47)
    return [70 + wave + n, 110 + wave + n * 0.8, 55 + wave * 0.6 + n * 0.5]
  })
}

const FIXTURES: ReadonlyArray<{ name: string; image: RawImage }> = [
  { name: 'smooth gradient', image: smoothGradient() },
  { name: 'structured scene', image: structuredScene() },
  { name: 'textured scene', image: texturedScene() },
]

// ---------------------------------------------------------------------------
// Reference implementation of standard SSIM (Wang et al. 2004): 11x11
// gaussian sliding window, sigma 1.5, valid-mode (windows fully inside the
// image), Rec. 601 luma exactly like cupel's variant, same Wang constants.
// This is the scale the BRIEF's floors were written against.
// ---------------------------------------------------------------------------

const WINDOW = 11
const SIGMA = 1.5
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

const KERNEL = (() => {
  const k = new Float64Array(WINDOW)
  const half = (WINDOW - 1) / 2
  let sum = 0
  for (let i = 0; i < WINDOW; i++) {
    k[i] = Math.exp(-((i - half) ** 2) / (2 * SIGMA * SIGMA))
    sum += k[i] ?? 0
  }
  for (let i = 0; i < WINDOW; i++) k[i] = (k[i] ?? 0) / sum
  return k
})()

function toLuma(img: RawImage): Float64Array {
  const out = new Float64Array(img.width * img.height)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    out[i] =
      0.299 * (img.data[o] ?? 0) + 0.587 * (img.data[o + 1] ?? 0) + 0.114 * (img.data[o + 2] ?? 0)
  }
  return out
}

/** Separable valid-mode gaussian filter: rows then columns. */
function gaussianValid(src: Float64Array, width: number, height: number): Float64Array {
  const w2 = width - WINDOW + 1
  const rows = new Float64Array(w2 * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w2; x++) {
      let acc = 0
      for (let k = 0; k < WINDOW; k++) acc += (KERNEL[k] ?? 0) * (src[y * width + x + k] ?? 0)
      rows[y * w2 + x] = acc
    }
  }
  const h2 = height - WINDOW + 1
  const out = new Float64Array(w2 * h2)
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let acc = 0
      for (let k = 0; k < WINDOW; k++) acc += (KERNEL[k] ?? 0) * (rows[(y + k) * w2 + x] ?? 0)
      out[y * w2 + x] = acc
    }
  }
  return out
}

function standardSsim(a: RawImage, b: RawImage): number {
  const { width, height } = a
  const la = toLuma(a)
  const lb = toLuma(b)
  const n = width * height
  const aa = new Float64Array(n)
  const bb = new Float64Array(n)
  const ab = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const va = la[i] ?? 0
    const vb = lb[i] ?? 0
    aa[i] = va * va
    bb[i] = vb * vb
    ab[i] = va * vb
  }
  const muA = gaussianValid(la, width, height)
  const muB = gaussianValid(lb, width, height)
  const sAA = gaussianValid(aa, width, height)
  const sBB = gaussianValid(bb, width, height)
  const sAB = gaussianValid(ab, width, height)
  let total = 0
  for (let i = 0; i < muA.length; i++) {
    const ma = muA[i] ?? 0
    const mb = muB[i] ?? 0
    const varA = (sAA[i] ?? 0) - ma * ma
    const varB = (sBB[i] ?? 0) - mb * mb
    const cov = (sAB[i] ?? 0) - ma * mb
    total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (varA + varB + C2))
  }
  return total / muA.length
}

// ---------------------------------------------------------------------------
// Measurement: both metrics on identical mozjpeg encodes, computed once.
// ---------------------------------------------------------------------------

type CurvePoint = { cupel: number; standard: number }
type Curve = Map<number, CurvePoint>

const curves = new Map<string, Curve>()

/** Smallest ladder quality whose reading clears the floor, or null. */
function crossing(curve: Curve, scale: keyof CurvePoint, floor: number): number | null {
  for (const q of QUALITIES) {
    if ((curve.get(q) as CurvePoint)[scale] >= floor) return q
  }
  return null
}

function point(name: string, q: number): CurvePoint {
  return (curves.get(name) as Curve).get(q) as CurvePoint
}

beforeAll(async () => {
  const jpeg = sharpCodec('jpeg')
  for (const { name, image } of FIXTURES) {
    const curve: Curve = new Map()
    for (const q of QUALITIES) {
      const decoded = await jpeg.decode(await jpeg.encode(image, { quality: q }))
      curve.set(q, { cupel: ssim(image, decoded), standard: standardSsim(image, decoded) })
    }
    curves.set(name, curve)
  }
}, 120_000)

describe('ssim floor calibration (issue #7)', () => {
  it('dumps the measured quality-to-ssim curves for audit', () => {
    for (const { name } of FIXTURES) {
      const curve = curves.get(name) as Curve
      const fmt = (scale: keyof CurvePoint): string =>
        [...curve.entries()].map(([q, s]) => `q${q}=${s[scale].toFixed(5)}`).join(' ')
      console.log(`${name} cupel:    ${fmt('cupel')}`)
      console.log(`${name} standard: ${fmt('standard')}`)
    }
    expect(curves.size).toBe(FIXTURES.length)
  })

  it('curves rise with quality and never regress more than codec jitter', () => {
    for (const { name } of FIXTURES) {
      for (const scale of ['cupel', 'standard'] as const) {
        for (let i = 1; i < QUALITIES.length; i++) {
          const prev = point(name, QUALITIES[i - 1] as number)[scale]
          const next = point(name, QUALITIES[i] as number)[scale]
          // mozjpeg is not perfectly monotone (trellis quantization), but
          // observed regressions are under 3e-4; 1e-3 is generous headroom.
          expect(next, `${name} ${scale} q${QUALITIES[i]}`).toBeGreaterThanOrEqual(prev - 1e-3)
        }
        const low = point(name, 50)[scale]
        const high = point(name, 95)[scale]
        expect(high, `${name} ${scale}: q95 above q50`).toBeGreaterThan(low + 0.001)
      }
    }
  })

  it('tracks the standard scale within 0.012 in the floor region', () => {
    for (const { name } of FIXTURES) {
      for (const q of QUALITIES) {
        const { cupel, standard } = point(name, q)
        // Deep below the floors the variant reads up to ~0.04 more forgiving
        // on noise-dominated content; irrelevant to floor decisions since
        // those points are dropped under any plausible floor.
        expect(Math.abs(cupel - standard), `${name} q${q}: scale delta`).toBeLessThanOrEqual(0.045)
        // The variant is never meaningfully stricter than standard SSIM, so
        // a floor tuned for the standard scale cannot over-reject on cupel's.
        expect(cupel, `${name} q${q}: never stricter`).toBeGreaterThanOrEqual(standard - 0.002)
        if (cupel >= 0.96 || standard >= 0.96) {
          expect(
            Math.abs(cupel - standard),
            `${name} q${q}: floor region delta`,
          ).toBeLessThanOrEqual(0.012)
        }
      }
    }
  })

  it('floors cross at identical ladder rungs on both scales, validating 0.97/0.99', () => {
    // The allocator only ever sees ladder encodes, so identical crossings
    // mean the floor filter keeps and drops exactly the same candidates
    // whether it is driven by cupel's variant or by standard SSIM. That is
    // the whole calibration question, answered: keep the defaults.
    const expected97: Record<string, number | null> = {
      'smooth gradient': 50,
      'structured scene': null,
      'textured scene': 90,
    }
    const expected99: Record<string, number | null> = {
      'smooth gradient': null,
      'structured scene': null,
      'textured scene': 95,
    }
    for (const { name } of FIXTURES) {
      const curve = curves.get(name) as Curve
      const cupel97 = crossing(curve, 'cupel', GLOBAL_FLOOR)
      const standard97 = crossing(curve, 'standard', GLOBAL_FLOOR)
      const cupel99 = crossing(curve, 'cupel', ABOVE_FOLD_FLOOR)
      const standard99 = crossing(curve, 'standard', ABOVE_FOLD_FLOOR)
      expect(cupel97, `${name}: 0.97 crossing, cupel vs standard`).toBe(standard97)
      expect(cupel99, `${name}: 0.99 crossing, cupel vs standard`).toBe(standard99)
      expect(cupel97, `${name}: 0.97 crossing rung`).toBe(expected97[name])
      expect(cupel99, `${name}: 0.99 crossing rung`).toBe(expected99[name])
    }
  })

  it('pins the variant absolute readings at the calibration anchors', () => {
    // q75 approximates "generally acceptable", q90 "visually transparent"
    // in the BRIEF's intent. Bands are the 2026-07 measurements with a
    // +/- 0.01 margin: a sharp or mozjpeg upgrade that shifts readings
    // beyond this is a recalibration event and should fail loudly.
    const anchors: ReadonlyArray<{ name: string; q: number; low: number; high: number }> = [
      { name: 'smooth gradient', q: 75, low: 0.965, high: 0.985 },
      { name: 'smooth gradient', q: 90, low: 0.968, high: 0.988 },
      { name: 'structured scene', q: 75, low: 0.916, high: 0.936 },
      { name: 'structured scene', q: 90, low: 0.934, high: 0.954 },
      { name: 'textured scene', q: 75, low: 0.914, high: 0.934 },
      { name: 'textured scene', q: 90, low: 0.972, high: 0.992 },
    ]
    for (const { name, q, low, high } of anchors) {
      const value = point(name, q).cupel
      expect(value, `${name} q${q}: cupel lower bound`).toBeGreaterThanOrEqual(low)
      expect(value, `${name} q${q}: cupel upper bound`).toBeLessThanOrEqual(high)
    }
  })

  it('documents that the floors are content-relative safety nets, by design', () => {
    // Grain-heavy content never clears the global floor at any ladder
    // quality under EITHER formulation: the 8x8 variant is not the cause.
    // Such images collapse to keep-original, which is the intended failure
    // mode (BRIEF 3.4: refused and no-op images keep their original bytes).
    const structured = curves.get('structured scene') as Curve
    const atBest = structured.get(95) as CurvePoint
    expect(atBest.cupel, 'structured q95 cupel').toBeLessThan(GLOBAL_FLOOR)
    expect(atBest.standard, 'structured q95 standard').toBeLessThan(GLOBAL_FLOOR)
    // Smooth content clears the global floor at every ladder rung on both
    // scales: the floor never binds where JPEG is visually safe.
    const smooth = curves.get('smooth gradient') as Curve
    for (const q of QUALITIES) {
      const p = smooth.get(q) as CurvePoint
      expect(p.cupel, `smooth q${q} cupel`).toBeGreaterThanOrEqual(GLOBAL_FLOOR)
      expect(p.standard, `smooth q${q} standard`).toBeGreaterThanOrEqual(GLOBAL_FLOOR)
    }
  })
})
