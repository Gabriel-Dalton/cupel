'use client'

import { useCallback, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { sha256Hex } from '../../lib/verify/hash'
import { parseLedger } from '../../lib/verify/parse'
import type {
  DecodeFn,
  EntryReport,
  MetricName,
  ParsedLedger,
  VerifyFile,
  VerifyReport,
  VerifySummary,
} from '../../lib/verify/types'
import { orderForDisplay, verifyLedger } from '../../lib/verify/verify'
import styles from './verify.module.css'

/**
 * The interactive half of /verify. Every byte is read, hashed, decoded, and
 * measured inside this browser tab: the decode step lazily loads the same
 * @cupel/codecs-wasm build the playground uses, so nothing here talks to a
 * server and the codecs stay out of the initial bundle.
 */

const decode: DecodeFn = async (format, bytes) => {
  const { wasmCodec } = await import('@cupel/codecs-wasm')
  return wasmCodec(format).decode(bytes)
}

type LedgerState = { fileName: string; parsed: ParsedLedger }
type Phase = 'idle' | 'hashing' | 'running' | 'done'

const VERDICT_LABEL = { pass: 'confirmed', fail: 'refuted', unverifiable: 'unverified' } as const

const METRIC_LABEL: Record<MetricName, { plain: string; key: string }> = {
  ssim: { plain: 'structure', key: 'ssim' },
  deltaE: { plain: 'colour drift', key: 'deltaE' },
  distortion: { plain: 'distortion', key: 'd' },
}

const METRIC_DIGITS: Record<MetricName, number> = { ssim: 4, deltaE: 2, distortion: 5 }

function fmt(metric: MetricName, value: number): string {
  return value.toFixed(METRIC_DIGITS[metric])
}

function fmtDrift(metric: MetricName, measured: number, recorded: number): string {
  const drift = measured - recorded
  return `${drift >= 0 ? '+' : ''}${drift.toFixed(METRIC_DIGITS[metric])}`
}

function classificationLabel(report: EntryReport): string {
  switch (report.classification) {
    case 'verifiable':
      return 're-measured'
    case 'reference-missing':
      return 'source not provided'
    case 'not-applicable':
      return report.verdict === 'fail' ? 'hash mismatch' : 'unchanged claim'
    case 'file-missing':
      return report.verdict === 'fail' ? 'hash mismatch' : 'file not provided'
  }
}

function summaryLine(summary: VerifySummary): string {
  if (summary.entries === 0) {
    return 'No entries survived parsing; nothing was verified.'
  }
  const parts: string[] = []
  if (summary.fail > 0) parts.push(`${summary.fail} refuted`)
  parts.push(`${summary.pass} confirmed`)
  if (summary.unverifiable > 0) parts.push(`${summary.unverifiable} unverified`)
  const noun = summary.entries === 1 ? 'entry' : 'entries'
  return `${summary.entries} ${noun} checked: ${parts.join(', ')}.`
}

function isLedgerFile(file: File): boolean {
  return /\.(jsonl|json|txt)$/i.test(file.name)
}

export function VerifyClient() {
  const [ledger, setLedger] = useState<LedgerState | null>(null)
  const [files, setFiles] = useState<VerifyFile[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const ingest = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) return
    setProblem(null)
    setReport(null)
    setPhase('hashing')
    try {
      const images: VerifyFile[] = []
      for (const file of incoming) {
        if (isLedgerFile(file)) {
          const parsed = parseLedger(await file.text())
          setLedger({ fileName: file.name, parsed })
          continue
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        images.push({ name: file.name, hash: await sha256Hex(bytes), bytes })
      }
      if (images.length > 0) {
        setFiles((prev) => {
          const merged = [...prev]
          for (const image of images) {
            if (!merged.some((f) => f.name === image.name && f.hash === image.hash)) {
              merged.push(image)
            }
          }
          return merged
        })
      }
      setPhase('idle')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }, [])

  const run = useCallback(async () => {
    if (!ledger) return
    setProblem(null)
    setReport(null)
    setPhase('running')
    setProgress({ done: 0, total: ledger.parsed.entries.length })
    try {
      const result = await verifyLedger(ledger.parsed, files, decode, (done, total) =>
        setProgress({ done, total }),
      )
      setReport(result)
      setPhase('done')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }, [ledger, files])

  const reset = useCallback(() => {
    setLedger(null)
    setFiles([])
    setReport(null)
    setProblem(null)
    setPhase('idle')
    setProgress({ done: 0, total: 0 })
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragOver(false)
      void ingest(Array.from(event.dataTransfer.files))
    },
    [ingest],
  )

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files ? Array.from(event.target.files) : []
      // Allow re-picking the same file after a clear.
      event.target.value = ''
      void ingest(picked)
    },
    [ingest],
  )

  const busy = phase === 'hashing' || phase === 'running'
  const ready = ledger !== null && ledger.parsed.entries.length > 0 && !busy

  const status = (() => {
    if (phase === 'hashing') return 'Hashing files locally.'
    if (phase === 'running') return `Re-measuring entry ${progress.done} of ${progress.total}.`
    if (phase === 'done' && report) return summaryLine(report.summary)
    if (!ledger) return 'Waiting for a ledger.'
    if (files.length === 0) return 'Ledger loaded. Waiting for the image files it describes.'
    return 'Ready to verify.'
  })()

  return (
    <section aria-label="Verification">
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className={styles.dropzoneHint}>
          <strong>Drop the ledger and the shipped files here,</strong> or pick them below:{' '}
          <code>.cupel/ledger.jsonl</code> plus the image files it describes. Files are read in
          place. This page uploads nothing, re-encodes nothing, and keeps every byte in this tab.
        </p>
        <div className={styles.pickers}>
          <label className={`btn ${styles.fileLabel}`}>
            <input
              className={styles.srOnly}
              type="file"
              accept=".jsonl,.json,.txt,application/json"
              onChange={onPick}
              disabled={busy}
            />
            Choose ledger.jsonl
          </label>
          <label className={`btn ${styles.fileLabel}`}>
            <input
              className={styles.srOnly}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif"
              multiple
              onChange={onPick}
              disabled={busy}
            />
            Choose image files
          </label>
        </div>
        <dl className={styles.manifest}>
          <div>
            <dt>Ledger</dt>
            <dd>
              {ledger
                ? `${ledger.fileName}: ${ledger.parsed.entries.length} entries` +
                  (ledger.parsed.skipped.length > 0
                    ? `, ${ledger.parsed.skipped.length} malformed lines skipped`
                    : '')
                : 'none yet'}
            </dd>
          </div>
          <div>
            <dt>Files</dt>
            <dd>{files.length === 0 ? 'none yet' : `${files.length} hashed locally`}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <button type="button" className="btn btn--primary" onClick={run} disabled={!ready}>
            Verify the receipts
          </button>
          <button
            type="button"
            className="btn"
            onClick={reset}
            disabled={busy || (!ledger && files.length === 0)}
          >
            Clear
          </button>
        </div>
        <p className={styles.status} role="status" aria-live="polite">
          {status}
        </p>
        {problem ? <p className={styles.problem}>Verification stopped: {problem}</p> : null}
      </div>

      {report && phase === 'done' ? <Report report={report} ledger={ledger} /> : null}
    </section>
  )
}

