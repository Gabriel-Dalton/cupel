'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * A nav link that reports the current location through aria-current, which
 * both the site header and the docs sidebar style. exact matches the whole
 * pathname; otherwise any pathname under href counts (so /docs/metrics
 * keeps Docs lit).
 */
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string
  exact?: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  )
}
