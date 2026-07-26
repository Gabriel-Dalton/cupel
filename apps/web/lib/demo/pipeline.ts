import { analyzeProvenance, decideAsset, deltaE, distortion, ssim } from '@cupel/core'
import type { CandidatePoint, Container, ProvenanceRecord, RawImage } from '@cupel/core'
import { loadSource, type SourceLoader } from './sources'

/**
 * The landing page demo, which is the real pipeline and not a mock up.
 *
 * It runs the same three steps the command line runs, in the reader's own
 * tab: analyzeProvenance to work out how much quality the file has left,
 * a short sweep to measure what each candidate encode actually costs, and
 * decideAsset to choose. Every verdict on the page comes out of
 * @cupel/core, which is why core is platform pure in the first place.
 *
 * Codecs are injected so this module can be exercised in Node tests with the
 * same wasm adapters the browser uses.
 */

export type EncodeFormat = 'jpeg' | 'png' | 'webp'

export type DemoCodecs = {
  encode(format: EncodeFormat, image: RawImage, quality: number | null): Promise<Uint8Array>
  decode(format: EncodeFormat, bytes: Uint8Array): Promise<RawImage>
}

export type SampleKind = 'fresh' | 'squeezed' | 'png'

export type SampleSpec = {
  kind: SampleKind
  /** Shown on the picker button. */
  title: string
  /** One plain sentence about where a file like this comes from. */
  blurb: string
  fileName: string
}

/**
 * The three samples, chosen so that between them they cover every outcome
 * cupel has: it saves a lot, it saves nothing and says so, and it saves an
 * enormous amount because the file was in the wrong format all along.
 *
 * "squeezed" is deliberately the same photograph as "fresh", because the
 * lesson is that two copies of one picture can deserve opposite treatment.
 *
 * File names stay generic because the photographs behind them get swapped
 * (see sources.ts): they describe the file's history, which is the part the
 * reader is meant to notice, and not what the picture shows.
 */
export const SAMPLES: readonly SampleSpec[] = [
  {
    kind: 'fresh',
    title: 'Straight off a camera',
    blurb: 'A full quality photo, the kind you get before anything has touched it.',
    fileName: 'photo-original.jpg',
  },
  {
    kind: 'squeezed',
    title: 'Already squashed by a CMS',
    blurb: 'The same photo, but something in the pipeline already compressed it hard. Twice.',
    fileName: 'photo-from-cms.jpg',
  },
  {
    kind: 'png',
    title: 'A photo saved as PNG',
    blurb: 'Someone exported a photo in a format built for logos and screenshots.',
    fileName: 'photo-as-png.png',
  },
]

/**
 * Quality rungs the demo sweeps. Short on purpose: this runs in a tab, and
 * five encodes is enough to shape the part of the curve the decision uses.
 *
 * The rungs sit high because the demo asks for the strict floor (see
 * ABOVE_FOLD below). A ladder that bottoms out at 40 would waste four encodes
 * on candidates that can never be chosen.
 */
const DEMO_LADDER: readonly number[] = [78, 86, 93, 97]

/**
 * The demo treats every picture as a hero image sitting above the fold, which
 * makes cupel apply its stricter quality floor (0.99 rather than 0.97).
 *
 * This is a deliberate choice and not a thumb on the scale. Landing page
 * photographs genuinely are above the fold, and at the looser floor the
 * engine correctly picks the cheapest point that just clears it, which on a
 * smooth sky means visible banding. Showing that next to the words "you
 * cannot see the difference" would be a false claim. The strict floor is the
 * conservative setting, it costs savings rather than inventing them, and the
 * numbers the page reports are whatever comes out of it.
 */
const ABOVE_FOLD = true

export type SampleFile = {
  bytes: Uint8Array
  container: Container
  /** False when the source was a drawn scene rather than a photograph. */
  photographed: boolean
}

