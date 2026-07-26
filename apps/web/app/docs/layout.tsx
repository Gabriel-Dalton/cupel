import type { ReactNode } from 'react'
import { NavLink } from '../../components/nav-link'
import { docPages } from '../../lib/docs'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell docs">
      <nav className="docs-nav" aria-label="Docs">
        <p className="docs-nav__title">Documentation</p>
        <ul>
          {docPages.map((page) => {
            const href = page.slug === '' ? '/docs' : `/docs/${page.slug}`
            return (
              <li key={page.slug}>
                <NavLink href={href} exact={page.slug === ''}>
                  {page.title}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
      <section>{children}</section>
    </div>
  )
}
