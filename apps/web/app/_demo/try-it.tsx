'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Container } from '@cupel/core'
import { SAMPLES, type DemoResult, type SampleKind } from '../../lib/demo/pipeline'
import type { DemoRequest, DemoResponse } from '../../lib/demo/protocol'
import { formatBytes } from '../../lib/playground/format'
import { sniffContainer } from '../../lib/playground/ingest'

/**
 * The landing page demo. A reader picks one of three sample photographs, or
 * drops in their own, and watches the real pipeline decide what to do with
 * it: measure how much quality is left, try a handful of encodes, then either
 * save bytes or stop.
 *
 * Nothing is uploaded. The samples are drawn in the worker and a dropped file
 * never leaves the tab, which is worth stating on the page because people
 * reasonably assume otherwise.
 */

type Phase = 'preparing' | 'ready' | 'working' | 'done' | 'failed'

type SampleFile = { container: Container; bytes: Uint8Array }

type VerdictKind = DemoResult['verdict']

const VERDICT_WORD: Record<VerdictKind, string> = {
  saved: 'Made it smaller',
  stopped: 'Left it alone',
  kept: 'Left it alone',
}

const ACCEPT = 'image/jpeg,image/png,image/webp'

export function TryIt() {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [samples, setSamples] = useState<Map<SampleKind, SampleFile>>(new Map())
  const [thumbs, setThumbs] = useState<Map<SampleKind, string>>(new Map())
  const [selected, setSelected] = useState<SampleKind | 'custom' | null>(null)
  const [customName, setCustomName] = useState<string>('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<DemoResult | null>(null)
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null)
  const [afterUrl, setAfterUrl] = useState<string | null>(null)
  const [reveal, setReveal] = useState(50)
  const [failure, setFailure] = useState<string | null>(null)
  const [showTechnical, setShowTechnical] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Whether the samples came from committed photographs or the drawn fallback.
  const [photographed, setPhotographed] = useState(true)

  const workerRef = useRef<Worker | null>(null)
  // Preview URLs for the current run, revoked before each new run.
  const urlsRef = useRef<string[]>([])
  // Thumbnail URLs for the three samples, created once and kept for the
  // lifetime of the section.
  const thumbUrlsRef = useRef<string[]>([])
  const pendingBeforeRef = useRef<Uint8Array | null>(null)

  const trackUrl = useCallback((bytes: Uint8Array, type: string): string => {
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }))
    urlsRef.current.push(url)
    return url
  }, [])

  // One worker for the life of the section. It is cheap to keep and it holds
  // the initialized wasm codecs, so the second run is much faster than the
  // first.
  useEffect(() => {
    const worker = new Worker(new URL('./demo-worker.ts', import.meta.url))
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as DemoResponse
      switch (msg.type) {
        case 'samples': {
          const next = new Map<SampleKind, SampleFile>()
          const nextThumbs = new Map<SampleKind, string>()
          for (const item of msg.items) {
            const bytes = new Uint8Array(item.bytes)
            next.set(item.kind, { container: item.container, bytes })
            const url = URL.createObjectURL(
              new Blob([bytes as unknown as BlobPart], { type: `image/${item.container}` }),
            )
            thumbUrlsRef.current.push(url)
            nextThumbs.set(item.kind, url)
          }
          setSamples(next)
          setThumbs(nextThumbs)
          setPhotographed(msg.photographed)
          setPhase('ready')
          break
        }
        case 'progress':
          setProgress({ done: msg.done, total: msg.total })
          break
        case 'result': {
          const before = pendingBeforeRef.current
          setResult({ ...msg.result, outputBytes: null })
          if (before) setBeforeUrl(trackUrl(before, `image/${msg.result.source.container}`))
          if (msg.outputBytes && msg.result.output) {
            setAfterUrl(
              trackUrl(new Uint8Array(msg.outputBytes), `image/${msg.result.output.format}`),
            )
          }
          setReveal(50)
          setPhase('done')
          break
        }
        case 'failure':
          setFailure(msg.message)
          setPhase('failed')
          break
      }
    }

    const request: DemoRequest = { type: 'samples' }
    worker.postMessage(request)

    return () => {
      worker.terminate()
      workerRef.current = null
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current = []
      thumbUrlsRef.current = []
    }
  }, [trackUrl])

  const runFile = useCallback(
    (bytes: Uint8Array, container: Container, choice: SampleKind | 'custom') => {
      const worker = workerRef.current
      if (!worker) return

      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current = []
      setBeforeUrl(null)
      setAfterUrl(null)
      setResult(null)
      setFailure(null)
      setShowTechnical(false)
      setSelected(choice)
      setProgress({ done: 0, total: 0 })
      setPhase('working')

      // Keep a copy for the preview: the buffer handed to the worker is
      // transferred, which detaches it on this side.
      pendingBeforeRef.current = new Uint8Array(bytes)
      const owned = new Uint8Array(bytes)
      const request: DemoRequest = { type: 'run', bytes: owned.buffer as ArrayBuffer, container }
      worker.postMessage(request, [owned.buffer as ArrayBuffer])
    },
    [],
  )

  const pickSample = useCallback(
    (kind: SampleKind) => {
      const file = samples.get(kind)
      if (file) runFile(file.bytes, file.container, kind)
    },
    [runFile, samples],
  )

  const takeFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const container = sniffContainer(bytes)
      if (!container || (container !== 'jpeg' && container !== 'png' && container !== 'webp')) {
        setFailure(
          `That file reads as ${container ?? 'something this demo does not recognise'}. Try a jpeg, png, or webp.`,
        )
        setPhase('failed')
        return
      }
      setCustomName(file.name)
      runFile(bytes, container, 'custom')
    },
    [runFile],
  )

  const busy = phase === 'working'

  return (
    <div className="try">
      <div className="try__picker" role="group" aria-label="Choose a picture to test">
        {SAMPLES.map((sample) => {
          const file = samples.get(sample.kind)
          const thumb = thumbs.get(sample.kind)
          const isActive = selected === sample.kind
          return (
            <button
              key={sample.kind}
              type="button"
              className="sample"
              aria-pressed={isActive}
              disabled={!file || busy}
              onClick={() => pickSample(sample.kind)}
            >
              <span className="sample__thumb">
                {thumb ? (
                  <img src={thumb} alt="" width={240} height={160} />
                ) : (
                  <span className="sample__thumb-empty" aria-hidden="true" />
                )}
              </span>
              <span className="sample__body">
                <span className="sample__title">{sample.title}</span>
                <span className="sample__blurb">{sample.blurb}</span>
                <span className="sample__size">
                  {file ? formatBytes(file.bytes.length) : 'drawing it now'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div
        className={`try__drop${dragOver ? ' try__drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void takeFile(file)
        }}
      >
        <label className="try__drop-label">
          <input
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void takeFile(file)
            }}
          />
          <span>Or use one of your own images</span>
        </label>
        <p className="try__privacy">
          It stays on your device. There is no upload and no server involved in this demo.
        </p>
        {!photographed && phase !== 'preparing' && (
          <p className="try__drawn">
            The three samples above are drawn by the page, not photographed. Your own picture is the
            better test.
          </p>
        )}
      </div>

      <div className="try__stage" aria-live="polite">
        {phase === 'preparing' && (
          <p className="try__status">Getting the sample pictures ready, one moment.</p>
        )}

        {phase === 'ready' && !result && (
          <p className="try__status">
            Pick a picture above and cupel will tell you what it would do.
          </p>
        )}

        {busy && (
          <p className="try__status">
            Measuring
            {progress.total > 0 ? ` (${progress.done} of ${progress.total} options tried)` : ''}
          </p>
        )}

        {phase === 'failed' && failure && (
          <p className="try__status try__status--stop">{failure}</p>
        )}

        {result && phase === 'done' && (
          <Verdict
            result={result}
            beforeUrl={beforeUrl}
            afterUrl={afterUrl}
            reveal={reveal}
            onReveal={setReveal}
            showTechnical={showTechnical}
            onToggleTechnical={() => setShowTechnical((v) => !v)}
            fileName={selected === 'custom' ? customName : sampleFileName(selected)}
          />
        )}
      </div>
    </div>
  )
}

function sampleFileName(kind: SampleKind | 'custom' | null): string {
  return SAMPLES.find((s) => s.kind === kind)?.fileName ?? 'your image'
}

function Verdict({
  result,
  beforeUrl,
  afterUrl,
  reveal,
  onReveal,
  showTechnical,
  onToggleTechnical,
  fileName,
}: {
  result: DemoResult
  beforeUrl: string | null
  afterUrl: string | null
  reveal: number
  onReveal: (v: number) => void
  showTechnical: boolean
  onToggleTechnical: () => void
  fileName: string
}) {
  const stopped = result.verdict === 'stopped'
  const tone = stopped ? 'stop' : result.verdict === 'saved' ? 'keep' : 'neutral'

  return (
    <div className={`verdict verdict--${tone}`}>
      <div className="verdict__head">
        <p className="verdict__tag">{VERDICT_WORD[result.verdict]}</p>
        <h3 className="verdict__headline">{result.headline}</h3>
        <p className="verdict__detail">{result.detail}</p>
      </div>

      {afterUrl && beforeUrl ? (
        <figure className="compare">
          <div className="compare__frame" style={{ ['--reveal' as string]: `${reveal}%` }}>
            <img
              className="compare__img"
              src={beforeUrl}
              alt={`${fileName} before cupel touched it`}
            />
            <img
              className="compare__img compare__img--after"
              src={afterUrl}
              alt={`${fileName} after cupel compressed it`}
            />
            <span className="compare__seam" aria-hidden="true" />
          </div>
          <label className="compare__control">
            <span>Slide to compare</span>
            <input
              type="range"
              min={0}
              max={100}
              value={reveal}
              onChange={(e) => onReveal(Number(e.target.value))}
            />
          </label>
          <figcaption className="compare__caption">
            Left is the original. Right is what cupel produced. Both are the real files, decoded by
            your browser.
          </figcaption>
        </figure>
      ) : beforeUrl ? (
        <figure className="compare compare--single">
          <img className="compare__img" src={beforeUrl} alt={`${fileName}, untouched`} />
          <figcaption className="compare__caption">
            This is the file exactly as it was. cupel did not write anything.
          </figcaption>
        </figure>
      ) : null}

      <dl className="facts">
        <div className="facts__item">
          <dt>Original</dt>
          <dd>
            {formatBytes(result.source.bytes)}
            <span className="facts__sub">
              {result.source.container}, {result.source.width} by {result.source.height}
            </span>
          </dd>
        </div>
        <div className="facts__item">
          <dt>Quality left to spend</dt>
          <dd>
            {result.quality.left}
            <span className="facts__sub">
              {result.quality.estimated === null
                ? 'saved without a quality setting'
                : `last saved around quality ${result.quality.estimated}`}
            </span>
          </dd>
        </div>
        {result.output ? (
          <>
            <div className="facts__item facts__item--hero">
              <dt>After cupel</dt>
              <dd>
                {formatBytes(result.output.bytes)}
                <span className="facts__sub">
                  {result.output.format}
                  {result.output.quality === null ? '' : ` quality ${result.output.quality}`}
                </span>
              </dd>
            </div>
            <div className="facts__item facts__item--hero">
              <dt>Saved</dt>
              <dd>
                {Math.round(result.output.savedFraction * 100)}%
                <span className="facts__sub">
                  {(result.output.similarity * 100).toFixed(1)}% structurally identical
                </span>
              </dd>
            </div>
          </>
        ) : (
          <div className="facts__item facts__item--hero">
            <dt>After cupel</dt>
            <dd>
              Unchanged
              <span className="facts__sub">
                {result.candidatesMeasured === 0
                  ? 'nothing was encoded, so nothing was wasted'
                  : `${result.candidatesMeasured} options measured, none worth taking`}
              </span>
            </dd>
          </div>
        )}
      </dl>

      <div className="verdict__foot">
        <button type="button" className="linkish" onClick={onToggleTechnical}>
          {showTechnical ? 'Hide the technical reason' : 'Show the technical reason'}
        </button>
        {showTechnical && <p className="verdict__technical">{result.technicalReason}</p>}
      </div>
    </div>
  )
}
