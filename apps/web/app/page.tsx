import Link from 'next/link'
import { runAssay } from '../lib/assay'

/**
 * Landing page. Statically rendered; runAssay() executes the real
 * @cupel/core measurement code at build time, so every number in the
 * specimen ledger is computed by the shipped library, never typed in.
 *
 * Copy discipline (brand.md): verbs over adjectives, defaults and refusals
 * stated up front, technical lexicon quarantined to /docs, and exactly one
 * use of the word "assay" as the permitted hook.
 */

const PIPELINE = [
  {
    step: '01',
    verb: 'Measure',
    status: { className: 'badge badge--done', label: 'ships today' },
    body:
      'Decode the pixels and read what is actually there: how much structure survives, how far ' +
      'colour has drifted, where fine detail lives, and the resolution the image really carries ' +
      'rather than the one it declares.',
  },
  {
    step: '02',
    verb: 'Prove',
    status: { className: 'badge badge--now', label: 'in progress' },
    body:
      'Reconstruct what has been done to the file: how many times it was compressed, at what ' +
      'quality, by which encoder. That history sets the headroom, and headroom decides whether ' +
      're-encoding is allowed at all.',
  },
  {
    step: '03',
    verb: 'Allocate',
    status: { className: 'badge badge--next', label: 'planned' },
    body:
      'Treat the page as one byte budget rather than sixty separate files. Spend it where it ' +
      'buys the most visible quality, which is almost never evenly.',
  },
  {
    step: '04',
    verb: 'Receipt',
    status: { className: 'badge badge--next', label: 'planned' },
    body:
      'Record every decision, every refusal, and the numbers behind them in a form anyone can ' +
      'recompute in a browser. A claim you cannot check is marketing.',
  },
]

const MEASUREMENTS = [
  {
    name: 'Structural survival',
    body:
      'A windowed comparison of local structure between reference and candidate, where 1.000 ' +
      'means nothing was lost. Identity scores exactly 1, and the comparison is symmetric by ' +
      'construction.',
  },
  {
    name: 'Colour drift',
    body:
      'Perceptual colour distance, reported as the mean and the worst 5 percent. It exists ' +
      'because the structure check runs on grayscale and is provably blind to colour-only ' +
      'damage.',
  },
  {
    name: 'Detail',
    body:
      'Second-derivative variance over tiles at a normalized scale, reporting the sharpest ' +
      'region rather than the average, so one sharp subject proves sharpness even in a sea of ' +
      'bokeh.',
  },
  {
    name: 'Seam energy',
    body:
      'Gradient energy on 8x8 block boundaries measured against the interior. Ratios above 1 ' +
      'expose block-based compression in a file’s past, even after it was re-saved in a ' +
      'lossless format.',
  },
  {
    name: 'Real resolution',
    body:
      'Where the image’s frequency content actually stops, converted back into pixels. An ' +
      'enlarged image declares dimensions it cannot back, and this measure calls the bluff.',
  },
]

const ROADMAP = [
  {
    id: 'M0',
    name: 'Skeleton',
    status: { className: 'badge badge--done', label: 'done' },
    body: 'Monorepo, CI, licenses, and both codec adapters behind one shared interface.',
  },
  {
    id: 'M1',
    name: 'Measurement',
    status: { className: 'badge badge--done', label: 'done' },
    body: 'The five measurements above, with the test suite that keeps them honest.',
  },
  {
    id: 'M2',
    name: 'Site and playground',
    status: { className: 'badge badge--now', label: 'in progress' },
    body:
      'This site and its docs, then an in-browser demo that runs a full quality sweep without ' +
      'uploading anything.',
  },
  {
    id: 'M3',
    name: 'File history',
    status: { className: 'badge badge--next', label: 'next' },
    body:
      'Read a file’s compression history from its own bytes: estimated original quality, ' +
      'generation count, laundered files.',
  },
  {
    id: 'M4',
    name: 'Auditor',
    status: { className: 'badge badge--next', label: 'next' },
    body:
      'Point it at a page and get a read-only report: what is oversized, what is damaged, what ' +
      'is recoverable. Writes nothing.',
  },
  {
    id: 'M5',
    name: 'Allocator',
    status: { className: 'badge badge--next', label: 'next' },
    body: 'The page-level budget solver, wired into the audit output as a recommended plan.',
  },
  {
    id: 'M6',
    name: 'Writer and receipts',
    status: { className: 'badge badge--next', label: 'next' },
    body:
      'The only milestone that writes files. Git-clean guard, atomic writes, a receipt for ' +
      'every change, and a browser page to verify any receipt.',
  },
  {
    id: 'M7',
    name: 'Source recovery',
    status: { className: 'badge badge--next', label: 'next' },
    body:
      'Find the better original your pipeline buried: CMS size suffixes, retina siblings, git ' +
      'history.',
  },
  {
    id: 'M8',
    name: 'Corpus, action, skill',
    status: { className: 'badge badge--next', label: 'next' },
    body: 'A public benchmark corpus and leaderboard, a GitHub Action, and a Claude Code skill.',
  },
]

