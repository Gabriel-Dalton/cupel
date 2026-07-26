import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Coming with milestone M2: drop an image and run a full quality sweep in your browser. The image never leaves your machine.',
}

/**
 * A schematic quality-per-byte curve: candidate points, with the surviving
 * lower-hull points picked out in the accent colour. Decorative only.
 */
function CurveSketch() {
  return (
    <svg
      className="stub__sketch"
      viewBox="0 0 320 200"
      width="320"
      height="200"
      role="img"
      aria-label="Sketch of the planned chart: candidate encodes plotted as bytes against quality loss, with the efficient frontier highlighted"
    >
      {/* axes */}
      <path d="M36 12v156h272" fill="none" stroke="currentColor" strokeWidth="1" />
      {/* dominated candidate points */}
      <g fill="currentColor">
        <circle cx="86" cy="72" r="3" />
        <circle cx="122" cy="96" r="3" />
        <circle cx="150" cy="70" r="3" />
        <circle cx="182" cy="120" r="3" />
        <circle cx="212" cy="98" r="3" />
        <circle cx="248" cy="140" r="3" />
      </g>
      {/* the frontier */}
      <path
        className="stub__sketch-accent"
        d="M56 36 L104 84 L164 122 L232 148 L294 158"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <g className="stub__sketch-accent" fill="currentColor">
        <circle cx="56" cy="36" r="3.5" />
        <circle cx="104" cy="84" r="3.5" />
        <circle cx="164" cy="122" r="3.5" />
        <circle cx="232" cy="148" r="3.5" />
        <circle cx="294" cy="158" r="3.5" />
      </g>
    </svg>
  )
}

export default function PlaygroundPage() {
  return (
    <div className="shell stub">
      <p className="eyebrow eyebrow--accent">Playground · not built yet</p>
      <h1 className="stub__title">Measure your own image, in your own browser.</h1>
      <p className="stub__lede">
        This page will run a full quality sweep on an image you drop here, using the same
        WebAssembly codecs and the same measurement code that CI runs. The image never leaves your
        machine: no upload, no server, no queue.
      </p>

      <div className="stub__panel">
        <CurveSketch />
        <ul className="stub__list">
          <li>
            <strong>Drop an image</strong>
            Decoded locally. Large images are downscaled first, and the page says so when it
            happens.
          </li>
          <li>
            <strong>Watch the sweep</strong>
            Every format and quality step is encoded in your browser and measured against the
            original, filling in a live quality-per-byte curve.
          </li>
          <li>
            <strong>Drag the budget</strong>
            Slide a byte budget along the curve and see which candidate survives, and what it costs
            in fidelity.
          </li>
        </ul>
      </div>

      <p className="stub__footer">
        This lands in the second half of milestone M2, after the docs you are reading. It is a
        demonstration, not a production path: in-browser encoding is slower than the CLI will be,
        and the page will be upfront about that. Until it ships, the{' '}
        <Link href="/docs/metrics">metrics docs</Link> describe exactly what will be measured, and
        the <Link href="/docs/roadmap">roadmap</Link> says what ships when.
      </p>
    </div>
  )
}
