import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Corpus',
  description:
    'Coming with milestone M8: a public, CC BY 4.0 benchmark corpus and a leaderboard anyone can rerun.',
}

export default function CorpusPage() {
  return (
    <div className="shell stub">
      <p className="eyebrow eyebrow--accent">Corpus · not built yet</p>
      <h1 className="stub__title">A benchmark you can rerun, not a percentage you must trust.</h1>
      <p className="stub__lede">
        Every tool in this space quotes a savings number against a private test set. This page will
        do the opposite: a public, versioned image corpus under CC BY 4.0, scored in the open, with
        the runner in this repository.
      </p>

      <div className="stub__panel">
        <ul className="stub__list">
          <li>
            <strong>The corpus</strong>
            Versioned specimens covering the damage the measurements exist to catch: generation
            loss, laundered files, upscales, chroma damage, soft sources.
          </li>
          <li>
            <strong>The leaderboard</strong>
            Encoder configurations scored against the corpus, rebuilt on a schedule, with the exact
            runner and manifest published so any row can be reproduced.
          </li>
          <li>
            <strong>The disagreement channel</strong>
            An issue template for when a published number disagrees with what your eyes see. Metric
            disagreements are treated as bugs, not noise.
          </li>
        </ul>
      </div>

      <p className="stub__footer">
        This is milestone M8, the last on the <Link href="/docs/roadmap">roadmap</Link>, because a
        leaderboard is only worth publishing once the measurements, the allocator, and the receipts
        it scores are all real. The license is already reserved: code is Apache-2.0, the corpus will
        be CC BY 4.0.
      </p>
    </div>
  )
}
