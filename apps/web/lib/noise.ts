/**
 * Deterministic noise, shared by the landing page's build time specimens
 * (lib/specimen.ts) and the browser demo's sample photographs
 * (lib/demo/scenes.ts).
 *
 * Platform pure on purpose: a seeded PRNG and plain IEEE754 arithmetic, no
 * canvas, no I/O, no binary fixtures. The same call produces the same pixels
 * in Node, in a browser tab, and in a test.
 */

/** mulberry32, the same tiny seeded PRNG the core test suite uses. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Value noise at one octave: a coarse seeded lattice, bilinearly
 * interpolated. Summing octaves gives an approximately 1/f spectrum, which is
 * what natural photographs have and what effectiveResolution expects a
 * "native" image to look like.
 */
export function valueNoise(size: number, cell: number, rng: () => number): Float64Array {
  const grid = Math.ceil(size / cell) + 1
  const lattice = new Float64Array(grid * grid)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng()
  const out = new Float64Array(size * size)
  for (let y = 0; y < size; y++) {
    const gy = y / cell
    const y0 = Math.floor(gy)
    const fy = gy - y0
    for (let x = 0; x < size; x++) {
      const gx = x / cell
      const x0 = Math.floor(gx)
      const fx = gx - x0
      const a = lattice[y0 * grid + x0] ?? 0
      const b = lattice[y0 * grid + x0 + 1] ?? 0
      const c = lattice[(y0 + 1) * grid + x0] ?? 0
      const d = lattice[(y0 + 1) * grid + x0 + 1] ?? 0
      const top = a + (b - a) * fx
      const bottom = c + (d - c) * fx
      out[y * size + x] = top + (bottom - top) * fy
    }
  }
  return out
}

/**
 * Value noise on a rectangular field. Same lattice interpolation as
 * valueNoise, which is square only because the specimen set it was written
 * for is square.
 */
export function valueNoise2d(
  width: number,
  height: number,
  cell: number,
  rng: () => number,
): Float64Array {
  const gw = Math.ceil(width / cell) + 2
  const gh = Math.ceil(height / cell) + 2
  const lattice = new Float64Array(gw * gh)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng()
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    const gy = y / cell
    const y0 = Math.floor(gy)
    const fy = gy - y0
    for (let x = 0; x < width; x++) {
      const gx = x / cell
      const x0 = Math.floor(gx)
      const fx = gx - x0
      const a = lattice[y0 * gw + x0] ?? 0
      const b = lattice[y0 * gw + x0 + 1] ?? 0
      const c = lattice[(y0 + 1) * gw + x0] ?? 0
      const d = lattice[(y0 + 1) * gw + x0 + 1] ?? 0
      const top = a + (b - a) * fx
      const bottom = c + (d - c) * fx
      out[y * width + x] = top + (bottom - top) * fy
    }
  }
  return out
}

export function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/** Smooth 0..1 ramp, used for horizons and soft edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
