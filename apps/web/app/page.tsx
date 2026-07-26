import Link from 'next/link'
import { CommandBlock } from '../components/command-block'
import { runAssay } from '../lib/assay'
import { TryIt } from './_demo/try-it'
import './_demo/demo.css'

/**
 * Landing page.
 *
 * The thesis is the demo, not the headline: a reader picks a photograph and
 * watches the real pipeline either save bytes or refuse to touch the file.
 * Everything else on the page exists to set that up or to explain how to run
 * the same thing on their own images.
 *
 * Copy discipline lives in brand.md. Short version: plain words, benefit
 * before mechanism, no dash characters, and the technical vocabulary stays in
 * the docs. runAssay() still executes the shipped measurement code at build
 * time, and its invariants fail the build rather than let this page ship a
 * stale claim.
 */

/** The three things that actually go wrong with images on real sites. */
const PROBLEMS = [
  {
    title: 'It was already squashed once',
    body:
      'An upload gets compressed by the CMS, then again by a build step, then again by whoever ' +
      'ran a bulk optimizer last year. Every pass takes something and none of them give it back. ' +
      'The usual tools cannot tell, so they squash it again.',
    fix: 'cupel checks the file first and stops when there is nothing safe left to take.',
  },
  {
    title: 'It is far bigger than the space it sits in',
    body:
      'A 4000 pixel wide photo in a box 400 pixels wide sends about a hundred times more data ' +
      'than the screen can use. This is the single most common reason pages are heavy, and it is ' +
      'invisible when you look at the page.',
    fix: 'cupel compares what the file carries against what the layout asks for.',
  },
  {
    title: 'It is in the wrong format',
    body:
      'PNG is built for logos, screenshots, and flat graphics. Save a photograph as PNG and it ' +
      'stores every speck of grain perfectly, which is why a photo can end up ten times larger ' +
      'than it needs to be.',
    fix: 'Try the third sample above. That one saves more than 90 percent.',
  },
]

/**
 * The two routes into the same code. The browser one comes first on purpose:
 * a terminal is a hard requirement for most of the audience, and everything
 * measured in the browser is measured by the code the CLI ships (core is
 * platform neutral, see the architecture notes), so the browser route is a
 * real answer rather than a toy version of one.
 */
const WAYS = [
  {
    tag: 'Nothing to install',
    title: 'In your browser',
    body:
      'Your image is read in the tab you are looking at. There is no upload, no account, and no ' +
      'server doing the work.',
    points: [
      'Run a full quality sweep on your own image in the playground, and see every format and every quality step plotted against the original.',
      'Check a record someone hands you against the files it describes, without installing cupel.',
      'Good for deciding whether cupel is worth your time, and for settling an argument about one image.',
    ],
    actions: [
      { href: '/playground', label: 'Open the playground', primary: true },
      { href: '/verify', label: 'Check a record', primary: false },
    ],
  },
  {
    tag: 'For whole folders',
    title: 'On your machine',
    body:
      'The same measurements, pointed at a directory instead of one file, with the part that ' +
      'writes files behind a flag.',
    points: [
      'Audit hundreds of images at once and get a row per file, without changing anything.',
      'Write the smaller versions when you are ready, keeping every original and a receipt for each decision.',
      'Refuses to write into a folder with uncommitted changes, because a receipt needs a known starting point.',
    ],
    actions: [
      { href: '#steps', label: 'See the commands', primary: false },
      { href: '/docs/getting-started', label: 'Read the docs', primary: false },
    ],
  },
]

/**
 * Numbered because this genuinely is a sequence: you install it, then you
 * look without touching anything, then you let it write.
 */
const STEPS = [
  {
    heading: 'Get it',
    body:
      'There is no npm package yet, so for now you build it from source. Node 20 or newer and ' +
      'pnpm 10.',
    command:
      'git clone https://github.com/Gabriel-Dalton/cupel\ncd cupel\npnpm install\npnpm build',
    copyLabel: 'the setup commands',
    note: 'Everything after this runs on your machine. Nothing is sent anywhere.',
  },
  {
    heading: 'Look before you touch',
    body:
      'Point it at a folder of images. It reads them, tells you what it found, and writes nothing ' +
      'at all. This is the command to run first, and it is safe to run on anything.',
    command: 'node packages/cli/bin/cupel.js audit ./public',
    copyLabel: 'the audit command',
    note:
      'You get a row per image: how big it is, how much quality is left, and which files it would ' +
      'refuse to touch.',
  },
  {
    heading: 'Let it write, and keep the receipt',
    body:
      'Still a dry run by default. Add the apply flag and it writes the new files, keeps a copy ' +
      'of every original, and records what it did. It refuses to run on a folder with ' +
      'uncommitted changes unless you insist, because a receipt only means something against a ' +
      'known starting point.',
    command:
      'node packages/cli/bin/cupel.js write ./public\nnode packages/cli/bin/cupel.js write ./public --apply',
    copyLabel: 'the write commands',
    note: 'Then run verify to have it re-check its own numbers against the files on disk.',
  },
]