export default function Home() {
  const assay = runAssay()

  return (
    <>
      <section className="hero">
        <div className="shell">
          <p className="eyebrow eyebrow--accent">Open source image toolchain</p>
          <h1 className="hero__title">Assay before you compress.</h1>
          <p className="hero__lede">
            cupel measures the quality a source image actually has left, spends a page’s byte budget
            only where it buys visible fidelity, and keeps a receipt for every decision. The
            measurement layer ships today; the rest is built in the open, in the order listed below.
          </p>
          <div className="hero__actions">
            <Link className="btn btn--primary" href="/docs/getting-started">
              Get started
            </Link>
            <a className="btn" href="https://github.com/Gabriel-Dalton/cupel">
              Source on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="defaults-heading">
        <div className="shell">
          <p className="eyebrow" id="defaults-heading">
            Default behaviour
          </p>
          <div className="defaults">
            <div className="defaults__rule">
              <h2>It refuses to re-encode a spent source.</h2>
              <p>
                A file with no quality headroom left is flagged and kept, not squeezed again.
                Another pass can only destroy what remains. Refusal is a first class result, not an
                error.
              </p>
            </div>
            <div className="defaults__rule">
              <h2>It never writes without an explicit flag.</h2>
              <p>
                Every run is read-only until you say otherwise. There is no mode in which cupel
                silently replaces your files.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pipeline-heading">
        <div className="shell">
          <p className="eyebrow">The pipeline</p>
          <h2 className="section__title" id="pipeline-heading">
            Four steps, in order.
          </h2>
          <p className="section__lede">
            Each step ships as its own milestone and is useful on its own. The badges say what is
            real today.
          </p>
          <ol className="pipeline">
            {PIPELINE.map((p) => (
              <li key={p.step} className="pipeline__step">
                <span className="pipeline__num" aria-hidden="true">
                  {p.step}
                </span>
                <h3>{p.verb}</h3>
                <p>{p.body}</p>
                <span className={p.status.className}>{p.status.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="exists-heading">
        <div className="shell">
          <p className="eyebrow">What exists today</p>
          <h2 className="section__title" id="exists-heading">
            Five measurements you can rerun.
          </h2>
          <p className="section__lede">
            The numbers below are not typed into this page. At build time the site generates a
            seeded reference image, damages it four ways, and runs the shipped measurement code
            against each specimen. If a number ever stops demonstrating what this copy claims, the
            build fails instead of shipping the stale claim.
          </p>

          <div className="table-scroll">
            <table className="ledger">
              <caption className="ledger__caption">
                Specimen ledger, computed at build time. The reference scores {assay.selfStructure}{' '}
                against itself: identity is exact, by contract.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Specimen</th>
                  <th scope="col">Treatment</th>
                  <th scope="col">Reading</th>
                  <th scope="col">Baseline</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {assay.rows.map((row) => (
                  <tr key={row.specimen}>
                    <th scope="row">{row.specimen}</th>
                    <td>{row.treatment}</td>
                    <td className="ledger__num">
                      <span className="ledger__label">{row.reading.label}</span>
                      {row.reading.value}
                    </td>
                    <td className="ledger__num">
                      <span className="ledger__label">{row.baseline.label}</span>
                      {row.baseline.value}
                    </td>
                    <td>{row.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="measure-list">
            {MEASUREMENTS.map((m) => (
              <li key={m.name}>
                <h3>{m.name}</h3>
                <p>{m.body}</p>
              </li>
            ))}
          </ul>

          <p className="section__note">
            Underneath: two codec adapters, one native and one WebAssembly, behind the same
            interface, with a parity test holding their measurements to within 1e-6 of each other.
            The measurement core has zero platform dependencies and runs identically in Node and the
            browser; CI enforces that isolation mechanically. Precise definitions, proper names, and
            known blind spots of every measurement live in{' '}
            <Link href="/docs/metrics">the docs</Link>.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="roadmap-heading">
        <div className="shell">
          <p className="eyebrow">Roadmap</p>
          <h2 className="section__title" id="roadmap-heading">
            Built in public, one milestone at a time.
          </h2>
          <ol className="roadmap">
            {ROADMAP.map((m) => (
              <li key={m.id} className="roadmap__row">
                <span className="roadmap__id" aria-hidden="true">
                  {m.id}
                </span>
                <div className="roadmap__body">
                  <h3>{m.name}</h3>
                  <p>{m.body}</p>
                </div>
                <span className={m.status.className}>{m.status.label}</span>
              </li>
            ))}
          </ol>
          <p className="section__note">
            The four-part pitch at the top of this page is fully true only once M7 lands. Until
            then, this page describes what exists and keeps the promises here, in the roadmap, where
            they belong.
          </p>
        </div>
      </section>

      <section className="section section--cta" aria-labelledby="cta-heading">
        <div className="shell">
          <h2 className="section__title" id="cta-heading">
            Start with the docs.
          </h2>
          <p className="section__lede">
            How the measurements work, how the packages fit together, and how to run everything
            yourself.
          </p>
          <div className="hero__actions">
            <Link className="btn btn--primary" href="/docs">
              Read the docs
            </Link>
            <Link className="btn" href="/playground">
              Preview the playground
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
