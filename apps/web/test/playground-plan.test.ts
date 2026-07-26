import { describe, expect, it } from 'vitest'
import { wasmCodec } from '@cupel/codecs-wasm'
import {
  AVIF_QUALITY_LADDER,
  QUALITY_LADDER,
  SWEEP_FORMATS,
  buildSweepPlan,
  type FormatCapabilities,
  type SweepFormat,
} from '../lib/playground/plan'

/**
 * The candidate ladder the playground sweeps. The plan is pure data derived
 * from encoder capabilities, so it is tested here against the real adapter
 * capabilities from @cupel/codecs-wasm (reading .capabilities never loads
 * any wasm), plus synthetic capability sets for the clamping rules.
 */

function realCapabilities(): Record<SweepFormat, FormatCapabilities> {
  const caps = {} as Record<SweepFormat, FormatCapabilities>
  for (const format of SWEEP_FORMATS) {
    caps[format] = wasmCodec(format).capabilities
  }
  return caps
}

describe('quality ladders', () => {
  it('the full ladder is q40 to q95 in steps of 5, per BRIEF section 3.1', () => {
    expect(QUALITY_LADDER).toEqual([40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95])
  })

  it('the avif ladder is coarser: q40 to q90 in steps of 10', () => {
    // Deliberate: single threaded wasm avif encodes are the slow tail of the
    // sweep, and BRIEF section 15 names progressive fill and a reduced load
    // as the mitigation. Six points still shape the hull.
    expect(AVIF_QUALITY_LADDER).toEqual([40, 50, 60, 70, 80, 90])
  })
})

describe('buildSweepPlan against the real wasm adapter capabilities', () => {
  const plan = buildSweepPlan(realCapabilities())

  it('emits a full lossy ladder and no lossless point for jpeg', () => {
    const jpeg = plan.filter((s) => s.format === 'jpeg')
    expect(jpeg.map((s) => s.quality)).toEqual([...QUALITY_LADDER])
    expect(jpeg.every((s) => !s.lossless)).toBe(true)
  })

  it('emits a full lossy ladder plus one lossless point for webp', () => {
    const webp = plan.filter((s) => s.format === 'webp')
    expect(webp.filter((s) => !s.lossless).map((s) => s.quality)).toEqual([...QUALITY_LADDER])
    const lossless = webp.filter((s) => s.lossless)
    expect(lossless).toHaveLength(1)
    expect(lossless[0]?.quality).toBeNull()
  })

  it('emits exactly one lossless point for png, with a null quality', () => {
    const png = plan.filter((s) => s.format === 'png')
    expect(png).toHaveLength(1)
    expect(png[0]?.lossless).toBe(true)
    expect(png[0]?.quality).toBeNull()
  })

  it('emits the coarse lossy ladder and skips lossless for avif', () => {
    // avif advertises lossless, but a lossless AV1 encode in single threaded
    // wasm is the slowest candidate by far and nearly always loses to png on
    // bytes. The plan skips it on purpose; see the comment in plan.ts.
    const avif = plan.filter((s) => s.format === 'avif')
    expect(avif.map((s) => s.quality)).toEqual([...AVIF_QUALITY_LADDER])
    expect(avif.every((s) => !s.lossless)).toBe(true)
  })

  it('schedules avif last so the curve fills in fast before the slow tail', () => {
    const firstAvif = plan.findIndex((s) => s.format === 'avif')
    expect(firstAvif).toBeGreaterThan(-1)
    expect(plan.slice(firstAvif).every((s) => s.format === 'avif')).toBe(true)
  })

  it('keeps every lossy quality inside the advertised range', () => {
    const caps = realCapabilities()
    for (const step of plan) {
      if (step.lossless || step.quality === null) continue
      const [lo, hi] = caps[step.format].qualityRange
      expect(step.quality, step.label).toBeGreaterThanOrEqual(lo)
      expect(step.quality, step.label).toBeLessThanOrEqual(hi)
    }
  })

  it('gives every step a unique label', () => {
    const labels = plan.map((s) => s.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('has the expected total size: 12 jpeg + 12 webp + 1 webp lossless + 1 png + 6 avif', () => {
    expect(plan).toHaveLength(32)
  })
})

describe('buildSweepPlan against synthetic capabilities', () => {
  const none: FormatCapabilities = { qualityRange: [0, 0], lossless: false }

  it('clamps the ladder into a narrow advertised quality range', () => {
    const plan = buildSweepPlan({
      jpeg: { qualityRange: [60, 80], lossless: false },
      webp: none,
      png: none,
      avif: none,
    })
    expect(plan.map((s) => s.quality)).toEqual([60, 65, 70, 75, 80])
  })

  it('emits no lossy steps for a lossless-only quality range', () => {
    const plan = buildSweepPlan({
      jpeg: none,
      webp: none,
      png: { qualityRange: [0, 0], lossless: true },
      avif: none,
    })
    expect(plan).toHaveLength(1)
    expect(plan[0]?.format).toBe('png')
    expect(plan[0]?.lossless).toBe(true)
  })

  it('emits nothing for a format that can neither do lossy nor lossless', () => {
    const plan = buildSweepPlan({ jpeg: none, webp: none, png: none, avif: none })
    expect(plan).toEqual([])
  })
})
