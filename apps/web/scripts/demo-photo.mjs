// Puts real photographs into the landing page demo.
//
// The demo prefers a photograph over its drawn fallback, but a photograph with
// no recorded provenance is not something this repo ships, so this script does
// both halves at once: it writes each image at exactly the size the demo wants,
// and it writes the licence and source next to it. A test fails if an image ever
// appears in public/demo without its credits.json entry.
//
// Two ways to run it, from apps/web:
//
//   pnpm demo:photos
//     Pulls every candidate in scripts/demo-photos.json and fills both slots.
//     Which photograph lands in which slot is decided by measuring them, not by
//     the order they are listed in: see busyness and fillFromList below.
//
//   pnpm demo:photo <hero|busy> <file-or-url> --license "..." --source <url>
//     Fills one slot from a local file or a direct image URL. Use this to
//     override a choice, or when the photograph is not in the list.
//
// --credit is optional and names the photographer when it is known. --license
// and --source are required, the same two fields the corpus manifest requires
// of every image in packages/corpus.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = `${WEB_ROOT}public/demo`
const CREDITS = `${OUT_DIR}/credits.json`
const DEFAULT_LIST = `${WEB_ROOT}scripts/demo-photos.json`

// Must match SOURCE_WIDTH and SOURCE_HEIGHT in lib/demo/sources.ts. The demo
// runs five encodes on this in a browser tab, so the size is a deliberate
// ceiling and not a preference.
const WIDTH = 960
const HEIGHT = 640

/**
 * The two slots, and what each one is for. Order matters here: fillFromList
 * works down this list from the busiest candidate, because the PNG lesson is the
 * one that depends on the picture being dense.
 *
 * The names describe the job, not the picture. lib/demo/sources.ts says what
 * each slot needs to show.
 */
const SLOTS = [
  { name: 'busy', wants: 'the busiest picture, which becomes the huge PNG' },
  { name: 'hero', wants: 'an ordinary photograph with texture in it' },
]

function fail(message) {
  console.error(`demo:photo: ${message}`)
  process.exit(1)
}

function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`
}

async function readInput(input) {
  if (!/^https?:\/\//.test(input)) return readFile(input)
  const response = await fetch(input)
  if (!response.ok) fail(`${input} answered ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) {
    fail(`${input} returned ${type || 'no content type'}, not an image`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/** Resizes to the demo size. Refuses to enlarge: see the message. */
async function prepare(source, label) {
  const meta = await sharp(source).metadata()
  if ((meta.width ?? 0) < WIDTH || (meta.height ?? 0) < HEIGHT) {
    fail(
      `${label} is ${meta.width}x${meta.height}, smaller than the ${WIDTH}x${HEIGHT} the demo ` +
        'needs. Enlarging it would mean the demo measures an enlargement, so pick a bigger one.',
    )
  }
  return sharp(source).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
}

/**
 * How much detail a picture carries, measured as the size of it stored
 * losslessly. This is not a proxy for the real thing: it is exactly what the
 * "your PNG is a photograph" sample depends on, so ranking candidates by it
 * puts the right picture in the right slot without anyone having to eyeball it.
 */
async function busyness(pipeline) {
  const png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer()
  return png.length
}

async function writeSlot(name, pipeline, provenance) {
  // Quality 92 lossy webp: small enough to ship and to fetch, and well above
  // the point where this encode would be what the demo measures.
  const out = await pipeline.clone().webp({ quality: 92 }).toBuffer()
  const file = `${name}.webp`
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(`${OUT_DIR}/${file}`, out)
  await recordCredit({ file, ...provenance })
  console.log(`  ${file}  ${WIDTH}x${HEIGHT}  ${kb(out.length)}  ${provenance.license}`)
}

async function recordCredit(entry) {
  let credits = { v: 1, entries: [] }
  try {
    const parsed = JSON.parse(await readFile(CREDITS, 'utf8'))
    if (Array.isArray(parsed?.entries)) credits = parsed
  } catch {
    // No credits file yet, which is the normal state before the first run.
  }
  credits.entries = [...credits.entries.filter((e) => e.file !== entry.file), entry].sort((a, b) =>
    a.file.localeCompare(b.file),
  )
  await writeFile(CREDITS, `${JSON.stringify(credits, null, 2)}\n`)
}

/** Fills both slots from the candidate list, busiest picture first. */
async function fillFromList(listPath) {
  const list = JSON.parse(await readFile(listPath, 'utf8'))
  const candidates = list?.candidates ?? []
  if (candidates.length < SLOTS.length) {
    fail(`${listPath} has ${candidates.length} candidates and the demo needs ${SLOTS.length}`)
  }

  console.log(`measuring ${candidates.length} candidates from ${listPath}`)
  const measured = []
  for (const candidate of candidates) {
    if (!candidate.license || !candidate.source) {
      fail(`every candidate needs a license and a source: ${candidate.url ?? '(no url)'}`)
    }
    const bytes = await readInput(candidate.url)
    const pipeline = await prepare(bytes, candidate.url)
    const detail = await busyness(pipeline)
    console.log(`  ${kb(detail)} stored losslessly  ${candidate.url.slice(0, 72)}`)
    measured.push({ candidate, pipeline, detail })
  }

  measured.sort((a, b) => b.detail - a.detail)
  console.log('\nassigning slots, busiest first')
  for (const [i, slot] of SLOTS.entries()) {
    const pick = measured[i]
    console.log(`${slot.name}: ${slot.wants}`)
    await writeSlot(slot.name, pick.pipeline, {
      license: pick.candidate.license,
      source: pick.candidate.source,
      ...(pick.candidate.credit ? { credit: pick.candidate.credit } : {}),
    })
  }

  for (const spare of measured.slice(SLOTS.length)) {
    console.log(`unused: ${spare.candidate.url.slice(0, 72)}`)
  }
}

/** Fills one named slot from a file or a URL. */
async function fillOne(argv) {
  const [name, input, ...rest] = argv
  if (!SLOTS.some((slot) => slot.name === name)) {
    fail(`unknown picture "${name}", expected one of ${SLOTS.map((s) => s.name).join(', ')}`)
  }
  if (!input) fail('usage: demo:photo <hero|busy> <file-or-url> --license ... --source ...')

  const flags = { license: 'Unsplash License' }
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    const value = rest[i + 1]
    if (!key?.startsWith('--') || value === undefined) fail(`could not read the flag near "${key}"`)
    flags[key.slice(2)] = value
  }
  if (!flags.source) fail('--source is required: where the photograph came from')

  const pipeline = await prepare(await readInput(input), input)
  console.log(`${name}:`)
  await writeSlot(name, pipeline, {
    license: flags.license,
    source: flags.source,
    ...(flags.credit ? { credit: flags.credit } : {}),
  })
}

const argv = process.argv.slice(2)
const listFlag = argv.indexOf('--list')
if (argv.length === 0 || argv[0] === '--all' || listFlag === 0) {
  await fillFromList(listFlag === -1 ? DEFAULT_LIST : argv[listFlag + 1])
} else {
  await fillOne(argv)
}

console.log('\ncommit the images together with public/demo/credits.json.')
console.log('then run `pnpm test`: it checks the three promises the page makes about these.')
