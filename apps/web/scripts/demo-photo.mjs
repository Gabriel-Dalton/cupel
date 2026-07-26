// Puts a real photograph into the landing page demo.
//
// The demo prefers a photograph over its drawn fallback, but a photograph with
// no recorded provenance is not something this repo ships, so this script does
// both halves at once: it writes the image at exactly the size the demo wants,
// and it writes the credit next to it. A test fails if an image ever appears in
// public/demo without its credits.json entry.
//
// Usage, from apps/web:
//
//   pnpm demo:photo coast <file-or-url> --credit "Photographer" --source <page-url>
//   pnpm demo:photo garden <file-or-url> --credit "Photographer" --source <page-url>
//
// For Unsplash, open the photo, copy its page URL for --source, and pass either
// the downloaded file or the direct image URL (right click, copy image address)
// as the second argument. --license defaults to the Unsplash License; pass it
// explicitly for anything from elsewhere.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = `${WEB_ROOT}public/demo`
const CREDITS = `${OUT_DIR}/credits.json`

// Must match SOURCE_WIDTH and SOURCE_HEIGHT in lib/demo/sources.ts. The demo
// runs five encodes on this in a browser tab, so the size is a deliberate
// ceiling and not a preference.
const WIDTH = 960
const HEIGHT = 640
const NAMES = ['coast', 'garden']

function fail(message) {
  console.error(`demo:photo: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const [name, input, ...rest] = argv
  if (!name || !input)
    fail('usage: demo:photo <coast|garden> <file-or-url> --credit ... --source ...')
  if (!NAMES.includes(name)) fail(`unknown picture "${name}", expected one of ${NAMES.join(', ')}`)

  const flags = { license: 'Unsplash License' }
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    const value = rest[i + 1]
    if (!key?.startsWith('--') || value === undefined) fail(`could not read the flag near "${key}"`)
    flags[key.slice(2)] = value
  }
  if (!flags.credit) fail('--credit is required: name whoever took the photograph')
  if (!flags.source) fail('--source is required: the page the photograph came from')
  return { name, input, flags }
}

async function readInput(input) {
  if (!/^https?:\/\//.test(input)) return readFile(input)
  const response = await fetch(input)
  if (!response.ok) fail(`${input} answered ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/'))
    fail(`${input} returned ${type || 'no content type'}, not an image`)
  return Buffer.from(await response.arrayBuffer())
}

async function loadCredits() {
  try {
    const parsed = JSON.parse(await readFile(CREDITS, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed : { v: 1, entries: [] }
  } catch {
    return { v: 1, entries: [] }
  }
}

const { name, input, flags } = parseArgs(process.argv.slice(2))
const file = `${name}.webp`
const source = await readInput(input)

const meta = await sharp(source).metadata()
if ((meta.width ?? 0) < WIDTH || (meta.height ?? 0) < HEIGHT) {
  fail(
    `that image is ${meta.width}x${meta.height}, which is smaller than the ${WIDTH}x${HEIGHT} the ` +
      'demo needs. Enlarging it would make the demo measure an enlargement, so pick a bigger one.',
  )
}

// Quality 92 lossy webp: small enough to ship and to fetch, and well above the
// point where the encode itself would be what the demo measures.
const out = await sharp(source)
  .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
  .webp({ quality: 92 })
  .toBuffer()

await mkdir(OUT_DIR, { recursive: true })
await writeFile(`${OUT_DIR}/${file}`, out)

const credits = await loadCredits()
credits.entries = [
  ...credits.entries.filter((entry) => entry.file !== file),
  { file, license: flags.license, credit: flags.credit, source: flags.source },
].sort((a, b) => a.file.localeCompare(b.file))
await writeFile(CREDITS, `${JSON.stringify(credits, null, 2)}\n`)

const kb = (out.length / 1000).toFixed(1)
console.log(`wrote public/demo/${file} (${WIDTH}x${HEIGHT}, ${kb} kB)`)
console.log(`credited to ${flags.credit} under the ${flags.license}`)
console.log('commit both the image and public/demo/credits.json')
