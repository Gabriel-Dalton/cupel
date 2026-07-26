/**
 * Plain text output helpers. No color dependency and no box drawing: the
 * output is meant to survive a pipe, a CI log, and a copy into an issue.
 */

/** Byte counts in the units a human reads, with the exact number kept nearby. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/** Renders a value that may legitimately be unknown. */
export function orUnknown(value: number | string | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return 'undetermined'
  return `${value}${suffix}`
}

export function dims(d: { w: number; h: number } | null | undefined): string {
  return d ? `${d.w}x${d.h}` : 'undetermined'
}

/**
 * Left-aligned columns padded to the widest cell, one space of gutter
 * doubled to two so ragged data still reads as a table.
 */
export function table(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const widths: number[] = []
  for (let c = 0; c < width; c++) {
    widths.push(Math.max(...rows.map((r) => (r[c] ?? '').length)))
  }
  return rows
    .map((row) =>
      row
        .map((cell, c) => (c === row.length - 1 ? cell : cell.padEnd(widths[c] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

/** A section heading in the assay voice, underlined so it survives plain text. */
export function heading(text: string): string {
  return `${text}\n${'-'.repeat(text.length)}`
}

export function indentList(items: readonly string[], prefix = '  '): string {
  return items.map((item) => `${prefix}${item}`).join('\n')
}
