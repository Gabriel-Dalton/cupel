import type { Metadata } from 'next'
import Link from 'next/link'
import { SweepLab } from './sweep-lab'
import './playground.css'

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Drop an image and run a full quality sweep in your browser: every format, every quality step, measured against your original with the shipped code. The image never leaves your machine.',
}

/**
 * The playground route. This server component carries the metadata and the
 * static copy; everything interactive lives in SweepLab, and everything
 * heavy lives in its web worker. No image byte ever reaches a server.
 *
 * Copy discipline (brand.md): refusals and defaults stated up front, verbs
 * over adjectives, metric proper names quarantined to the receipt and the
 * ledger where they are data, not marketing.
 */
export default function PlaygroundPage() {
  return (
    <div className="shell pg">
      <p className="eyebrow eyebrow--accent">Playground</p>
      <h1 className="pg__title">Measure your own image, in your own browser.</h1>
      <p className="pg__lede">
        Drop an image and this page encodes it across every format and quality step the
        WebAssembly codecs offer, measures each candidate against your original with the same
        code CI runs, and plots the frontier worth spending bytes on. The image never leaves
        your machine: no upload, no server, no queue.
      </p>

      <SweepLab />

      <p className="pg__footer">
        This is a demonstration, not a production path: in-browser encoding is slower than the
        CLI will be, and the page says so while it works. Definitions and known blind spots of
        every measurement are in the <Link href="/docs/metrics">metrics docs</Link>; the frontier
        line is the lower convex hull trick described in{' '}
        <Link href="/docs/architecture">the architecture notes</Link>, the same pruning video
        encoders use for mode decision.
      </p>
    </div>
  )
}
