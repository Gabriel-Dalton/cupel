import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'cupel',
  description:
    'Assay before you compress. An open source image toolchain that treats a page’s image weight as a budget to allocate, not a set of files to shrink.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          backgroundColor: '#0d0e10',
          color: '#e8e6e1',
        }}
      >
        {children}
      </body>
    </html>
  )
}