/**
 * Builds the file the reader is meant to imagine finding on their server.
 * The bytes are produced by a real encoder so the quantization tables are
 * real, which is what lets analyzeProvenance say anything at all about the
 * file's history. Faking the file would fake the whole demo.
 *
 * The source picture is loaded rather than assumed, so the same code path runs
 * whether the picture is a committed photograph or the fallback scene. The
 * encodes below are the point: a photograph downloaded from anywhere has been
 * through an encoder already, and re-encoding it here from decoded pixels at a
 * known quality is what gives the "straight off a camera" file an honest
 * history.
 */
export async function buildSampleFile(
  kind: SampleKind,
  codecs: DemoCodecs,
  loader: SourceLoader,
): Promise<SampleFile> {
  if (kind === 'png') {
    const source = await loadSource('busy', loader)
    return {
      bytes: await codecs.encode('png', source.image, null),
      container: 'png',
      photographed: source.photographed,
    }
  }

  const source = await loadSource('hero', loader)
  if (kind === 'fresh') {
    return {
      bytes: await codecs.encode('jpeg', source.image, 94),
      container: 'jpeg',
      photographed: source.photographed,
    }
  }

  // Two generations at low quality, decoding in between, which is exactly
  // what happens when a pipeline re-saves an upload that was already lossy.
  const first = await codecs.encode('jpeg', source.image, 42)
  const second = await codecs.encode('jpeg', await codecs.decode('jpeg', first), 34)
  return { bytes: second, container: 'jpeg', photographed: source.photographed }
}

export type DemoVerdict = 'saved' | 'stopped' | 'kept'

export type DemoResult = {
  verdict: DemoVerdict
  /** Plain language, no jargon: this is what the reader actually reads. */
  headline: string
  detail: string
  source: { container: Container; width: number; height: number; bytes: number }
  quality: {
    /** Estimated quality the file was last saved at, when knowable. */
    estimated: number | null
    /** How many times it has been through a lossy encoder, when knowable. */
    generations: number | null
    /** 'plenty' | 'a little' | 'none', in plain words. */
    left: string
  }
  output: {
    format: EncodeFormat
    quality: number | null
    bytes: number
    savedFraction: number
    /** 0..1 structural similarity against the original. */
    similarity: number
  } | null
  /** The technical reason string from core, for readers who want it. */
  technicalReason: string
  candidatesMeasured: number
  /** The chosen encode's real bytes, for the before and after preview. */
  outputBytes: Uint8Array | null
}

