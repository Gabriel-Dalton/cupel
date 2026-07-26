import type { SizingInputs } from './parse.js'

/**
 * Display dimension estimation against an assumed viewport. Approximate by
 * design: a static parse cannot run layout, so this resolves only the
 * evidence that has an unambiguous static meaning (px, %, vw, vh, and img
 * width/height attributes) and refuses the rest (auto, em, calc, and
 * anything responsive). Whenever an estimate is used, the caller must say
 * so in PageCrawl.notes (BRIEF section 15).
 */

export type Viewport = { width: number; height: number }

/**
 * The assumed desktop viewport when the caller does not provide one. BRIEF
 * does not pin a number; 1440x900 is the documented default for this
 * package and is always echoed in PageCrawl.assumedViewport and notes.
 */
export const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 }

export type DisplayEstimate = {
  width?: number
  height?: number
  /** True when at least one dimension could be estimated. */
  estimated: boolean
}

const LENGTH_RE = /^(-?\d+(?:\.\d+)?)(px|%|vw|vh)$/

/**
 * Resolves one CSS length to pixels, or undefined when it has no static
 * meaning. Percentages resolve against the viewport dimension on the same
 * axis, which assumes a full-width, full-height containing block; that is
 * part of the documented approximation.
 */
function resolveLength(
  value: string | undefined,
  axis: 'width' | 'height',
  viewport: Viewport,
): number | undefined {
  if (value === undefined) return undefined
  const m = LENGTH_RE.exec(value.trim().toLowerCase())
  if (m === null || m[1] === undefined) return undefined
  const n = Number(m[1])
  if (!(n > 0)) return undefined
  switch (m[2]) {
    case 'px':
      return Math.round(n)
    case '%':
      return Math.round((n / 100) * (axis === 'width' ? viewport.width : viewport.height))
    case 'vw':
      return Math.round((n / 100) * viewport.width)
    case 'vh':
      return Math.round((n / 100) * viewport.height)
    default:
      return undefined
  }
}

/**
 * CSS declarations win over attributes, matching the cascade. The width is
 * clamped to the viewport because pages overwhelmingly constrain images
 * with max-width: 100%; when both dimensions came from attributes the
 * height is scaled with the clamp to preserve the declared aspect ratio,
 * while an explicit CSS height is kept as written.
 */
export function estimateDisplayDims(sizing: SizingInputs, viewport: Viewport): DisplayEstimate {
  const cssWidth = resolveLength(sizing.css['width'], 'width', viewport)
  const cssHeight = resolveLength(sizing.css['height'], 'height', viewport)

  let width = cssWidth ?? positive(sizing.attrWidth)
  let height = cssHeight ?? positive(sizing.attrHeight)

  if (width !== undefined && width > viewport.width) {
    const bothFromAttrs = cssWidth === undefined && cssHeight === undefined
    if (bothFromAttrs && height !== undefined) {
      height = Math.round((height * viewport.width) / width)
    }
    width = viewport.width
  }

  return { width, height, estimated: width !== undefined || height !== undefined }
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}
