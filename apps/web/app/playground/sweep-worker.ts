import { deltaE, ssim } from '@cupel/core'
import type { Encoder } from '@cupel/core'
import { wasmCodec } from '@cupel/codecs-wasm'
import { toCandidatePoint } from '../../lib/playground/assemble'
import { MAX_REFERENCE_EDGE, prepareReference, sniffContainer } from '../../lib/playground/ingest'
import { SWEEP_FORMATS, buildSweepPlan, type FormatCapabilities, type SweepFormat } from '../../lib/playground/plan'
import type { SweepRequest, SweepResponse } from '../../lib/playground/worker-protocol'

/**
 * The sweep worker. Everything heavy lives here, off the main thread:
 * decode, flatten, downscale, every encode, every decode-back, and every
 * measurement. The page stays responsive and the curve fills in live as
 * point messages stream out.
 *
 * The wasm modules load through each @jsquash package's own bundler path
 * (webpack resolves the .wasm assets referenced with import.meta.url), so
 * no module injection is needed here.
 */

function post(message: SweepResponse, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ? { transfer } : undefined)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function runSweep(request: SweepRequest): Promise<void> {
  const started = performance.now()
  const bytes = new Uint8Array(request.bytes)

  const container = sniffContainer(bytes)
  if (!container) {
    post({
      type: 'refusal',
      message:
        'This file is not a jpeg, png, webp, or avif, so the codecs here cannot decode it. ' +
        'Nothing was measured.',
    })
    return
  }

  let decoded
  try {
    decoded = await wasmCodec(container).decode(bytes)
  } catch (err) {
    post({
      type: 'refusal',
      message: `The ${container} decoder rejected this file (${messageOf(err)}). Nothing was measured.`,
    })
    return
  }

  const { reference, flattened, downscaled } = prepareReference(decoded, MAX_REFERENCE_EDGE)

  const capabilities = {} as Record<SweepFormat, FormatCapabilities>
  const encoders = {} as Record<SweepFormat, Encoder>
  for (const format of SWEEP_FORMATS) {
    encoders[format] = wasmCodec(format)
    capabilities[format] = encoders[format].capabilities
  }
  const plan = buildSweepPlan(capabilities)

  // The keep-original anchor is honest only when the reference IS the
  // decoded file: once the pixels were flattened or downscaled, the
  // original's byte count no longer buys the same image.
  const includeOriginal = !flattened && !downscaled

  post({
    type: 'decoded',
    container,
    source: { width: decoded.width, height: decoded.height, bytes: bytes.length },
    reference: { width: reference.width, height: reference.height },
    flattened,
    downscaled,
    totalSteps: plan.length + (includeOriginal ? 1 : 0),
  })

  let index = 0

  if (includeOriginal) {
    // The reference is the decode of these exact bytes, so structure is 1,
    // drift is 0, and distortion is 0 by construction; re-measuring would
    // only burn time to confirm an identity.
    post({
      type: 'point',
      index,
      label: `${container} source`,
      point: toCandidatePoint({
        format: 'keep-original',
        quality: null,
        bytes: bytes.length,
        ssim: 1,
        deltaE: 0,
        encoder: 'source file, kept as-is',
      }),
      encodeMs: 0,
      encoded: null,
    })
    index++
  }

  for (const step of plan) {
    try {
      const encoder = encoders[step.format]
      const t0 = performance.now()
      const encoded = await encoder.encode(
        reference,
        step.lossless ? { lossless: true } : { quality: step.quality ?? undefined },
      )
      const encodeMs = performance.now() - t0
      const roundtrip = await encoder.decode(encoded)
      const point = toCandidatePoint({
        format: step.format,
        quality: step.lossless ? null : step.quality,
        bytes: encoded.length,
        ssim: ssim(reference, roundtrip),
        deltaE: deltaE(reference, roundtrip).mean,
        encoder: `${encoder.id}@${await encoder.version()}`,
      })
      post(
        { type: 'point', index, label: step.label, point, encodeMs, encoded: encoded.buffer as ArrayBuffer },
        [encoded.buffer as ArrayBuffer],
      )
    } catch (err) {
      post({ type: 'step-error', index, label: step.label, message: messageOf(err) })
    }
    index++
  }

  post({ type: 'done', elapsedMs: performance.now() - started })
}

self.onmessage = (event: MessageEvent) => {
  const request = event.data as SweepRequest
  if (request?.type !== 'sweep') return
  runSweep(request).catch((err: unknown) => {
    post({ type: 'refusal', message: `The sweep stopped unexpectedly: ${messageOf(err)}` })
  })
}
