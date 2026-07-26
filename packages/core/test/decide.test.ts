import { describe, expect, it } from 'vitest'
import type { ProvenanceRecord } from '../src/provenance/types.js'
import type { CandidatePoint } from '../src/rd/types.js'
import { DEFAULT_FLOORS, allocate } from '../src/rd/allocate.js'
import {
  LOW_HEADROOM_SSIM_MARGIN,
  NO_OP_MIN_SAVINGS,
  RECOVERY_TOLERANCE,
  acceptRecoveredSource,
  decideAsset,
} from '../src/decide.js'

function pt(
  bytes: number,
  distortion: number,
  ssim = 0.995,
  format: CandidatePoint['format'] = 'webp',
  quality: number | null = 75,
): CandidatePoint {
  return { format, quality, bytes, ssim, deltaE: 0.2, distortion, encoder: 'test' }
}

/** The keep-original point: ssim 1 and distortion 0 by definition. */
function keep(bytes: number): CandidatePoint {
  return {
    format: 'keep-original',
    quality: null,
    bytes,
    ssim: 1,
    deltaE: 0,
    distortion: 0,
    encoder: 'test',
  }
}

/** A healthy single-generation jpeg record; overrides carve out the cases. */
function prov(overrides: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    container: 'jpeg',
    estimatedOriginalQuality: 85,
    encoderFingerprint: null,
    generations: 1,
    chromaSubsampling: '4:2:0',
    declaredResolution: { w: 1600, h: 1067 },
    effectiveResolution: { w: 1600, h: 1067 },
    upscaled: false,
    blockingScore: 0.1,
    softness: { p95Laplacian: 600, verdict: 'sharp' },
    headroom: 'normal',
    evidence: ['test record'],
    ...overrides,
  }
}

describe('decideAsset: skips', () => {
  it('skips svg containers: vectors are never rasterized', () => {
    const res = decideAsset(prov({ container: 'svg' }), [keep(1000)])
    expect(res.decision).toBe('skipped')
    expect(res.chosen).toBeNull()
    expect(res.reason).toMatch(/vector/i)
  })

  it('skips gif containers: animation cannot be ruled out from the record', () => {
    const res = decideAsset(prov({ container: 'gif' }), [pt(100, 0.01, 0.99), keep(1000)])
    expect(res.decision).toBe('skipped')
    expect(res.reason).toMatch(/animat/i)
  })

  it('an explicit classification overrides the container default', () => {
    // The caller's classifier saw the actual frames; a static gif classified
    // as graphic may proceed to a decision.
    const candidates = [pt(100, 0.01, 0.99, 'png', null), keep(1000)]
    const asGraphic = decideAsset(prov({ container: 'gif' }), candidates, {
      classification: 'graphic',
    })
    expect(asGraphic.decision).toBe('encoded')
    // And the skip classes skip regardless of container.
    for (const classification of ['vector', 'animated', 'icon'] as const) {
      const res = decideAsset(prov(), candidates, { classification })
      expect(res.decision, classification).toBe('skipped')
      expect(res.reason).toContain(classification)
    }
  })

  it('skips when no candidate points were measured', () => {
    const res = decideAsset(prov(), [])
    expect(res.decision).toBe('skipped')
    expect(res.reason).toMatch(/no candidate/i)
  })
})

