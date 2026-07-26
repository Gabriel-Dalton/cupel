import type { OutputFormat } from '@cupel/core'

/**
 * Receipt formatting. Every number the playground shows passes through
 * here, so the strings are pinned by tests and identical everywhere they
 * appear: the ledger table, the receipt panel, and the chart axes.
 */

/**
 * Decimal units (1 kB = 1000 B, matching how transfer sizes are quoted
 * everywhere on the web), three significant figures.
 */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`
  const units = ['kB', 'MB', 'GB'] as const
  let value = n
  let unit: (typeof units)[number] = 'kB'
  for (const u of units) {
    value /= 1000
    unit = u
    if (value < 1000) break
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${unit}`
}

/** 'q62' for lossy, 'lossless' for null quality, 'source' for the kept file. */
export function formatQualityLabel(format: OutputFormat, quality: number | null): string {
  if (format === 'keep-original') return 'source'
  return quality === null ? 'lossless' : `q${quality}`
}

/** Structure scores (SSIM) pinned to four decimals, 1.0000 for identity. */
export function formatScore(n: number): string {
  return n.toFixed(4)
}

/** Colour drift (mean CIE76 deltaE) pinned to two decimals. */
export function formatDeltaE(n: number): string {
  return n.toFixed(2)
}

/** Distortion trimmed to three significant figures, no trailing zeros. */
export function formatDistortion(n: number): string {
  return Number(n.toPrecision(3)).toString()
}

/** Axis tick labels: the shortest exact decimal form. */
export function formatTickNumber(n: number): string {
  return Number(n.toPrecision(12)).toString()
}

/**
 * A byte saving as plain words. Below 0.05 percent either way it is a wash
 * and gets called one, instead of pretending precision.
 */
export function formatPercentSaved(fraction: number): string {
  if (Math.abs(fraction) < 0.0005) return 'same size'
  const pct = (Math.abs(fraction) * 100).toFixed(1)
  return fraction > 0 ? `${pct}% smaller` : `${pct}% larger`
}

/** Encode wall time: milliseconds under a second, seconds above. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  return `${s.toFixed(s >= 10 ? 1 : 2)} s`
}
