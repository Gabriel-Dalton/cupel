'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CandidatePoint } from '@cupel/core'
import { assembleCurve, fractionSaved, kneePoint, pointKey } from '../../lib/playground/assemble'
import {
  formatBytes,
  formatDeltaE,
  formatDistortion,
  formatMs,
  formatPercentSaved,
  formatQualityLabel,
  formatScore,
} from '../../lib/playground/format'
import { MAX_FILE_BYTES, MAX_REFERENCE_EDGE } from '../../lib/playground/ingest'
import type {
  DecodedMessage,
  SweepRequest,
  SweepResponse,
} from '../../lib/playground/worker-protocol'
import { RdChart, type RdChartPoint } from './rd-chart'

/**
 * The playground lab: drop zone, live curve, receipt, compare, and the
 * candidate ledger. All math and all codec work happen in the sweep worker;
 * this component only holds state and draws.
 */

type Phase = 'idle' | 'working' | 'done'

type Candidate = {
  key: string
  label: string
  point: CandidatePoint
  encodeMs: number
  /** Blob URL of the encoded bytes; the original file's URL for the anchor. */
  url: string | null
}

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif'

export function SweepLab() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [meta, setMeta] = useState<DecodedMessage | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [lastLabel, setLastLabel] = useState<string>('')
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string>('')
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const urlsRef = useRef<string[]>([])
  const userPickedRef = useRef(false)

  const cleanupJob = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current = []
  }, [])

  useEffect(() => cleanupJob, [cleanupJob])

  const reset = useCallback(() => {
    cleanupJob()
    setPhase('idle')
    setRefusal(null)
    setFileName('')
    setMeta(null)
    setCandidates([])
    setSkipped([])
    setProgress({ completed: 0, total: 0 })
    setLastLabel('')
    setElapsedMs(null)
    setSelectedKey(null)
    setOriginalUrl(null)
    userPickedRef.current = false
  }, [cleanupJob])

  const startSweep = useCallback(
    (file: File) => {
      reset()
      if (file.size > MAX_FILE_BYTES) {
        setRefusal(
          `This file is ${formatBytes(file.size)}. Decoding anything past ` +
            `${formatBytes(MAX_FILE_BYTES)} would lock this tab rather than measure it, ` +
            'so the page refuses it. Nothing was read.',
        )
        return
      }

      const localOriginalUrl = URL.createObjectURL(file)
      urlsRef.current.push(localOriginalUrl)
      setOriginalUrl(localOriginalUrl)
      setFileName(file.name)
      setPhase('working')
      setAnnouncement(`Measuring ${file.name}. The image stays in this tab.`)

      const worker = new Worker(new URL('./sweep-worker.ts', import.meta.url))
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as SweepResponse
        switch (msg.type) {
          case 'decoded': {
            setMeta(msg)
            setProgress({ completed: 0, total: msg.totalSteps })
            setAnnouncement(
              `Decoded ${msg.container}, ${msg.source.width} by ${msg.source.height} pixels. ` +
                `Sweeping ${msg.totalSteps} candidates.`,
            )
            break
          }
          case 'point': {
            let url: string | null = localOriginalUrl
            if (msg.encoded) {
              url = URL.createObjectURL(
                new Blob([msg.encoded], { type: MIME[msg.point.format] ?? 'application/octet-stream' }),
              )
              urlsRef.current.push(url)
            }
            const candidate: Candidate = {
              key: pointKey(msg.point),
              label: msg.label,
              point: msg.point,
              encodeMs: msg.encodeMs,
              url,
            }
            setCandidates((prev) => [...prev, candidate])
            setProgress((p) => ({ ...p, completed: p.completed + 1 }))
            setLastLabel(msg.label)
            break
          }
          case 'step-error': {
            setSkipped((prev) => [...prev, `${msg.label}: ${msg.message}`])
            setProgress((p) => ({ ...p, completed: p.completed + 1 }))
            setLastLabel(msg.label)
            break
          }
          case 'done': {
            setElapsedMs(msg.elapsedMs)
            setPhase('done')
            setAnnouncement('Sweep complete. The curve, the receipt, and the compare are ready.')
            workerRef.current?.terminate()
            workerRef.current = null
            break
          }
          case 'refusal': {
            setRefusal(msg.message)
            setAnnouncement(msg.message)
            setPhase('idle')
            workerRef.current?.terminate()
            workerRef.current = null
            break
          }
        }
      }

      worker.onerror = () => {
        setRefusal('The measurement worker failed to start in this browser. Nothing was uploaded.')
        setPhase('idle')
        workerRef.current?.terminate()
        workerRef.current = null
      }

      void file.arrayBuffer().then((bytes) => {
        const request: SweepRequest = { type: 'sweep', bytes }
        workerRef.current?.postMessage(request, [bytes])
      })
    },
    [reset],
  )

  // Default selection: the knee of the frontier, live, until the visitor
  // picks a point themselves.
  useEffect(() => {
    if (userPickedRef.current || candidates.length === 0) return
    const { hull } = assembleCurve(candidates.map((c) => c.point))
    const knee = kneePoint(hull)
    if (knee) setSelectedKey(pointKey(knee))
  }, [candidates])

  const curve = useMemo(
    () => assembleCurve(candidates.map((c) => c.point)),
    [candidates],
  )

  const chartPoints = useMemo<RdChartPoint[]>(
    () =>
      candidates.map((c) => ({
        key: c.key,
        bytes: c.point.bytes,
        distortion: c.point.distortion,
        onHull: curve.hullKeys.has(c.key),
        label: `${c.label}: ${formatBytes(c.point.bytes)}, quality loss ${formatDistortion(c.point.distortion)}`,
      })),
    [candidates, curve],
  )

  const rows = useMemo(
    () => [...candidates].sort((a, b) => a.point.bytes - b.point.bytes),
    [candidates],
  )

  const selected = candidates.find((c) => c.key === selectedKey) ?? null

  const select = useCallback((key: string) => {
    userPickedRef.current = true
    setSelectedKey(key)
  }, [])

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) startSweep(file)
    event.target.value = ''
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) startSweep(file)
  }

  const saved = selected && meta ? fractionSaved(selected.point.bytes, meta.source.bytes) : null

  return (
    <section className="pg-lab" aria-label="Sweep lab">
      {/* One polite live region for phase changes only. */}
      <p className="pg-visually-hidden" role="status">
        {announcement}
      </p>

      {phase === 'idle' && (
        <div
          className={`pg-drop${dragOver ? ' pg-drop--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input
            id="pg-file"
            className="pg-drop__input"
            type="file"
            accept={ACCEPT}
            onChange={onInputChange}
            aria-describedby="pg-privacy"
          />
          <label className="pg-drop__label" htmlFor="pg-file">
            <span className="pg-drop__title">Drop an image here, or browse for one</span>
            <span className="pg-drop__hint">
              jpeg · png · webp · avif, up to {formatBytes(MAX_FILE_BYTES)}
            </span>
          </label>
          <p className="pg-drop__privacy" id="pg-privacy">
            The image never leaves this page. No upload, no server, no queue: decoding, every
            encode, and every measurement run inside this tab.
          </p>
          {refusal && (
            <p className="pg-refusal" role="status">
              <strong>Refused.</strong> {refusal}
            </p>
          )}
        </div>
      )}

      {phase !== 'idle' && (
        <>
          <header className="pg-specimen">
            <div>
              <p className="eyebrow eyebrow--accent">Specimen</p>
              <h2 className="pg-specimen__name">{fileName}</h2>
              {meta && (
                <p className="pg-specimen__facts">
                  {meta.container} · {meta.source.width}x{meta.source.height} px ·{' '}
                  {formatBytes(meta.source.bytes)}
                  {meta.downscaled &&
                    ` · measured at ${meta.reference.width}x${meta.reference.height} px`}
                </p>
              )}
            </div>
            <button type="button" className="btn" onClick={reset}>
              Measure another image
            </button>
          </header>

          <div className="pg-progressline">
            <div
              className="pg-progress"
              role="progressbar"
              aria-label="Sweep progress"
              aria-valuemin={0}
              aria-valuemax={progress.total || 1}
              aria-valuenow={progress.completed}
            >
              <div
                className="pg-progress__bar"
                style={{
                  transform: `scaleX(${progress.total > 0 ? progress.completed / progress.total : 0})`,
                }}
              />
            </div>
            {/* Readable on demand, deliberately not a live region: the
                role=status element above announces phase changes only. */}
            <p className="pg-progress__text">
              {phase === 'done'
                ? `${progress.completed} candidates measured${elapsedMs !== null ? ` in ${formatMs(elapsedMs)}` : ''} in this browser.`
                : progress.total > 0
                  ? `${progress.completed} of ${progress.total} measured${lastLabel ? `, last: ${lastLabel}` : ''}. avif comes last and is the slow tail.`
                  : 'Decoding in this tab.'}
            </p>
          </div>

          <div className="pg-board">
            <figure className="pg-board__chart">
              {chartPoints.length > 0 ? (
                <RdChart points={chartPoints} selectedKey={selectedKey} onSelect={select} />
              ) : (
                <p className="pg-board__empty">The first candidate is still encoding.</p>
              )}
              <figcaption className="pg-board__caption">
                Every dot is one real encode of your image, measured. The line threads the lower
                convex hull: the only candidates any byte budget could ever select. Click a dot, or
                focus the chart and use the arrow keys.
              </figcaption>
            </figure>

            <aside className="pg-receipt" aria-label="Receipt for the selected candidate">
              <p className="eyebrow eyebrow--accent">Receipt</p>
              {selected ? (
                <dl className="pg-receipt__list">
                  <div className="pg-receipt__row">
                    <dt>candidate</dt>
                    <dd>
                      {selected.point.format}{' '}
                      {formatQualityLabel(selected.point.format, selected.point.quality)}
                    </dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>bytes</dt>
                    <dd>
                      {formatBytes(selected.point.bytes)}
                      {saved !== null && selected.point.format !== 'keep-original' && (
                        <span className="pg-receipt__aside"> {formatPercentSaved(saved)}</span>
                      )}
                    </dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>structure · SSIM</dt>
                    <dd>{formatScore(selected.point.ssim)}</dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>colour drift · mean CIE76 deltaE</dt>
                    <dd>{formatDeltaE(selected.point.deltaE)}</dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>quality loss</dt>
                    <dd>{formatDistortion(selected.point.distortion)}</dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>standing</dt>
                    <dd>
                      {curve.hullKeys.has(selected.key)
                        ? 'on the frontier'
                        : 'dominated, can never win'}
                    </dd>
                  </div>
                  <div className="pg-receipt__row">
                    <dt>encoder</dt>
                    <dd>{selected.point.encoder}</dd>
                  </div>
                  {selected.point.format !== 'keep-original' && (
                    <div className="pg-receipt__row">
                      <dt>encode time here</dt>
                      <dd>{formatMs(selected.encodeMs)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="pg-receipt__pending">No candidate measured yet.</p>
              )}
            </aside>
          </div>

          {selected && originalUrl && (
            <div className="pg-compare">
              <figure className="pg-compare__pane">
                <div className="pg-compare__frame">
                  <img src={originalUrl} alt={`Your original ${meta?.container ?? ''} file, shown as dropped`} />
                </div>
                <figcaption>
                  original · {meta ? `${meta.container} · ${formatBytes(meta.source.bytes)}` : ''}
                </figcaption>
              </figure>
              <figure className="pg-compare__pane">
                <div className="pg-compare__frame">
                  {selected.url ? (
                    <img
                      src={selected.url}
                      alt={`Selected candidate, ${selected.point.format} ${formatQualityLabel(selected.point.format, selected.point.quality)}, decoded by your browser`}
                    />
                  ) : null}
                </div>
                <figcaption>
                  selected · {selected.point.format}{' '}
                  {formatQualityLabel(selected.point.format, selected.point.quality)} ·{' '}
                  {formatBytes(selected.point.bytes)}
                </figcaption>
              </figure>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="table-scroll pg-ledger-scroll">
              <table className="ledger pg-ledger">
                <caption className="ledger__caption">
                  Candidate ledger, computed in this tab by the same measurement code CI runs.
                  {meta?.downscaled &&
                    ` Reference downscaled to ${meta.reference.width}x${meta.reference.height} px before measuring; byte counts are for encodes at that size.`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Size</th>
                    <th scope="col">Vs source</th>
                    <th scope="col">Structure · SSIM</th>
                    <th scope="col">Colour drift</th>
                    <th scope="col">Quality loss</th>
                    <th scope="col">Encode time</th>
                    <th scope="col">Standing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const onHull = curve.hullKeys.has(c.key)
                    const isSelected = c.key === selectedKey
                    const rowSaved = meta ? fractionSaved(c.point.bytes, meta.source.bytes) : null
                    return (
                      <tr key={c.key} className={isSelected ? 'pg-ledger__row--selected' : undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="pg-ledger__pick"
                            aria-pressed={isSelected}
                            onClick={() => select(c.key)}
                          >
                            {c.label}
                          </button>
                        </th>
                        <td className="ledger__num">{formatBytes(c.point.bytes)}</td>
                        <td className="ledger__num">
                          {c.point.format === 'keep-original' || rowSaved === null
                            ? '·'
                            : formatPercentSaved(rowSaved)}
                        </td>
                        <td className="ledger__num">{formatScore(c.point.ssim)}</td>
                        <td className="ledger__num">{formatDeltaE(c.point.deltaE)}</td>
                        <td className="ledger__num">{formatDistortion(c.point.distortion)}</td>
                        <td className="ledger__num">
                          {c.point.format === 'keep-original' ? '·' : formatMs(c.encodeMs)}
                        </td>
                        <td>
                          <span className={`badge ${onHull ? 'badge--now' : 'badge--next'}`}>
                            {onHull ? 'frontier' : 'dominated'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <ul className="pg-conditions">
            {meta?.downscaled && (
              <li>
                The reference was downscaled from {meta.source.width}x{meta.source.height} to{' '}
                {meta.reference.width}x{meta.reference.height} px (long edge capped at{' '}
                {MAX_REFERENCE_EDGE} px) to keep a full WebAssembly sweep tolerable. Because of
                that, your original file is not on the curve: comparing its full-size bytes
                against a smaller reference would flatter it.
              </li>
            )}
            {meta?.flattened && (
              <li>
                Transparency was composited onto white before measuring, the convention the jpeg
                encoder forces, so every format is measured against the same pixels.
              </li>
            )}
            <li>
              avif lossless is deliberately not swept: it is the slowest encode a browser can run
              and png nearly always beats it on bytes.
            </li>
            {skipped.length > 0 && (
              <li>
                {skipped.length} candidate{skipped.length === 1 ? '' : 's'} failed to encode in
                this browser and {skipped.length === 1 ? 'was' : 'were'} skipped:{' '}
                {skipped.join('; ')}.
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  )
}