describe('decideAsset: refusal on exhausted headroom', () => {
  const spent = prov({ headroom: 'none', generations: 3, estimatedOriginalQuality: 45 })

  it('refuses to re-encode when headroom is none', () => {
    const res = decideAsset(spent, [keep(100000), pt(20000, 0.001, 0.999)])
    expect(res.decision).toBe('refused')
    expect(res.chosen).toBeNull()
    expect(res.reason).toMatch(/headroom none/)
  })

  it('refuses even when a candidate is technically better on every metric', () => {
    // An 80 percent saving at ssim 0.999 does not matter: the source is
    // spent and another generation is the one cost the tool never pays.
    const tempting = pt(1000, 0.0001, 0.9999, 'avif', 60)
    const res = decideAsset(spent, [keep(100000), tempting], { lambda: 1e-6 })
    expect(res.decision).toBe('refused')
  })

  it('states the exhaustion evidence in the reason', () => {
    const res = decideAsset(spent, [keep(1000)])
    expect(res.reason).toMatch(/3 encode generations/)
    expect(res.reason).toMatch(/quality 45/)
  })

  it('refusal precedes candidate inspection: empty list still refuses', () => {
    const res = decideAsset(spent, [])
    expect(res.decision).toBe('refused')
  })

  it('trusts the record when its headroom disagrees with its own fields', () => {
    // Hand-built record: headroom none with otherwise clean evidence. The
    // record is authoritative for the decision; the reason says why it can
    // not restate the evidence.
    const odd = prov({ headroom: 'none' })
    const res = decideAsset(odd, [keep(1000), pt(100, 0.01, 0.99)])
    expect(res.decision).toBe('refused')
    expect(res.reason).toMatch(/provenance record/i)
  })
})

describe('decideAsset: floors filter candidates', () => {
  const candidates = () => [
    pt(100, 0.05, 0.9),
    pt(200, 0.02, 0.98),
    pt(500, 0.01, 0.99),
    keep(1000),
  ]

  it('single mode picks the cheapest point clearing the global floor', () => {
    const res = decideAsset(prov(), candidates())
    expect(res.decision).toBe('encoded')
    expect(res.chosen?.bytes).toBe(200)
  })

  it('defaults to DEFAULT_FLOORS when no floors are given', () => {
    const implicit = decideAsset(prov(), candidates())
    const explicit = decideAsset(prov(), candidates(), { floors: DEFAULT_FLOORS })
    expect(implicit).toEqual(explicit)
  })

  it('above the fold applies the stricter floor', () => {
    const res = decideAsset(prov(), candidates(), { aboveFold: true })
    expect(res.decision).toBe('encoded')
    expect(res.chosen?.bytes).toBe(500)
  })

  it('keeps the original when every candidate falls below the floor', () => {
    const res = decideAsset(prov(), [pt(100, 0.05, 0.9), pt(200, 0.04, 0.95)])
    expect(res.decision).toBe('kept')
    expect(res.chosen).toBeNull()
    expect(res.reason).toMatch(/floor/)
  })
})

describe('decideAsset: low headroom demands margin over the floor', () => {
  const low = prov({ headroom: 'low', estimatedOriginalQuality: 70 })
  const candidates = () => [pt(200, 0.02, 0.97), pt(500, 0.005, 0.985), keep(1000)]

  it('pins the margin constant', () => {
    expect(LOW_HEADROOM_SSIM_MARGIN).toBe(0.01)
  })

  it('drops candidates that only just clear the floor', () => {
    // At normal headroom ssim 0.97 sits exactly on the global floor and the
    // 200 byte point wins. Low headroom raises the bar by the margin, so
    // only the 0.985 point survives.
    const normal = decideAsset(prov(), candidates())
    expect(normal.chosen?.bytes).toBe(200)
    const guarded = decideAsset(low, candidates())
    expect(guarded.decision).toBe('encoded')
    expect(guarded.chosen?.bytes).toBe(500)
    expect(guarded.reason).toMatch(/low headroom/i)
  })

  it('keeps the original when nothing clears the floor plus margin', () => {
    const res = decideAsset(low, [pt(200, 0.02, 0.97), keep(1000)])
    expect(res.decision).toBe('kept')
    expect(res.reason).toMatch(/low headroom/i)
  })

  it('caps the raised floor at ssim 1 so lossless points stay legal', () => {
    // Above the fold plus low headroom would push 0.99 past 1; a lossless
    // candidate at ssim exactly 1 must still be eligible.
    const res = decideAsset(low, [pt(800, 0, 1, 'png', null), keep(1000)], { aboveFold: true })
    expect(res.decision).toBe('encoded')
    expect(res.chosen?.bytes).toBe(800)
  })
})

