'use client'

import { useMemo } from 'react'
import { buildChartGeometry, type ChartInputPoint } from '../../lib/playground/chart'

/**
 * The live rate-distortion chart: hand-rolled inline SVG, no chart library.
 * All geometry comes from lib/playground/chart.ts, which is tested; this
 * component only draws.
 *
 * Interaction: candidates are clickable, and the wrapper takes focus so
 * Left/Right walk the selection along the curve in byte order. The candidate
 * ledger table next to the chart is the fully accessible representation of
 * the same data, with a real button per row.
 */

export type RdChartPoint = ChartInputPoint & { label: string }

export function RdChart({
  points,
  selectedKey,
  onSelect,
}: {
  points: readonly RdChartPoint[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const geometry = useMemo(() => buildChartGeometry(points), [points])
  const labelByKey = useMemo(() => new Map(points.map((p) => [p.key, p.label])), [points])
  const byteOrder = useMemo(
    () => [...points].sort((a, b) => a.bytes - b.bytes).map((p) => p.key),
    [points],
  )

  const selected = geometry.points.find((p) => p.key === selectedKey) ?? null

  function moveSelection(delta: number) {
    if (byteOrder.length === 0) return
    const at = selectedKey ? byteOrder.indexOf(selectedKey) : -1
    const next = at === -1 ? 0 : Math.min(byteOrder.length - 1, Math.max(0, at + delta))
    const key = byteOrder[next]
    if (key !== undefined) onSelect(key)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(1)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(-1)
        break
      case 'Home':
        event.preventDefault()
        if (byteOrder[0] !== undefined) onSelect(byteOrder[0])
        break
      case 'End': {
        event.preventDefault()
        const last = byteOrder[byteOrder.length - 1]
        if (last !== undefined) onSelect(last)
        break
      }
    }
  }

  const { plot } = geometry

  return (
    <div
      className="pg-chart"
      role="group"
      tabIndex={0}
      aria-label={`Rate-distortion chart, ${points.length} measured candidates. Selected: ${
        selectedKey ? (labelByKey.get(selectedKey) ?? 'none') : 'none'
      }. Use the Left and Right arrow keys to move the selection along the curve, Home and End for the extremes. The candidate ledger below holds the same data as a table.`}
      onKeyDown={onKeyDown}
    >
      <svg
        className="pg-chart__svg"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* Gridlines */}
        {geometry.xTicks.map((tick) => (
          <line
            key={`gx-${tick.value}`}
            className="pg-chart__grid"
            x1={tick.pos}
            y1={plot.top}
            x2={tick.pos}
            y2={plot.bottom}
          />
        ))}
        {geometry.yTicks.map((tick) => (
          <line
            key={`gy-${tick.value}`}
            className="pg-chart__grid"
            x1={plot.left}
            y1={tick.pos}
            x2={plot.right}
            y2={tick.pos}
          />
        ))}

        {/* Axes */}
        <line
          className="pg-chart__axis"
          x1={plot.left}
          y1={plot.top}
          x2={plot.left}
          y2={plot.bottom}
        />
        <line
          className="pg-chart__axis"
          x1={plot.left}
          y1={plot.bottom}
          x2={plot.right}
          y2={plot.bottom}
        />

        {/* Tick labels */}
        {geometry.xTicks.map((tick) => (
          <text
            key={`tx-${tick.value}`}
            className="pg-chart__tick"
            x={tick.pos}
            y={plot.bottom + 16}
            textAnchor="middle"
          >
            {tick.label}
          </text>
        ))}
        {geometry.yTicks.map((tick) => (
          <text
            key={`ty-${tick.value}`}
            className="pg-chart__tick"
            x={plot.left - 8}
            y={tick.pos}
            dy="0.32em"
            textAnchor="end"
          >
            {tick.label}
          </text>
        ))}

        {/* Axis titles */}
        <text
          className="pg-chart__axis-title"
          x={(plot.left + plot.right) / 2}
          y={geometry.height - 6}
          textAnchor="middle"
        >
          encoded size
        </text>
        <text
          className="pg-chart__axis-title"
          transform={`rotate(-90 14 ${(plot.top + plot.bottom) / 2})`}
          x={14}
          y={(plot.top + plot.bottom) / 2}
          textAnchor="middle"
        >
          quality loss, lower is better
        </text>

        {/* The frontier */}
        {geometry.hullPath !== '' && <path className="pg-chart__hull" d={geometry.hullPath} />}

        {/* Selection crosshair: a drop line from the point to the byte axis */}
        {selected && (
          <line
            className="pg-chart__drop"
            x1={selected.x}
            y1={selected.y}
            x2={selected.x}
            y2={plot.bottom}
          />
        )}

        {/* Candidates. Dominated points faint, frontier points accented. */}
        {geometry.points.map((p) => (
          <g
            key={p.key}
            className={`pg-chart__pt ${p.onHull ? 'pg-chart__pt--hull' : ''} ${
              p.key === selectedKey ? 'pg-chart__pt--selected' : ''
            }`}
            onClick={() => onSelect(p.key)}
          >
            <title>{labelByKey.get(p.key) ?? p.key}</title>
            {/* A generous invisible hit area so 3.5px dots are clickable. */}
            <circle className="pg-chart__hit" cx={p.x} cy={p.y} r={11} />
            <circle className="pg-chart__dot" cx={p.x} cy={p.y} r={p.onHull ? 4.5 : 3} />
            {p.key === selectedKey && <circle className="pg-chart__ring" cx={p.x} cy={p.y} r={9} />}
          </g>
        ))}
      </svg>
    </div>
  )
}
