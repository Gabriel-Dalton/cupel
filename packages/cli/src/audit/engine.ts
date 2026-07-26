import { relative } from 'node:path'
import {
  FINGERPRINT_REGISTRY,
  estimateJpegQuality,
  identifyEncoder,
  parseJpeg,
  resolveHeadroom,
  selectQuantTables,
} from '@cupel/core'
import type { Container, Headroom } from '@cupel/core'
import { CUPEL_USER_AGENT, crawlPage } from '@cupel/crawl'
import { UnreadableInput, examine } from '../lib/analyze.js'
import { sniffContainer } from '../lib/sniff.js'
import { walkImages } from '../lib/walk.js'
import { estimateRecoverable, type RecoverableEstimate } from './recoverable.js'

/**
 * Read-only triage, BRIEF section 9.2. Two flavours share one output shape:
 *
 * - A local directory decodes every file, so the evidence is complete
 *   (generation counting and blocking scores need pixels) but there are no
 *   display dimensions, because there is no page.
 * - A URL crawls the page for assets and display dimensions, then fetches
 *   only the first 64 KB of each asset. Headers live at the front of a
 *   file, so quality and fingerprint survive; generation counting does not,
 *   and is reported as undetermined rather than guessed.
 *
 * Nothing here writes, encodes, or modifies anything, and every cap that
 * fires is reported in the output rather than silently truncating the run.
 */

/** BRIEF 9.2 caps for the URL flavour. */
export const AUDIT_CAPS = {
  maxAssets: 60,
  bytesPerAsset: 64 * 1024,
  totalBytes: 8 * 1024 * 1024,
  perFetchTimeoutMs: 5_000,
  maxRedirects: 3,
} as const

export type AuditAsset = {
  ref: string
  container: Container | null
  /** Total file size when known; for URLs this is content-length or the range total. */
  fileBytes: number | null
  bytesInspected: number
  declared: { w: number; h: number } | null
  display: { w: number; h: number } | null
  headroom: Headroom | null
  estimatedOriginalQuality: number | null
  encoderFingerprint: string | null
  generations: number | null
  blockingScore: number | null
  upscaled: boolean
  laundered: boolean
  recoverable: RecoverableEstimate
  notes: string[]
}

export type AuditReport = {
  target: string
  mode: 'directory' | 'url'
  pixelsDecoded: boolean
  assets: AuditAsset[]
  totals: {
    assets: number
    bytes: number
    recoverableBytes: number
    refused: number
    generationDamaged: number
    launderedLossless: number
    upscaled: number
  }
  /** Caps that fired, skipped directories, robots refusals. Always printed. */
  truncations: string[]
  notes: string[]
}

/** Mirrors core's LAUNDERED_BLOCKING_SCORE; see audit/recoverable.ts. */
const LAUNDERED_BLOCKING_SCORE = 1 / 3
const LOSSLESS_CONTAINERS: ReadonlySet<Container> = new Set<Container>(['png', 'gif'])

function area(d: { w: number; h: number } | null): number | null {
  return d ? d.w * d.h : null
}

function rollup(
  target: string,
  mode: AuditReport['mode'],
  pixelsDecoded: boolean,
  assets: AuditAsset[],
  truncations: string[],
  notes: string[],
): AuditReport {
  return {
    target,
    mode,
    pixelsDecoded,
    assets,
    totals: {
      assets: assets.length,
      bytes: assets.reduce((sum, a) => sum + (a.fileBytes ?? a.bytesInspected), 0),
      recoverableBytes: assets.reduce((sum, a) => sum + a.recoverable.bytes, 0),
      refused: assets.filter((a) => a.headroom === 'none').length,
      generationDamaged: assets.filter((a) => a.generations !== null && a.generations >= 2).length,
      launderedLossless: assets.filter((a) => a.laundered).length,
      upscaled: assets.filter((a) => a.upscaled).length,
    },
    truncations,
    notes,
  }
}