function qualityLeft(record: ProvenanceRecord): string {
  switch (record.headroom) {
    case 'normal':
      return 'plenty'
    case 'low':
      return 'a little'
    default:
      return 'none'
  }
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/**
 * Measures one candidate encode the honest way: encode it, decode what was
 * encoded, and compare that against the original. The numbers describe the
 * file a browser would actually receive, not an in-memory approximation.
 */
async function measure(
  reference: RawImage,
  format: EncodeFormat,
  quality: number | null,
  codecs: DemoCodecs,
): Promise<{ point: CandidatePoint; bytes: Uint8Array } | null> {
  try {
    const encoded = await codecs.encode(format, reference, quality)
    const decoded = await codecs.decode(format, encoded)
    if (decoded.width !== reference.width || decoded.height !== reference.height) return null
    const s = ssim(reference, decoded)
    const e = deltaE(reference, decoded).mean
    return {
      point: {
        format,
        quality,
        bytes: encoded.length,
        ssim: s,
        deltaE: e,
        distortion: distortion(s, e),
        encoder: `wasm/${format}`,
      },
      bytes: encoded,
    }
  } catch {
    return null
  }
}

export type ProgressFn = (done: number, total: number) => void

/**
 * The whole demo for one file: understand it, then decide about it.
 *
 * The refusal path short circuits before the sweep, which is not an
 * optimization for the demo's sake. It is the actual behaviour: a file with
 * nothing left to give never gets encoded even once, so refusing costs
 * nothing.
 */
export async function runDemo(
  file: { bytes: Uint8Array; container: Container },
  codecs: DemoCodecs,
  onProgress?: ProgressFn,
): Promise<DemoResult> {
  const decodable: EncodeFormat[] = ['jpeg', 'png', 'webp']
  if (!decodable.includes(file.container as EncodeFormat)) {
    throw new Error(`this demo reads jpeg, png, and webp; that file is ${file.container}`)
  }

  const image = await codecs.decode(file.container as EncodeFormat, file.bytes)
  const provenance = analyzeProvenance({
    container: file.container,
    image,
    bytes: file.bytes,
  })

  const source = {
    container: file.container,
    width: image.width,
    height: image.height,
    bytes: file.bytes.length,
  }
  const quality = {
    estimated: provenance.estimatedOriginalQuality,
    generations: provenance.generations,
    left: qualityLeft(provenance),
  }

  // Ask for the verdict with no candidates first. If the answer is already
  // "refused", the file has no quality left and nothing gets encoded.
  const preflight = decideAsset(provenance, [])
  if (preflight.decision === 'refused') {
    return {
      verdict: 'stopped',
      headline: 'cupel stopped, and left the file alone',
      detail:
        'This picture has already been compressed about as far as it can go. Squeezing it again ' +
        'would make it look worse without saving much, so cupel will not do it. The fix is to ' +
        'find a better original, not to compress harder.',
      source,
      quality,
      output: null,
      technicalReason: preflight.reason,
      candidatesMeasured: 0,
      outputBytes: null,
    }
  }

  const plan: { format: EncodeFormat; quality: number | null }[] = [
    ...DEMO_LADDER.map((q) => ({ format: 'webp' as EncodeFormat, quality: q })),
    // One jpeg rung so the sweep is genuinely comparing formats rather than
    // only walking webp's quality knob.
    { format: 'jpeg' as EncodeFormat, quality: 90 },
  ]

  const candidates: CandidatePoint[] = [
    {
      format: 'keep-original',
      quality: null,
      bytes: file.bytes.length,
      ssim: 1,
      deltaE: 0,
      distortion: 0,
      encoder: `original ${file.container}`,
    },
  ]
  const encodedByKey = new Map<string, Uint8Array>()

  let done = 0
  for (const step of plan) {
    const measured = await measure(image, step.format, step.quality, codecs)
    done++
    onProgress?.(done, plan.length)
    if (!measured) continue
    candidates.push(measured.point)
    encodedByKey.set(`${step.format}@${step.quality ?? 'lossless'}`, measured.bytes)
  }

  const decision = decideAsset(provenance, candidates, { aboveFold: ABOVE_FOLD })

  if (decision.decision !== 'encoded') {
    return {
      verdict: 'kept',
      headline: 'Already about as small as it safely gets',
      detail:
        'cupel measured every option and none of them were worth the loss in quality, so it kept ' +
        'the file you already have. Nothing to do here, which is a good result.',
      source,
      quality,
      output: null,
      technicalReason: decision.reason,
      candidatesMeasured: candidates.length - 1,
      outputBytes: null,
    }
  }

  const chosen = decision.chosen
  const savedFraction = (file.bytes.length - chosen.bytes) / file.bytes.length
  return {
    verdict: 'saved',
    headline: `${percent(savedFraction)} smaller, and it still looks the same`,
    detail:
      `cupel measured ${candidates.length - 1} different ways to save this picture and picked the ` +
      `smallest one that holds up as a hero image. Drag the slider and see if you can find the ` +
      `difference. The original is on the left.`,
    source,
    quality,
    output: {
      format: chosen.format as EncodeFormat,
      quality: chosen.quality,
      bytes: chosen.bytes,
      savedFraction,
      similarity: chosen.ssim,
    },
    technicalReason: decision.reason,
    candidatesMeasured: candidates.length - 1,
    outputBytes: encodedByKey.get(`${chosen.format}@${chosen.quality ?? 'lossless'}`) ?? null,
  }
}