/**
 * Kept in step with ROADMAP.md, which is the file that tracks reality against
 * the specification. Two rows are still honest "not yet": page level allocation
 * (M5, the math ships and nothing calls it with a real budget) and source
 * recovery (M7, the recoverers are tested but the writer does not use them).
 * Everything above them is implemented and tested, so the list now leads with
 * that instead of apologising.
 */
const STATUS = [
  { label: 'Trying it on your own image with nothing installed', state: 'done' as const },
  { label: 'Reading a file and telling you what it found', state: 'done' as const },
  { label: 'Refusing files with nothing left to give', state: 'done' as const },
  { label: 'Auditing a folder, or a live page by its URL', state: 'done' as const },
  { label: 'Writing smaller files, with receipts', state: 'done' as const },
  { label: 'Checking those receipts in a browser', state: 'done' as const },
  { label: 'Running that audit from this site instead of a terminal', state: 'part' as const },
  { label: 'Spending one budget across a whole page', state: 'soon' as const },
  { label: 'Finding the better original your pipeline buried', state: 'soon' as const },
]

const STATE_LABEL = { done: 'working now', part: 'partly done', soon: 'being built' }
const STATE_CLASS = {
  done: 'badge badge--done',
  part: 'badge badge--now',
  soon: 'badge badge--next',
}

