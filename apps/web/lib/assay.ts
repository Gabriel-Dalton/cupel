import { blockingScore, deltaE, effectiveResolution, laplacianSharpness, ssim } from '@cupel/core'
import { buildSpecimens } from './specimen'

/**
 * The specimen ledger shown on the landing page.
 *
 * Every number in it is computed here, at build time, by the shipped
 * @cupel/core measurement code running against the seeded specimens from
 * specimen.ts. Nothing is typed in.
 *
 * The invariant checks at the bottom are this module's test suite. apps/web
 * has no unit test harness, so the assertions run inside the static build
 * instead: if a specimen ever stops demonstrating what the landing copy
 * claims (for example the hue shift becomes visible to the structure check,
 * or the upscale stops reading as roughly half resolution), `next build`
 * throws and the site refuses to ship the stale claim.
 */

export type LedgerRow = {
  /** Short specimen name, e.g. "Block damage". */
  specimen: string
  /** What was done to the reference, in plain words. */
  treatment: string
  /** The measurement that catches it. */
  reading: { label: string; value: string }
  /** The same measurement on the untouched reference, for contrast. */
  baseline: { label: string; value: string }
  /** One line stating what the pair of numbers means. */
  verdict: string
}

export type AssayReport = {
  rows: LedgerRow[]
  /** Identity check, quoted in the table caption: structure of ref vs itself. */
  selfStructure: string
}

function invariant(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`assay ledger invariant failed: ${message}`)
  }
}

const fmt = (n: number, digits: number): string => n.toFixed(digits)

export function runAssay(): AssayReport {
  const s = buildSpecimens()
  const ref = s.reference

  // Identity: the structure score of the reference against itself must be
  // exactly 1, not 0.9999. This mirrors the core test suite's own contract.
  const self = ssim(ref, ref)
  invariant(self === 1, `self structure must be exactly 1, got ${self}`)

  // Block damage: seam energy well above the reference, structure clearly down.
  const seamDamaged = blockingScore(s.blockDamaged).combined
  const seamRef = blockingScore(ref).combined
  const structureBlocked = ssim(ref, s.blockDamaged)
  invariant(seamDamaged > 1.5, `block damage seam energy must exceed 1.5, got ${seamDamaged}`)
  invariant(seamRef < 1.1, `reference seam energy must stay near 1, got ${seamRef}`)

  // Hue shift: the structure check must stay blind while colour drift lands
  // far past the just noticeable difference (about 2.3 for this measure).
  const structureHue = ssim(ref, s.hueShifted)
  const driftHue = deltaE(ref, s.hueShifted).mean
  const driftRef = deltaE(ref, ref).mean
  invariant(structureHue > 0.995, `hue shift must be invisible to structure, got ${structureHue}`)
  invariant(driftHue > 2.3, `hue shift colour drift must exceed the JND, got ${driftHue}`)
  invariant(driftRef === 0, `reference colour drift against itself must be 0, got ${driftRef}`)

  // Blur: the sharpest region's detail variance collapses.
  const detailBlurred = laplacianSharpness(s.blurred).p95
  const detailRef = laplacianSharpness(ref).p95
  invariant(
    detailBlurred < 0.2 * detailRef,
    `blur must cut detail variance below 20 percent of reference, got ${detailBlurred} vs ${detailRef}`,
  )

  // Upscale: an image enlarged 2x declares 512 but should measure near 256.
  const res = effectiveResolution(s.upscaled)
  const ratio = res.effective.w / res.declared.w
  invariant(
    ratio > 0.4 && ratio < 0.65,
    `2x upscale must measure near half its declared size, got ratio ${ratio}`,
  )

  return {
    selfStructure: fmt(self, 3),
    rows: [
      {
        specimen: 'Block damage',
        treatment: 'every 8x8 block pulled toward its mean',
        reading: { label: 'seam energy', value: fmt(seamDamaged, 2) },
        baseline: { label: 'reference', value: fmt(seamRef, 2) },
        verdict: `Prior block-based compression detected. Structure also drops to ${fmt(structureBlocked, 3)}.`,
      },
      {
        specimen: 'Hue shift',
        treatment: 'colour moved, brightness held constant',
        reading: { label: 'colour drift', value: fmt(driftHue, 1) },
        baseline: { label: 'reference', value: fmt(driftRef, 1) },
        verdict: `The structure check reads ${fmt(structureHue, 3)} and sees nothing. The colour measure catches what it cannot.`,
      },
      {
        specimen: 'Blur',
        treatment: 'radius 2 box blur',
        reading: { label: 'detail variance', value: fmt(detailBlurred, 0) },
        baseline: { label: 'reference', value: fmt(detailRef, 0) },
        verdict: 'Fine detail is gone and the sharpest surviving region proves it.',
      },
      {
        specimen: 'Upscale',
        treatment: 'enlarged 2x, declares 512 px',
        reading: { label: 'measured', value: `${res.effective.w} px` },
        baseline: { label: 'declared', value: `${res.declared.w} px` },
        verdict: 'The file declares a resolution its pixels do not carry.',
      },
    ],
  }
}
