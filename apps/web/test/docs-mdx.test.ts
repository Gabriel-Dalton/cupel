// Guards for the docs rendering pipeline and the copy buttons.
//
// The architecture page shipped its package table as a paragraph of literal
// pipe characters, because @next/mdx parses CommonMark and pipe tables are a
// GFM extension. Three things have to hold for that not to happen again: the
// plugin is registered, the element overrides exist, and both the table and the
// code blocks come out wrapped the way the CSS expects.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommandBlock } from '../components/command-block'
import { useMDXComponents } from '../mdx-components'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

const components = useMDXComponents({})

describe('mdx pipeline', () => {
  it('registers remark-gfm, which is what makes pipe tables parse', async () => {
    const config = await readFile(new URL('../next.config.mjs', import.meta.url), 'utf8')
    expect(config).toMatch(/import remarkGfm from 'remark-gfm'/)
    expect(config).toMatch(/remarkPlugins:\s*\[remarkGfm\]/)
  })

  it('has a markdown table in the docs for the plugin to render', async () => {
    const doc = await readFile(new URL('../content/docs/architecture.mdx', import.meta.url), 'utf8')
    // A header row, the delimiter row, and at least one body row.
    expect(doc).toMatch(/^\| Package .*\n\| -+/m)
  })

  it('wraps doc tables in their own scroll container', () => {
    const table = components.table
    expect(table).toBeTypeOf('function')
    const html = renderToStaticMarkup(
      createElement(table as never, {
        children: createElement('tbody', null, createElement('tr', null)),
      }),
    )
    expect(html).toContain('class="prose__table"')
    expect(html).toContain('<table>')
    // Focusable, because the container is the thing that scrolls sideways.
    expect(html).toContain('tabindex="0"')
  })

  it('gives every doc code block a copy button without losing the code', () => {
    const pre = components.pre
    expect(pre).toBeTypeOf('function')
    const html = renderToStaticMarkup(
      createElement(pre as never, {
        children: createElement('code', null, 'pnpm build'),
      }),
    )
    expect(html).toContain('pnpm build')
    expect(html).toContain('class="copy"')
    expect(html).toContain('cmd-block')
  })
})

describe('command blocks', () => {
  it('renders the command as text and a labelled copy button', () => {
    const html = renderToStaticMarkup(
      createElement(CommandBlock, { command: 'cupel audit ./public', describes: 'the audit step' }),
    )
    expect(html).toContain('cupel audit ./public')
    expect(html).toContain('aria-label="Copy the audit step"')
  })

  it('is styled by tokens that exist', async () => {
    const css = await readFile(`${WEB_ROOT}app/globals.css`, 'utf8')
    for (const selector of ['.cmd-block', '.copy', '.prose__table', '.prose table']) {
      expect(css.includes(selector), `globals.css is missing ${selector}`).toBe(true)
    }
  })
})