describe('decideAsset: keep-original outcomes', () => {
  it('keeps when every encode costs at least as much as the original', () => {
    const res = decideAsset(prov(), [pt(1200, 0.01, 0.99), keep(1000)])
    expect(res.decision).toBe('kept')
    expect(res.chosen).toBeNull()
    expect(res.reason).toMatch(/keep-original/)
  })

  it('keeps at lambda 0: no byte pressure means maximum fidelity', () => {
    const res = decideAsset(prov(), [pt(500, 0.01, 0.99), keep(1000)], { lambda: 0 })
    expect(res.decision).toBe('kept')
  })
})

describe('decideAsset: no-op guard', () => {
  const original = keep(10000)

  it('pins the threshold constant', () => {
    expect(NO_OP_MIN_SAVINGS).toBe(0.05)
  })

  it('keeps when the best same-format point saves under 5 percent', () => {
    const res = decideAsset(prov(), [pt(9700, 0.001, 0.999, 'jpeg'), original])
    expect(res.decision).toBe('kept')
    expect(res.reason).toMatch(/no-op/i)
  })

  it('does not apply the guard across a format change', () => {
    const res = decideAsset(prov(), [pt(9700, 0.001, 0.999, 'webp'), original])
    expect(res.decision).toBe('encoded')
    expect(res.chosen?.bytes).toBe(9700)
  })

  it('encodes a same-format point at or above the threshold', () => {
    // Exactly 5 percent: the guard is strict, so the encode proceeds.
    const atThreshold = decideAsset(prov(), [pt(9500, 0.001, 0.999, 'jpeg'), original])
    expect(atThreshold.decision).toBe('encoded')
    const above = decideAsset(prov(), [pt(9400, 0.001, 0.999, 'jpeg'), original])
    expect(above.decision).toBe('encoded')
  })

  it('applies in lambda mode too', () => {
    // The 9700 -> 10000 upgrade rate is (0.001 - 0) / 300 = 3.33e-6, so at
    // lambda 1e-5 the allocator picks the jpeg encode, and the guard must
    // then collapse the 3 percent same-format saving to keep-original.
    const res = decideAsset(prov(), [pt(9700, 0.001, 0.999, 'jpeg'), original], {
      lambda: 1e-5,
    })
    expect(res.decision).toBe('kept')
    expect(res.reason).toMatch(/no-op/i)
  })
})

describe('decideAsset: lambda mode follows the allocator exactly', () => {
  // Marginal rates at weight 1: 100 -> 300 is (0.02 - 0.004) / 200 = 8e-5,
  // 300 -> keep is (0.004 - 0) / 700 = 5.714e-6.
  const candidates = () => [keep(1000), pt(300, 0.004, 0.995), pt(100, 0.02, 0.98)]

  it('chooses the allocator point at each lambda', () => {
    for (const [lambda, bytes] of [
      [1e-3, 100],
      [2e-5, 300],
    ] as const) {
      const res = decideAsset(prov(), candidates(), { lambda })
      expect(res.decision, `lambda ${lambda}`).toBe('encoded')
      expect(res.chosen?.bytes, `lambda ${lambda}`).toBe(bytes)
      const direct = allocate([{ id: 'x', weight: 1, hull: candidates() }], { lambda })
      expect(res.chosen).toEqual(direct.choices.get('x'))
    }
    // Below both rates the allocator buys everything: keep-original.
    expect(decideAsset(prov(), candidates(), { lambda: 1e-6 }).decision).toBe('kept')
  })

  it('weight scales the crossing: heavier assets hold quality longer', () => {
    const light = decideAsset(prov(), candidates(), { lambda: 2e-5, weight: 1 })
    expect(light.chosen?.bytes).toBe(300)
    const heavy = decideAsset(prov(), candidates(), { lambda: 2e-5, weight: 10 })
    expect(heavy.decision).toBe('kept')
  })
})

