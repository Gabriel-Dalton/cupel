import type { MDXComponents } from 'mdx/types'
import type { ComponentPropsWithoutRef } from 'react'
import { DocCode } from './components/doc-code'

/**
 * Required by @next/mdx in the App Router. MDX output stays plain HTML
 * elements; all styling comes from the .prose class in globals.css, so the
 * docs never fork from the site's token system.
 *
 * Two elements are overridden, both for reasons the plain element cannot
 * cover:
 *
 * - `pre` gains a copy button, because the docs are mostly commands and
 *   nobody should be retyping them.
 * - `table` gets a scroll container, because a table with five columns of
 *   package names cannot reflow, and without this the whole page scrolls
 *   sideways on a phone instead of just the table.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    pre: DocCode,
    table: (props: ComponentPropsWithoutRef<'table'>) => (
      <div className="prose__table" tabIndex={0}>
        <table {...props} />
      </div>
    ),
  }
}
