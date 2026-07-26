import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDeltaE,
  formatDistortion,
  formatMs,
  formatPercentSaved,
  formatQualityLabel,
  formatScore,
  formatTickNumber,
} from '../lib/playground/format'

/**
 * Receipt formatting. These strings appear verbatim in the playground's
 * candidate ledger and receipt panel, so they are pinned exactly.
 */

describe('formatBytes', () => {
  it('uses decimal units with three significant figures', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1000)).toBe('1.00 kB')
    expect(formatBytes(4130)).toBe('4.13 kB')
    expect(formatBytes(41_234)).toBe('41.2 kB')
    expect(formatBytes(412_345)).toBe('412 kB')
    expect(formatBytes(3_180_000)).toBe('3.18 MB')
    expect(formatBytes(2_500_000_000)).toBe('2.50 GB')
  })
})

describe('formatQualityLabel', () => {
  it('labels lossy, lossless, and the kept source', () => {
    expect(formatQualityLabel('webp', 62)).toBe('q62')
    expect(formatQualityLabel('webp', null)).toBe('lossless')
    expect(formatQualityLabel('png', null)).toBe('lossless')
    expect(formatQualityLabel('keep-original', null)).toBe('source')
  })
})

describe('metric formatting', () => {
  it('pins structure scores to four decimals', () => {
    expect(formatScore(0.99311)).toBe('0.9931')
    expect(formatScore(1)).toBe('1.0000')
  })

  it('pins colour drift to two decimals', () => {
    expect(formatDeltaE(0.714)).toBe('0.71')
    expect(formatDeltaE(0)).toBe('0.00')
  })

  it('trims distortion to three significant figures', () => {
    expect(formatDistortion(0.008443)).toBe('0.00844')
    expect(formatDistortion(0)).toBe('0')
  })

  it('keeps tick labels terse', () => {
    expect(formatTickNumber(0.02)).toBe('0.02')
    expect(formatTickNumber(20)).toBe('20')
  })
})

describe('formatPercentSaved', () => {
  it('reads as a saving or a growth, one decimal', () => {
    expect(formatPercentSaved(0.871)).toBe('87.1% smaller')
    expect(formatPercentSaved(-0.12)).toBe('12.0% larger')
  })

  it('calls a wash a wash', () => {
    expect(formatPercentSaved(0)).toBe('same size')
    expect(formatPercentSaved(0.0004)).toBe('same size')
  })
})

describe('formatMs', () => {
  it('uses milliseconds below one second, seconds above', () => {
    expect(formatMs(412)).toBe('412 ms')
    expect(formatMs(1240)).toBe('1.24 s')
    expect(formatMs(61_500)).toBe('61.5 s')
  })
})