describe('decideAsset: validation and reasons', () => {
  it('rejects invalid weight and lambda', () => {
    const candidates = [keep(1000), pt(100, 0.01, 0.99)]
    expect(() => decideAsset(prov(), candidates, { weight: -1 })).toThrow(/weight/i)
    expect(() => decideAsset(prov(), candidates, { weight: Number.NaN })).toThrow(/weight/i)
    expect(() => decideAsset(prov(), candidates, { lambda: -1 })).toThrow(/lambda/i)
    expect(() => decideAsset(prov(), candidates, { lambda: Number.NaN })).toThrow(/lambda/i)
  })

  it('always populates a reason, for every decision kind', () => {
    const outcomes = [
      decideAsset(prov({ container: 'svg' }), []),
      decideAsset(prov(), []),
      decideAsset(prov({ headroom: 'none', generations: 2 }), [keep(1000)]),
      decideAsset(prov(), [pt(100, 0.05, 0.9)]),
      decideAsset(prov(), [pt(1200, 0.01, 0.99), keep(1000)]),
      decideAsset(prov(), [pt(200, 0.02, 0.98), keep(1000)]),
    ]
    const kinds = new Set(outcomes.map((o) => o.decision))
    expect(kinds).toEqual(new Set(['skipped', 'refused', 'kept', 'encoded']))
    for (const outcome of outcomes) {
      expect(outcome.reason.length).toBeGreaterThan(0)
    }
  })

  it('encoded reasons state bytes and the saving against the original', () => {
    const res = decideAsset(prov(), [pt(2000, 0.02, 0.98), keep(10000)])
    expect(res.decision).toBe('encoded')
    expect(res.reason).toMatch(/2000 bytes/)
    expect(res.reason).toMatch(/80(\.0)?%/)
  })

  it('is deterministic', () => {
    const run = () =>
      decideAsset(prov(), [pt(200, 0.02, 0.98), pt(500, 0.01, 0.99), keep(1000)], {
        lambda: 2e-5,
        weight: 3,
      })
    expect(run()).toEqual(run())
  })
})

