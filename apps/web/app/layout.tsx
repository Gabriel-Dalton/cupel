import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { NavLink } from '../components/nav-link'
import './globals.css'

// Fonts are downloaded at build time and self hosted by next/font. The
// running site makes no external requests.
const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'],
})

const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'cupel: assay before you compress',
    template: '%s · cupel',
  },
  description:
    'An open source image toolchain that measures the quality a source image has left, spends a byte budget only where it buys visible fidelity, and refuses to damage what cannot recover. The measurement layer ships today; the rest is built in the open.',
}

/** The cupel itself: a shallow assay dish holding the recovered bead. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 10.5h17c0 3.5-2.5 8-8.5 8s-8.5-4.5-8.5-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="8" r="2.1" fill="currentColor" />
    </svg>
  )
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="shell site-header__row">
            <Link href="/" className="brand">
              <Mark />
              cupel
            </Link>
            <nav className="site-nav" aria-label="Site">
              <NavLink href="/docs">Docs</NavLink>
              <NavLink href="/playground">Playground</NavLink>
              <NavLink href="/corpus">Corpus</NavLink>
              <a href="https://github.com/Gabriel-Dalton/cupel">GitHub</a>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="shell site-footer__row">
            <p>
              Code Apache-2.0. The image corpus, when it lands, CC BY 4.0. Pre-release, built in the
              open.
            </p>
            <p>
              <Link href="/docs">Docs</Link> · <Link href="/docs/roadmap">Roadmap</Link> ·{' '}
              <a href="https://github.com/Gabriel-Dalton/cupel">Source</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