/** Directory flavour: full pixel evidence, no display dimensions. */
export async function auditDirectory(root: string): Promise<AuditReport> {
  const { files, skipped } = await walkImages(root)
  const assets: AuditAsset[] = []
  const notes: string[] = [
    'local directory: every file was decoded, so generation counts and blocking scores are real measurements',
    'no page context, so display dimensions and therefore oversize waste cannot be assessed here; audit the URL for that',
  ]
  const truncations = skipped.map((entry) => `skipped ${entry}`)

  for (const file of files) {
    const ref = relative(root, file) || file
    try {
      const examined = await examine(file)
      const p = examined.provenance
      const laundered =
        p !== null &&
        LOSSLESS_CONTAINERS.has(examined.container) &&
        p.blockingScore >= LAUNDERED_BLOCKING_SCORE
      assets.push({
        ref,
        container: examined.container,
        fileBytes: examined.bytes.length,
        bytesInspected: examined.bytes.length,
        declared: p?.declaredResolution ?? null,
        display: null,
        headroom: p?.headroom ?? null,
        estimatedOriginalQuality: p?.estimatedOriginalQuality ?? null,
        encoderFingerprint: p?.encoderFingerprint ?? null,
        generations: p?.generations ?? null,
        blockingScore: p?.blockingScore ?? null,
        upscaled: p?.upscaled ?? false,
        laundered,
        recoverable: estimateRecoverable({
          container: examined.container,
          fileBytes: examined.bytes.length,
          headroom: p?.headroom ?? null,
          estimatedOriginalQuality: p?.estimatedOriginalQuality ?? null,
          blockingScore: p?.blockingScore ?? null,
          declaredArea: area(p?.declaredResolution ?? null),
          displayArea: null,
        }),
        notes: examined.note === null ? [] : [examined.note],
      })
    } catch (err) {
      if (!(err instanceof UnreadableInput)) throw err
      truncations.push(`unreadable: ${ref} (${err.message})`)
    }
  }

  return rollup(root, 'directory', true, assets, truncations, notes)
}

const REGISTRY_FAMILIES = FINGERPRINT_REGISTRY.map((entry) => entry.family)

type HeaderEvidence = {
  declared: { w: number; h: number } | null
  estimatedOriginalQuality: number | null
  encoderFingerprint: string | null
  headroom: Headroom | null
  notes: string[]
}

/**
 * Header-only JPEG evidence, the same scoping the hosted probe uses: quality
 * and fingerprint come out of the quantization tables, generations cannot
 * (double quantization analysis needs decoded luma), so headroom rests on
 * the quality evidence alone.
 */
function headerEvidence(container: Container, bytes: Uint8Array): HeaderEvidence {
  if (container !== 'jpeg') {
    return {
      declared: null,
      estimatedOriginalQuality: null,
      encoderFingerprint: null,
      headroom: null,
      notes: [
        `${container} header parsing is not implemented over the network; container identity only`,
      ],
    }
  }
  const info = parseJpeg(bytes)
  if (info === null) {
    return {
      declared: null,
      estimatedOriginalQuality: null,
      encoderFingerprint: null,
      headroom: null,
      notes: ['jpeg magic bytes present but the header did not parse'],
    }
  }
  const notes: string[] = []
  const selected = selectQuantTables(info)
  let quality: number | null = null
  let fingerprint: string | null = null
  if (selected.luma === null) {
    notes.push('no quantization tables in the fetched range')
  } else {
    const estimate = estimateJpegQuality(selected, REGISTRY_FAMILIES)
    if (estimate !== null) quality = estimate.quality
    const match = identifyEncoder(selected)
    if (match !== null) fingerprint = match.name
  }
  const { headroom } = resolveHeadroom({
    container: 'jpeg',
    generations: null,
    estimatedOriginalQuality: quality,
    blockingScore: 0,
  })
  notes.push(
    'pixels not decoded: generation count is undetermined, run cupel audit on a local copy for it',
  )
  return {
    declared:
      info.width !== null && info.height !== null ? { w: info.width, h: info.height } : null,
    estimatedOriginalQuality: quality,
    encoderFingerprint: fingerprint,
    headroom,
    notes,
  }
}

/**
 * The binary fetch the asset pass uses. Injectable so the caps can be tested
 * without a network: every test in this package drives a fake.
 */
export type BinaryFetcher = (url: string, init: RequestInit) => Promise<Response>

