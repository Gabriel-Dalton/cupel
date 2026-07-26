import type { RawImage } from '@cupel/core'
import { SCENE_HEIGHT, SCENE_WIDTH, buildScene, type SceneName } from './scenes'

/**
 * Where the demo's two pictures come from.
 *
 * A real photograph is always better here than a drawn one: readers recognise
 * a photograph, and the whole section is asking them to trust their own eyes.
 * So each source names a file under public/demo, and the drawn scene is only
 * the fallback for when that file is not there.
 *
 * Photographs are not committed by default because they are binary and because
 * an image with no recorded provenance is not something this repo ships (the
 * corpus manifest enforces the same rule in packages/corpus). Run
 * `pnpm demo:photo` to add one: it resizes, encodes, and records the credit in
 * public/demo/credits.json, and a test fails if a photo file ever appears
 * without its entry.
 */

/**
 * Slots are named for the job the picture does, not for what is in it. The
 * photographs get swapped, and a file called coast.webp with a photograph of
 * Venice in it is the kind of small lie that outlives whoever wrote it.
 */
export type SourceName = 'hero' | 'busy'

export type DemoSource = {
  name: SourceName
  /** Path under public/, so the browser fetches it from the site's own origin. */
  file: string
  /** What the picture has to show for the demo to teach anything. */
  needs: string
  /** The drawn scene used when no photograph is committed for this slot. */
  fallbackScene: SceneName
}

/** Every source photograph is resized to exactly this, then encoded to webp. */
export const SOURCE_WIDTH = SCENE_WIDTH
export const SOURCE_HEIGHT = SCENE_HEIGHT

export const DEMO_SOURCES: readonly DemoSource[] = [
  {
    name: 'hero',
    file: 'demo/hero.webp',
    needs:
      'An ordinary full quality photograph with real texture in it: a landscape, a street, a ' +
      'room. Smooth gradients like an empty sky are the one thing to avoid, because a photo that ' +
      'is nearly all sky compresses so well that the demo stops being representative.',
    fallbackScene: 'coast',
  },
  {
    name: 'busy',
    file: 'demo/busy.webp',
    needs:
      'Something visually busy: foliage, a city at dusk, a market stall, gravel. This is the ' +
      'picture that gets exported as a PNG, and dense detail is what makes a lossless container ' +
      'enormous.',
    fallbackScene: 'garden',
  },
]

export function demoSource(name: SourceName): DemoSource {
  const found = DEMO_SOURCES.find((source) => source.name === name)
  if (!found) throw new Error(`no demo source named ${name}`)
  return found
}

/**
 * A picture the demo can run on, and whether it is a photograph.
 *
 * The flag reaches the page copy: telling a reader "this is a photo" when it
 * is arithmetic would be exactly the kind of small lie this project exists to
 * not tell.
 */
export type LoadedSource = { image: RawImage; photographed: boolean }

export type SourceLoader = {
  /** Resolves to the encoded file, or null when it is not present. */
  readPhoto(source: DemoSource): Promise<Uint8Array | null>
  decodeWebp(bytes: Uint8Array): Promise<RawImage>
}

/**
 * Loads a source photograph, falling back to the drawn scene.
 *
 * A file that is present but unreadable is a real failure and throws: silently
 * showing a drawing in place of a photograph somebody committed would hide the
 * problem, and the demo says which of the two it is showing.
 */
export async function loadSource(name: SourceName, loader: SourceLoader): Promise<LoadedSource> {
  const source = demoSource(name)
  const bytes = await loader.readPhoto(source)
  if (!bytes) return { image: buildScene(source.fallbackScene), photographed: false }
  const image = await loader.decodeWebp(bytes)
  return { image, photographed: true }
}