export default function Home() {
  const assay = runAssay()

  return (
    <>
      <section className="hero">
        <div className="shell hero__inner">
          <p className="eyebrow eyebrow--accent">Free and open source</p>
          <h1 className="hero__title">Make your images smaller without making them worse.</h1>
          <p className="hero__lede">
            cupel looks at a picture, works out how much quality it actually has left, and only
            removes what it can remove safely. When a file has nothing left to give, it stops and
            tells you why instead of quietly wrecking it.
          </p>
          <div className="hero__actions">
            <a className="btn btn--primary" href="#try">
              Try it on a photo
            </a>
            <Link className="btn" href="/playground">
              Use your own image
            </Link>
            <Link className="btn" href="/docs/getting-started">
              Read the docs
            </Link>
          </div>
          <p className="hero__meta">
            Works in your browser with nothing to install, or on your own machine. Never writes a
            file unless you ask it to.
          </p>
        </div>
      </section>

      <section className="section section--try" id="try" aria-labelledby="try-heading">
        <div className="shell">
          <p className="eyebrow">Try it</p>
          <h2 className="section__title" id="try-heading">
            Pick a picture and watch it decide.
          </h2>
          <p className="section__lede">
            This is the real thing, running in your browser. The first photo has plenty of quality
            left, so it gets much smaller. The second is the same photo after a CMS already
            compressed it, and cupel will refuse to touch it. The third is a photo saved as a PNG,
            which is the biggest easy win there is.
          </p>
          <TryIt />
          <div className="next-step">
            <div className="next-step__text">
              <h3>Now try one of your own, properly.</h3>
              <p>
                The playground takes any image you drop on it and runs the whole thing: every
                format, every quality step, each one measured against your original and plotted so
                you can see where spending more bytes stops buying anything. Same code, your image,
                still nothing uploaded.
              </p>
            </div>
            <Link className="btn btn--primary" href="/playground">
              Open the playground
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="problems-heading">
        <div className="shell">
          <p className="eyebrow">Why bother</p>
          <h2 className="section__title" id="problems-heading">
            Three things quietly making your pages heavy.
          </h2>
          <div className="problems">
            {PROBLEMS.map((problem) => (
              <article key={problem.title} className="problem">
                <h3>{problem.title}</h3>
                <p>{problem.body}</p>
                <p className="problem__fix">{problem.fix}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="ways-heading">
        <div className="shell">
          <p className="eyebrow">Two ways to use it</p>
          <h2 className="section__title" id="ways-heading">
            You do not have to open a terminal to use this.
          </h2>
          <p className="section__lede">
            The measuring code has no idea where it is running, so the browser and the command line
            give the same answers on the same image. Start wherever suits you.
          </p>
          <div className="ways">
            {WAYS.map((way) => (
              <article key={way.title} className="way">
                <p className="badge badge--now">{way.tag}</p>
                <h3>{way.title}</h3>
                <p>{way.body}</p>
                <ul className="way__list">
                  {way.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className="way__actions">
                  {way.actions.map((action) =>
                    action.href.startsWith('#') ? (
                      <a
                        key={action.href}
                        className={action.primary ? 'btn btn--primary' : 'btn'}
                        href={action.href}
                      >
                        {action.label}
                      </a>
                    ) : (
                      <Link
                        key={action.href}
                        className={action.primary ? 'btn btn--primary' : 'btn'}
                        href={action.href}
                      >
                        {action.label}
                      </Link>
                    ),
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--steps" id="steps" aria-labelledby="steps-heading">
        <div className="shell">
          <p className="eyebrow">How to use it</p>
          <h2 className="section__title" id="steps-heading">
            Three commands, in this order.
          </h2>
          <p className="section__lede">
            This is the machine route. The order matters: the first two cannot change a single file,
            so you can see exactly what would happen before anything does. Every block has a copy
            button, so none of it needs retyping.
          </p>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.heading} className="step">
                <span className="step__num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="step__body">
                  <h3>{step.heading}</h3>
                  <p>{step.body}</p>
                  <CommandBlock command={step.command} describes={step.copyLabel} />
                  <p className="step__note">{step.note}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="receipts-heading">
        <div className="shell">
          <p className="eyebrow">Receipts</p>
          <h2 className="section__title" id="receipts-heading">
            You do not have to take our word for any of it.
          </h2>
          <p className="section__lede">
            Every change cupel makes gets recorded along with the numbers behind it. You can hand
            that record and the files to anyone, and they can recheck the whole thing in a browser
            without installing cupel at all. If a record does not match the file it describes, the
            check says so plainly rather than passing quietly.
          </p>
          <div className="hero__actions">
            <Link className="btn" href="/verify">
              Check a record
            </Link>
            <Link className="btn" href="/playground">
              Measure your own image
            </Link>
          </div>
        </div>
      </section>

      <section className="section section--muted" aria-labelledby="measure-heading">
        <div className="shell">
          <p className="eyebrow">How it checks</p>
          <h2 className="section__title" id="measure-heading">
            Four ways an image can be damaged, and how each one shows up.
          </h2>
          <p className="section__lede">
            The numbers below are not written into this page. When the site is built, it generates a
            clean test image, damages it four different ways, and measures each one with the same
            code the tool uses. If a result ever stopped proving the point, the build would fail
            instead of publishing a claim that is no longer true.
          </p>
          <div className="table-scroll">
            <table className="ledger">
              <caption className="ledger__caption">
                Measured at build time. A clean image scored against itself gives exactly{' '}
                {assay.selfStructure}, because identical files have to measure identical.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Damage</th>
                  <th scope="col">What was done</th>
                  <th scope="col">Reading</th>
                  <th scope="col">Clean image</th>
                  <th scope="col">What it tells you</th>
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
          <p className="section__note">
            The exact definitions, the proper names, and the known blind spots of every measurement
            are in <Link href="/docs/metrics">the docs</Link>.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="status-heading">
        <div className="shell">
          <p className="eyebrow">Where it stands</p>
          <h2 className="section__title" id="status-heading">
            Most of this works today. Here is the part that does not.
          </h2>
          <p className="section__lede">
            Measuring, refusing, auditing, writing, and checking receipts are all built and covered
            by tests you can run yourself. Two pieces are still landing, and they stay on this list
            until they are done, because a tool whose whole point is telling you the truth about
            your files should tell you the truth about itself.
          </p>
          <ul className="status">
            {STATUS.map((item) => (
              <li key={item.label} className="status__row">
                <span>{item.label}</span>
                <span className={STATE_CLASS[item.state]}>{STATE_LABEL[item.state]}</span>
              </li>
            ))}
          </ul>
          <p className="section__note">
            The full detail, including a list of the rough edges we already know about, is in the{' '}
            <Link href="/docs/roadmap">roadmap</Link>.
          </p>
        </div>
      </section>

      <section className="section section--cta" aria-labelledby="cta-heading">
        <div className="shell">
          <h2 className="section__title" id="cta-heading">
            Try it on your own images.
          </h2>
          <p className="section__lede">
            Quickest start is the playground: drop one image in, watch it get measured, keep the
            result. When you want it across a whole folder, the audit command reads everything,
            tells you what it found, and cannot change a thing.
          </p>
          <div className="hero__actions">
            <Link className="btn btn--primary" href="/playground">
              Open the playground
            </Link>
            <Link className="btn" href="/docs/getting-started">
              Get started with the commands
            </Link>
            <a className="btn" href="https://github.com/Gabriel-Dalton/cupel">
              Source on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