describe('acceptRecoveredSource', () => {
  it('pins the documented tolerances', () => {
    expect(RECOVERY_TOLERANCE).toEqual({
      effectiveResolutionRatio: 0.05,
      estimatedOriginalQuality: 2,
    })
  })

  it('rejects an identical record: no strict improvement anywhere', () => {
    const res = acceptRecoveredSource(prov(), prov())
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/no strict improvement/i)
  })

  it('accepts a strict declared resolution improvement', () => {
    const current = prov({ declaredResolution: { w: 1024, h: 683 } })
    const candidate = prov({
      declaredResolution: { w: 4000, h: 2667 },
      effectiveResolution: null,
    })
    const res = acceptRecoveredSource(current, candidate)
    expect(res.accepted).toBe(true)
    expect(res.reason).toMatch(/^accepted/)
    expect(res.reason).toMatch(/declared resolution/)
  })

  it('rejects a candidate that improves resolution but adds a generation', () => {
    const current = prov({ declaredResolution: { w: 1024, h: 683 }, generations: 1 })
    const candidate = prov({
      declaredResolution: { w: 4000, h: 2667 },
      effectiveResolution: null,
      generations: 2,
    })
    const res = acceptRecoveredSource(current, candidate)
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/^rejected/)
    expect(res.reason).toMatch(/generations/)
  })

  it('accepts strictly fewer generations on its own', () => {
    const res = acceptRecoveredSource(prov({ generations: 2 }), prov({ generations: 1 }))
    expect(res.accepted).toBe(true)
    expect(res.reason).toMatch(/generations/)
  })

  it('quality must clear the 2 point estimation tolerance to count', () => {
    // 84 -> 85 is inside the noise of DQT inversion (BRIEF 4.1: accurate to
    // about 2 points), so it is not an improvement.
    const noise = acceptRecoveredSource(
      prov({ estimatedOriginalQuality: 84 }),
      prov({ estimatedOriginalQuality: 85 }),
    )
    expect(noise.accepted).toBe(false)
    const real = acceptRecoveredSource(
      prov({ estimatedOriginalQuality: 70 }),
      prov({ estimatedOriginalQuality: 85 }),
    )
    expect(real.accepted).toBe(true)
  })

  it('a quality dip within tolerance does not block another improvement', () => {
    const current = prov({
      declaredResolution: { w: 1024, h: 683 },
      estimatedOriginalQuality: 85,
    })
    const within = acceptRecoveredSource(
      current,
      prov({ declaredResolution: { w: 4000, h: 2667 }, estimatedOriginalQuality: 84 }),
    )
    expect(within.accepted).toBe(true)
    const beyond = acceptRecoveredSource(
      current,
      prov({ declaredResolution: { w: 4000, h: 2667 }, estimatedOriginalQuality: 80 }),
    )
    expect(beyond.accepted).toBe(false)
    expect(beyond.reason).toMatch(/quality/)
  })

  it('effective resolution improvements must clear the ratio tolerance', () => {
    const current = prov({ effectiveResolution: { w: 800, h: 600 } })
    const real = acceptRecoveredSource(
      current,
      prov({ effectiveResolution: { w: 1600, h: 1200 } }),
    )
    expect(real.accepted).toBe(true)
    const noise = acceptRecoveredSource(
      current,
      prov({ effectiveResolution: { w: 810, h: 600 } }),
    )
    expect(noise.accepted).toBe(false)
  })

  it('an effective resolution regression blocks a quality improvement', () => {
    const current = prov({
      effectiveResolution: { w: 1600, h: 1200 },
      estimatedOriginalQuality: 60,
    })
    const candidate = prov({
      effectiveResolution: { w: 800, h: 600 },
      estimatedOriginalQuality: 90,
    })
    const res = acceptRecoveredSource(current, candidate)
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/effective resolution/)
  })

  it('a declared resolution regression blocks, with zero tolerance', () => {
    const res = acceptRecoveredSource(
      prov({ declaredResolution: { w: 1600, h: 1067 }, estimatedOriginalQuality: 60 }),
      prov({ declaredResolution: { w: 1024, h: 683 }, estimatedOriginalQuality: 90 }),
    )
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/declared resolution/)
  })

  it('undetermined evidence is neutral: neither improvement nor regression', () => {
    // A png candidate has no jpeg quality estimate; that must not block a
    // resolution improvement, and it must not count as one either.
    const current = prov({ declaredResolution: { w: 1024, h: 683 } })
    const accepted = acceptRecoveredSource(
      current,
      prov({
        container: 'png',
        declaredResolution: { w: 4000, h: 2667 },
        estimatedOriginalQuality: null,
        generations: null,
        effectiveResolution: null,
      }),
    )
    expect(accepted.accepted).toBe(true)
    const onlyNulls = acceptRecoveredSource(
      current,
      prov({
        container: 'png',
        estimatedOriginalQuality: null,
        generations: null,
        effectiveResolution: null,
        declaredResolution: { w: 1024, h: 683 },
      }),
    )
    expect(onlyNulls.accepted).toBe(false)
  })

  it('reasons name all four dimensions so the ledger entry is auditable', () => {
    const res = acceptRecoveredSource(prov(), prov())
    for (const dimension of [
      'declared resolution',
      'effective resolution',
      'generations',
      'estimated original quality',
    ]) {
      expect(res.reason).toContain(dimension)
    }
  })
})