/** Ranged binary GET with a hard timeout and byte cap. */
async function fetchHead(
  fetcher: BinaryFetcher,
  url: string,
  cap: number,
  timeoutMs: number,
): Promise<{
  bytes: Uint8Array
  totalBytes: number | null
  truncated: boolean
} | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      headers: {
        'user-agent': CUPEL_USER_AGENT,
        accept: 'image/*,*/*;q=0.5',
        range: `bytes=0-${cap - 1}`,
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok && response.status !== 206) return null
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer.byteLength > cap ? buffer.slice(0, cap) : buffer)
    // A 206 carries the true size in Content-Range; a 200 means the server
    // ignored the range and sent everything, so the body length is the size.
    const contentRange = response.headers.get('content-range')
    const slash = contentRange?.lastIndexOf('/') ?? -1
    const fromRange = slash >= 0 ? Number(contentRange?.slice(slash + 1)) : Number.NaN
    const totalBytes = Number.isFinite(fromRange)
      ? fromRange
      : response.status === 200
        ? buffer.byteLength
        : null
    return { bytes, totalBytes, truncated: totalBytes !== null && totalBytes > bytes.length }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type AuditUrlOptions = {
  /** Page fetch, passed through to the crawler. Defaults to the platform fetch. */
  pageFetcher?: typeof fetch
  /** Asset fetch for the ranged GETs. Defaults to the platform fetch. */
  assetFetcher?: BinaryFetcher
}

/** URL flavour: display dimensions from the crawl, header-only asset evidence. */
export async function auditUrl(target: string, opts: AuditUrlOptions = {}): Promise<AuditReport> {
  const assetFetcher = opts.assetFetcher ?? fetch
  const crawl = await crawlPage(target, { fetcher: opts.pageFetcher ?? fetch })
  const truncations: string[] = [...crawl.notes]
  const notes: string[] = [
    `display dimensions are estimated from a static parse at ${crawl.assumedViewport.width}x${crawl.assumedViewport.height}: responsive and JS-driven layout will defeat it`,
    `only the first ${AUDIT_CAPS.bytesPerAsset / 1024} kB of each asset was fetched, so generation counts are undetermined`,
    'run cupel audit on a local directory, or cupel write --dry-run, for measured numbers',
  ]

  if (crawl.blockedByRobots) {
    return rollup(target, 'url', false, [], truncations, notes)
  }

  const discovered = crawl.assets
  const considered = discovered.slice(0, AUDIT_CAPS.maxAssets)
  if (discovered.length > considered.length) {
    truncations.push(
      `asset cap: ${discovered.length} assets found, first ${AUDIT_CAPS.maxAssets} inspected`,
    )
  }

  const assets: AuditAsset[] = []
  let spent = 0
  for (const asset of considered) {
    if (spent >= AUDIT_CAPS.totalBytes) {
      truncations.push(
        `total byte budget of ${AUDIT_CAPS.totalBytes / (1024 * 1024)} MB reached: ${considered.length - assets.length} asset(s) not inspected`,
      )
      break
    }
    const head = await fetchHead(
      assetFetcher,
      asset.url,
      AUDIT_CAPS.bytesPerAsset,
      AUDIT_CAPS.perFetchTimeoutMs,
    )
    if (head === null) {
      truncations.push(`fetch failed or timed out: ${asset.url}`)
      continue
    }
    spent += head.bytes.length
    const container = sniffContainer(head.bytes)
    const evidence =
      container === null
        ? {
            declared: null,
            estimatedOriginalQuality: null,
            encoderFingerprint: null,
            headroom: null,
            notes: ['bytes match no recognized image container'],
          }
        : headerEvidence(container, head.bytes)

    const declared =
      evidence.declared ??
      (asset.declaredWidth !== undefined && asset.declaredHeight !== undefined
        ? { w: asset.declaredWidth, h: asset.declaredHeight }
        : null)
    const display =
      asset.displayWidthCssPx !== undefined && asset.displayHeightCssPx !== undefined
        ? { w: asset.displayWidthCssPx, h: asset.displayHeightCssPx }
        : null
    const fileBytes = head.totalBytes ?? asset.bytes ?? null

    assets.push({
      ref: asset.url,
      container,
      fileBytes,
      bytesInspected: head.bytes.length,
      declared,
      display,
      headroom: evidence.headroom,
      estimatedOriginalQuality: evidence.estimatedOriginalQuality,
      encoderFingerprint: evidence.encoderFingerprint,
      generations: null,
      blockingScore: null,
      upscaled: false,
      laundered: false,
      recoverable: estimateRecoverable({
        container: container ?? 'jpeg',
        fileBytes: fileBytes ?? head.bytes.length,
        headroom: evidence.headroom,
        estimatedOriginalQuality: evidence.estimatedOriginalQuality,
        blockingScore: null,
        declaredArea: area(declared),
        displayArea: area(display),
      }),
      notes: evidence.notes,
    })
  }

  return rollup(target, 'url', false, assets, truncations, notes)
}
