import type { MDXContent } from 'mdx/types'

/**
 * The docs registry. One ordered list drives the sidebar, the static params,
 * and the per-page metadata, so a page cannot exist without appearing in
 * navigation or vice versa. Content lives in content/docs as MDX and is
 * imported as a module, keeping the whole docs tree statically rendered.
 */

export type DocPage = {
  /** URL path under /docs. Empty string is the index. */
  slug: string
  /** Sidebar and metadata title. */
  title: string
  /** Metadata description. */
  description: string
  load: () => Promise<{ default: MDXContent }>
}

export const docPages: DocPage[] = [
  {
    slug: '',
    title: 'Overview',
    description:
      'What cupel is, the two behaviours it will never drop, and where the name comes from.',
    load: () => import('../content/docs/index.mdx'),
  },
  {
    slug: 'getting-started',
    title: 'Getting started',
    description:
      'Run the toolchain from a clone today: requirements, workspace layout, and a first measurement.',
    load: () => import('../content/docs/getting-started.mdx'),
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    description:
      'Why @cupel/core has zero platform dependencies and how codecs are injected through the Encoder interface.',
    load: () => import('../content/docs/architecture.mdx'),
  },
  {
    slug: 'metrics',
    title: 'Metrics',
    description:
      'What each of the five measurements computes, why it exists, and where it is blind.',
    load: () => import('../content/docs/metrics.mdx'),
  },
  {
    slug: 'roadmap',
    title: 'Roadmap',
    description: 'Milestones M0 through M8: what is done, what is in progress, what is promised.',
    load: () => import('../content/docs/roadmap.mdx'),
  },
]

export function findDoc(slugSegments: string[] | undefined): DocPage | undefined {
  const slug = (slugSegments ?? []).join('/')
  return docPages.find((d) => d.slug === slug)
}
