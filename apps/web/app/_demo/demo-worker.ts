import { wasmCodec } from '@cupel/codecs-wasm'
import type { RawImage } from '@cupel/core'
import {
  SAMPLES,
  buildSampleFile,
  runDemo,
  type DemoCodecs,
  type EncodeFormat,
} from '../../lib/demo/pipeline'
import type { DemoRequest, DemoResponse } from '../../lib/demo/protocol'

/**
 * The demo worker. Everything expensive happens here: drawing the sample
 * photographs, every encode, every decode, and every measurement. The page
 * stays responsive while it runs.
 *
 * The wasm modules load through each @jsquash package's own bundler path
 * (webpack resolves the .wasm assets referenced with import.meta.url), so no
 * module injection is needed here.
 */

function post(message: DemoResponse, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ? { transfer } : undefined)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const codecs: DemoCodecs = {
  encode(format: EncodeFormat, image: RawImage, quality: number | null): Promise<Uint8Array> {
    return wasmCodec(format).encode(image, quality === null ? {} : { quality })
  },
  decode(format: EncodeFormat, bytes: Uint8Array): Promise<RawImage> {
    return wasmCodec(format).decode(bytes)
  },
}

async function buildSamples(): Promise<void> {
  const items: {
    kind: (typeof SAMPLES)[number]['kind']
    container: 'jpeg' | 'png'
    bytes: ArrayBuffer
  }[] = []
  const transfer: Transferable[] = []
  for (const sample of SAMPLES) {
    const file = await buildSampleFile(sample.kind, codecs)
    // Copy into a tightly sized buffer so the transfer moves exactly these
    // bytes and never a larger pooled backing store.
    const copy = new Uint8Array(file.bytes)
    items.push({
      kind: sample.kind,
      container: file.container as 'jpeg' | 'png',
      bytes: copy.buffer as ArrayBuffer,
    })
    transfer.push(copy.buffer as ArrayBuffer)
  }
  post({ type: 'samples', items }, transfer)
}

async function run(request: Extract<DemoRequest, { type: 'run' }>): Promise<void> {
  const started = performance.now()
  const bytes = new Uint8Array(request.bytes)
  const result = await runDemo({ bytes, container: request.container }, codecs, (done, total) => {
    post({ type: 'progress', done, total })
  })

  const { outputBytes, ...rest } = result
  const out = outputBytes === null ? null : (new Uint8Array(outputBytes).buffer as ArrayBuffer)
  post(
    { type: 'result', result: rest, outputBytes: out, elapsedMs: performance.now() - started },
    out ? [out] : undefined,
  )
}

self.onmessage = (event: MessageEvent) => {
  const request = event.data as DemoRequest
  const job =
    request?.type === 'samples' ? buildSamples() : request?.type === 'run' ? run(request) : null
  job?.catch((err: unknown) => {
    post({ type: 'failure', message: messageOf(err) })
  })
}
