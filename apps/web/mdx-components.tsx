import type { MDXComponents } from 'mdx/types'

/**
 * Required by @next/mdx in the App Router. MDX output stays plain HTML
 * elements; all styling comes from the .prose class in globals.css, so the
 * docs never fork from the site's token system.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components }
}
