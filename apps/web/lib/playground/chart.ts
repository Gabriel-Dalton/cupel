import { formatBytes, formatTickNumber } from './format'

/**
 * Geometry for the hand-rolled SVG rate-distortion chart. Pure math:
 * candidate points in, pixel coordinates, hull path, and labelled axis
 * ticks out. The React layer draws exactly what this module computes, so
 * everything visual that can be wrong is testable here.
 *
 * Conventions: bytes grow rightward, quality loss (distortion) grows
 * upward. SVG y runs downward, so more distortion means a smaller y.
 */

export type ChartInputPoint = {
  key: string
  bytes: number
  distortion: number
  onHull: boolean
}

export type PlacedPoint = ChartInputPoint & { x: number; y: number }

export type Tick = { value: number; pos: number; label: string }

export type ChartGeometry = {
  width: number
  height: number
  plot: { left: number; top: number; right: number; bottom: number }
  points: PlacedPoint[]
  /** 'M x y L x y ...' through the hull points, bytes ascending. '' under 2. */
  hullPath: string
  xTicks: Tick[]
  yTicks: Tick[]
  /** Axis domain ceilings, equal to the last tick on each axis. */
  xMax: number
  yMax: number
}

/**
 * Round ticks from zero to a nice ceiling at or above maxValue. Steps are
 * 1, 2, 2.5, or 5 times a power of ten, chosen to land near targetCount
 * intervals. Values are snapped to 12 significant digits so 3 * 0.01 is
 * exactly 0.03 and labels never grow float dust.
 */
export function niceTicks(maxValue: number, targetCount = 5): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0, 1]
  const rawStep = maxValue / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const residual = rawStep / magnitude
  const multiplier = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10
  const step = multiplier * magnitude
  const ticks: number[] = []
  const count = Math.ceil(maxValue / step - 1e-9)
  for (let i = 0; i <= count; i++) {
    ticks.push(Number((step * i).toPrecision(12)))
  }
  return ticks
}

export type ChartOptions = {
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
}

/** Room for the y tick labels on the left and the x labels below. */
const DEFAULT_MARGIN = { top: 14, right: 18, bottom: 42, left: 58 }

export function buildChartGeometry(
  input: readonly ChartInputPoint[],
  opts: ChartOptions = {},
): ChartGeometry {
  const width = opts.width ?? 720
  const height = opts.height ?? 400
  const margin = opts.margin ?? DEFAULT_MARGIN
  const plot = {
    left: margin.left,
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
  }

  let maxBytes = 0
  let maxDistortion = 0
  for (const p of input) {
    if (p.bytes > maxBytes) maxBytes = p.bytes
    if (p.distortion > maxDistortion) maxDistortion = p.distortion
  }

  const xTickValues = niceTicks(maxBytes)
  const yTickValues = niceTicks(maxDistortion)
  const xMax = xTickValues[xTickValues.length - 1] ?? 1
  const yMax = yTickValues[yTickValues.length - 1] ?? 1

  const toX = (bytes: number) => plot.left + (bytes / xMax) * (plot.right - plot.left)
  const toY = (distortion: number) =>
    plot.bottom - (distortion / yMax) * (plot.bottom - plot.top)

  const points: PlacedPoint[] = input.map((p) => ({
    ...p,
    x: toX(p.bytes),
    y: toY(p.distortion),
  }))

  const hullPoints = points.filter((p) => p.onHull).sort((a, b) => a.bytes - b.bytes)
  const hullPath =
    hullPoints.length < 2
      ? ''
      : hullPoints
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
          .join(' ')

  const xTicks: Tick[] = xTickValues.map((value) => ({
    value,
    pos: toX(value),
    label: formatBytes(value),
  }))
  const yTicks: Tick[] = yTickValues.map((value) => ({
    value,
    pos: toY(value),
    label: formatTickNumber(value),
  }))

  return { width, height, plot, points, hullPath, xTicks, yTicks, xMax, yMax }
}
