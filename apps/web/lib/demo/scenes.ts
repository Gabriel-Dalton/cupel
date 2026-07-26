import type { RawImage } from '@cupel/core'
import { clampByte, mulberry32, smoothstep, valueNoise2d } from '../noise'

/**
 * The fallback pictures for the landing page demo, drawn with arithmetic.
 *
 * A real photograph is the better teacher and the demo prefers one whenever a
 * file is present under public/demo (see sources.ts). These scenes exist for
 * the case where none is: they can be built with the exact properties the demo
 * needs (enough fine detail that a quality ladder produces a real curve, a
 * 1/f-ish spectrum so the resolution check does not read them as enlarged) and
 * they raise no question about whose photograph is on the front page.
 *
 * They are not pretending to be camera output, and the page does not claim they
 * are: the picker says "drawn, not photographed" when it is showing these.
 */

export type SceneName = 'coast' | 'garden'

/*
 * 960x640 rather than the 720x480 this started at. The compare frame on the
 * landing page is wider than 720 CSS pixels on a laptop, so the old scenes were
 * being blown up by about a third, and an upscaled image looks exactly like a
 * badly compressed one. The frame is also capped at this width now (demo.css),
 * so the two changes together mean the preview is never enlarged.
 *
 * Cost: 1.8 times the pixels, so 1.8 times the encode time in the tab. That is
 * the trade being made deliberately, because "the demo looks blurry" undermines
 * a tool whose entire claim is about image quality.
 */
export const SCENE_WIDTH = 960
export const SCENE_HEIGHT = 640

const WIDTH = SCENE_WIDTH
const HEIGHT = SCENE_HEIGHT

/**
 * Everything below was tuned in pixels at 720 wide. Scaling those constants
 * keeps the composition identical instead of leaving the sun the size of a pea
 * and the noise cells reading as sand.
 */
const S = WIDTH / 720

/** Rounds a tuned pixel constant into the current scene size. */
function px(atSevenTwenty: number): number {
  return atSevenTwenty * S
}

/**
 * Warm coastline at low sun: a vertical sky gradient, a sun with falloff,
 * water with horizontal chop, two headland silhouettes, and sensor grain.
 * The chop and the grain are what give the high frequency content a photo
 * has; without them the spectral resolution check reads the image as soft.
 */
function coast(): RawImage {
  const rng = mulberry32(0xc0a57)
  const cloud = valueNoise2d(WIDTH, HEIGHT, px(96), rng)
  const cloudFine = valueNoise2d(WIDTH, HEIGHT, px(34), rng)
  // Chop is coarse rather than fine. A small cell size here produced blobs
  // about seven pixels across, which read as rows of blurry text rather than
  // as water.
  const chop = valueNoise2d(WIDTH, HEIGHT, px(26), rng)
  const glitter = valueNoise2d(WIDTH, HEIGHT, px(3), rng)

  const horizon = Math.round(HEIGHT * 0.62)
  const sunX = WIDTH * 0.62
  const sunY = horizon - px(34)
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)

  /**
   * The headland silhouette, as one continuous ridge line rather than a pair
   * of gated shapes. The base sits below the water line, so no land is drawn
   * across the middle of the frame; the two Gaussian bumps lift it above the
   * horizon at the left and right edges. Gating on x instead would put a hard
   * vertical seam wherever the gate flipped.
   */
  function ridgeAt(x: number): number {
    return (
      horizon +
      px(52) -
      px(96) * Math.exp(-Math.pow((x - WIDTH * 0.07) / px(145), 2)) -
      px(64) * Math.exp(-Math.pow((x - WIDTH * 0.97) / px(105), 2))
    )
  }

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x
      let r: number
      let g: number
      let b: number

      const dx = x - sunX
      const dy = (y - sunY) * 1.2
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (y < horizon) {
        // Sky: deep blue overhead easing into warm haze at the water line.
        const t = smoothstep(0, horizon, y)
        r = 74 + 168 * Math.pow(t, 1.7)
        g = 104 + 118 * Math.pow(t, 2)
        b = 156 + 30 * Math.pow(t, 3)
        // Cloud banding, strongest high up where the sky is darkest.
        const c = ((cloud[i] ?? 0) - 0.5) * 40 + ((cloudFine[i] ?? 0) - 0.5) * 14
        const cloudMix = 1 - 0.6 * t
        r += c * cloudMix
        g += c * 0.85 * cloudMix
        b += c * 0.55 * cloudMix
      } else {
        // Water: a shade darker than the sky it reflects, with a bright
        // column under the sun and slow chop that tightens toward the
        // horizon. The chop stays low frequency on purpose; a high
        // frequency ripple reads as scan lines rather than water.
        const t = smoothstep(horizon, HEIGHT, y)
        r = 54 + 52 * (1 - t)
        g = 78 + 54 * (1 - t)
        b = 112 + 46 * (1 - t)
        const swell = Math.sin(((y - horizon) * (0.09 + 0.04 * t)) / S + (x * 0.003) / S) * 6
        const detail = ((chop[i] ?? 0) - 0.5) * (13 - 6 * t)
        const column = Math.exp(-Math.pow((x - sunX) / px(54 + 165 * t), 2))
        const sparkle = Math.pow(Math.max(0, (glitter[i] ?? 0) - 0.7), 2) * 210 * column
        r += swell + detail + column * 116 + sparkle
        g += swell + detail * 0.9 + column * 90 + sparkle * 0.95
        b += swell * 0.7 + detail * 0.7 + column * 44 + sparkle * 0.8
      }

      // The sun and its glow, over both sky and water.
      const disc = 1 - smoothstep(px(19), px(24), dist)
      const glow = Math.exp(-dist / px(105)) * 0.9
      r += disc * 150 + glow * 112
      g += disc * 118 + glow * 68
      b += disc * 54 + glow * 22

      // Headland: everything below the ridge line and above the water line.
      const ridge = ridgeAt(x)
      const land =
        smoothstep(ridge - px(1.5), ridge + px(2.5), y) *
        (1 - smoothstep(horizon - px(1), horizon + px(1), y))
      if (land > 0.01) {
        // Not pure black: a silhouette at dusk still carries some sky light,
        // and a flat black mass would be trivially compressible in a way no
        // real photograph is.
        const shade = 0.2 + 0.12 * (cloudFine[i] ?? 0)
        r = r * (1 - land) + r * shade * land
        g = g * (1 - land) + g * shade * land
        b = b * (1 - land) + b * shade * land
      }

      // A little sensor grain, kept low on purpose. Uncorrelated noise is
      // incompressible, so a heavy grain field would stop this scene behaving
      // like a photograph under a quality ladder: every encode would score
      // badly and the demo would teach the wrong lesson.
      const grain = (rng() - 0.5) * 2.5
      const o = i * 4
      data[o] = clampByte(r + grain)
      data[o + 1] = clampByte(g + grain)
      data[o + 2] = clampByte(b + grain)
      data[o + 3] = 255
    }
  }
  return { width: WIDTH, height: HEIGHT, data }
}

