import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { docPages, findDoc } from '../../../lib/docs'

type Props = {
  params: Promise<{ slug?: string[] }>
}

/** Every docs page is statically rendered from the registry; nothing else exists. */
export const dynamicParams = false

export function generateStaticParams(): { slug: string[] }[] {
  return docPages.map((page) => ({
    slug: page.slug === '' ? [] : page.slug.split('/'),
  }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const doc = findDoc(slug)
  if (!doc) return {}
  return {
    title: doc.slug === '' ? 'Docs' : doc.title,
    description: doc.description,
  }
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params
  const doc = findDoc(slug)
  if (!doc) notFound()
  const { default: Content } = await doc.load()
  return (
    <article className="prose">
      <Content />
    </article>
  )
}
