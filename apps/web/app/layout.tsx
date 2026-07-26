import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Bricolage_Grotesque, Manrope } from 'next/font/google'
import { NavLink } from '../components/nav-link'
import './globals.css'

// Fonts are downloaded at build time and self hosted by next/font. The
// running site makes no external requests.
//
// Bricolage Grotesque for display: a grotesque with real character in the
// wide weights, which keeps headlines from reading as another neutral tech
// sans. Manrope for body and data: friendly, geometric, and it has proper
// tabular figures, which is what lets this site show aligned numbers without
// a monospaced face anywhere (see brand.md section 7).
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
})

const body = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'cupel: make images smaller without making them worse',
    template: '%s · cupel',
  },
  description:
    'An open source image tool that checks how much quality a picture actually has left, removes only what it can remove safely, and refuses to touch files that have nothing left to give. Try it in your browser, nothing is uploaded.',
}

/**
 * The mark is the product: one picture, two states. A frame split down the
 * diagonal, the original on one side and the smaller version on the other.
 * It reads at 20px, which the previous dish-and-bead drawing did not, and it
 * needs no explanation about metallurgy.
 */
function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="brand__mark"
    >
      <rect
        x="2.25"
        y="3.75"
        width="19.5"
        height="16.5"
        rx="3.25"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {/* The compressed half, in the verdict green. */}
      <path
        d="M20 5.4v13.1a1.75 1.75 0 0 1-1.75 1.75H8.2L19.1 4.9c.35.1.66.28.9.5Z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Sun and hill: the universal "this is a picture" glyph. */}
      <circle cx="8.1" cy="9.1" r="1.6" fill="currentColor" opacity="0.45" />
      <path
        d="M3.1 17.4 6.6 13l2.8 3.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </svg>
  )
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
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
              <NavLink href="/verify">Verify</NavLink>
              <NavLink href="/corpus">Corpus</NavLink>
              <a href="https://github.com/Gabriel-Dalton/cupel">GitHub</a>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="shell site-footer__row">
            <p>
              Free and open source, Apache-2.0. Still pre-release, built in the open. The name comes
              from a small dish used to test what a metal sample is really worth, which is the same
              idea: test first, then decide.
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