/**
 * Dense green foliage with dappled light. Busy, high frequency, and heavily
 * textured, which is the worst case for a lossless container: this is the
 * scene that makes the "your PNG is a photograph" lesson land, because PNG
 * has to store every leaf exactly.
 */
function garden(): RawImage {
  const rng = mulberry32(0x9a2de4)
  const canopy = valueNoise2d(WIDTH, HEIGHT, px(110), rng)
  const clump = valueNoise2d(WIDTH, HEIGHT, px(42), rng)
  const leaf = valueNoise2d(WIDTH, HEIGHT, px(14), rng)
  const veins = valueNoise2d(WIDTH, HEIGHT, px(5), rng)
  const light = valueNoise2d(WIDTH, HEIGHT, px(72), rng)
  const bloom = valueNoise2d(WIDTH, HEIGHT, px(22), rng)
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x
      // Depth: the top of the frame is shaded canopy, the bottom is lit.
      const depth = smoothstep(0, HEIGHT, y)
      const shade = 0.5 + 0.42 * depth

      /*
       * Leaves need edges. Raw value noise is a soft cloud and reads as a
       * green blur, so both noise fields are pushed through a contrast curve
       * to turn them into overlapping blobs with defined boundaries. Those
       * boundaries are coherent structure, which is what a photograph of
       * foliage actually contains and what survives a quality ladder.
       */
      const leafMask = smoothstep(0.36, 0.62, leaf[i] ?? 0)
      const clumpMask = smoothstep(0.3, 0.68, clump[i] ?? 0)
      const canopyMass = canopy[i] ?? 0

      // Dappled sunlight: hard bright patches where the light field peaks.
      const sun = Math.pow(smoothstep(0.5, 0.86, light[i] ?? 0), 1.4)

      const lit = 0.22 * canopyMass + 0.3 * clumpMask + 0.48 * leafMask
      let g = (46 + 138 * lit) * shade + sun * 92
      let r = (26 + 96 * lit) * shade + sun * 112
      let b = (22 + 62 * lit) * shade + sun * 62

      // The fine vein field is nearly noise, so it stays small: it adds
      // texture without adding bytes the encoder cannot throw away.
      const vein = ((veins[i] ?? 0) - 0.5) * 11
      r += vein * 0.7
      g += vein
      b += vein * 0.4

      // A few warm blooms so the frame is not entirely green, which also
      // gives the colour measurement something it can lose. Kept sparse and
      // soft: at higher amplitude they read as lens flare rather than petals.
      const flower = Math.pow(smoothstep(0.79, 0.95, bloom[i] ?? 0), 1.8)
      r += flower * 128
      g += flower * 38
      b += flower * 66

      const grain = (rng() - 0.5) * 3
      const o = i * 4
      data[o] = clampByte(r + grain)
      data[o + 1] = clampByte(g + grain)
      data[o + 2] = clampByte(b + grain)
      data[o + 3] = 255
    }
  }
  return { width: WIDTH, height: HEIGHT, data }
}

export function buildScene(name: SceneName): RawImage {
  return name === 'coast' ? coast() : garden()
}