function Report({ report, ledger }: { report: VerifyReport; ledger: LedgerState | null }) {
  const skipped = ledger?.parsed.skipped ?? []
  return (
    <div className={styles.report}>
      <h2 className={`${styles.summaryLine} ${report.summary.fail > 0 ? styles.summaryFail : ''}`}>
        {summaryLine(report.summary)}
      </h2>
      {skipped.length > 0 ? (
        <details className={styles.skips}>
          <summary>
            {skipped.length} malformed {skipped.length === 1 ? 'line' : 'lines'} skipped
          </summary>
          <ul>
            {skipped.map((skip) => (
              <li key={skip.line}>
                line {skip.line}: {skip.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className={styles.results}>
        {orderForDisplay(report.reports).map((entry) => (
          <EntryCard key={entry.line} report={entry} />
        ))}
      </div>
    </div>
  )
}

function EntryCard({ report }: { report: EntryReport }) {
  const verdictClass =
    report.verdict === 'pass'
      ? styles.verdictPass
      : report.verdict === 'fail'
        ? styles.verdictFail
        : ''
  const entryClass =
    report.verdict === 'pass'
      ? styles.entryPass
      : report.verdict === 'fail'
        ? styles.entryFail
        : ''
  return (
    <article className={`${styles.entry} ${entryClass}`}>
      <header className={styles.entryHeader}>
        <span className={`${styles.verdict} ${verdictClass}`}>
          {VERDICT_LABEL[report.verdict]}
        </span>
        <h3 className={styles.asset}>{report.entry.asset}</h3>
        <span className={styles.meta}>
          {report.entry.decision} · line {report.line} · {classificationLabel(report)}
        </span>
      </header>
      {report.metrics ? (
        <div className={styles.tableScroll}>
          <table className={styles.metrics}>
            <caption className={styles.srOnly}>
              Recorded and re-measured values for {report.entry.asset}
            </caption>
            <thead>
              <tr>
                <th scope="col">Measurement</th>
                <th scope="col">Recorded</th>
                <th scope="col">Re-measured</th>
                <th scope="col">Drift</th>
                <th scope="col">Allowed</th>
                <th scope="col">Within</th>
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((m) => (
                <tr key={m.metric} className={m.withinTolerance ? '' : styles.rowOver}>
                  <th scope="row">
                    {METRIC_LABEL[m.metric].plain} <code>{METRIC_LABEL[m.metric].key}</code>
                  </th>
                  <td>{fmt(m.metric, m.recorded)}</td>
                  <td>{fmt(m.metric, m.measured)}</td>
                  <td>{fmtDrift(m.metric, m.measured, m.recorded)}</td>
                  <td>{fmt(m.metric, m.tolerance)}</td>
                  <td>{m.withinTolerance ? 'yes' : 'over'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {report.notes.length > 0 ? (
        <ul className={styles.notes}>
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
