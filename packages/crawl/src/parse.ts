import type { DiscoveredAsset } from '@cupel/core'
import { HTMLElement, parse as parseDocument } from 'node-html-parser'

/**
 * Static HTML discovery: <img> (src, srcset, picture sources), inline
 * style background-image, and background-image rules in same-document
 * <style> blocks with simple selectors. This is a parse of the markup,
 * not a render; anything a browser computes at layout time (responsive
 * selection, JS driven sizing, external stylesheets) is out of scope and
 * the caller reports that assumption (BRIEF section 15).
 */

export type FoundKind = 'img' | 'background'

/** Raw sizing evidence collected during the parse, resolved later by dims.ts. */
export type SizingInputs = {
  /** width/height attributes on <img>, positive integers only. */
  attrWidth?: number
  attrHeight?: number
  /** Effective CSS declarations: matched <style> rules, inline style winning. */
  css: Record<string, string>
}

export type FoundAsset = {
  asset: DiscoveredAsset
  kind: FoundKind
  /** True for loading="lazy" images; backgrounds are never lazy. */
  lazy: boolean
  sizing: SizingInputs
  /** 0-based position among discovered assets, in document order. */
  documentIndex: number
}

export type SrcsetCandidate = { url: string; descriptor: string }

/** Parses an HTML document into discovered assets, in document order. */
export function parseHtml(html: string, pageUrl: string): FoundAsset[] {
  const root = parseDocument(html)
  const rules = parseStyleRules(collectStyleText(root))
  const found: FoundAsset[] = []

  walkElements(root, (el) => {
    const item =
      tagOf(el) === 'img' ? discoverImg(el, rules, pageUrl) : discoverBackground(el, rules, pageUrl)
    if (item !== undefined) found.push({ ...item, documentIndex: found.length })
  })

  return found
}

/**
 * Parses a srcset attribute into resolved candidates, largest first: width
 * descriptors before density descriptors (an absolute width is stronger
 * "largest" evidence than a density multiplier), each group descending.
 * data: URIs and malformed descriptors are dropped; a missing descriptor
 * means 1x per the HTML spec.
 */
export function parseSrcset(srcset: string, baseUrl: string): SrcsetCandidate[] {
  type Parsed = SrcsetCandidate & { unit: 'w' | 'x'; value: number }
  const parsed: Parsed[] = []

  // Spec-shaped tokenizer rather than a comma split, because commas are
  // legal inside data: URIs and legal as trailing separators.
  let pos = 0
  while (pos < srcset.length) {
    while (pos < srcset.length && /[\s,]/.test(srcset[pos]!)) pos++
    let start = pos
    while (pos < srcset.length && !/\s/.test(srcset[pos]!)) pos++
    let url = srcset.slice(start, pos)
    if (url === '') break

    let descriptorRaw = ''
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '')
    } else {
      while (pos < srcset.length && /\s/.test(srcset[pos]!)) pos++
      start = pos
      while (pos < srcset.length && srcset[pos] !== ',') pos++
      descriptorRaw = srcset.slice(start, pos).trim()
      pos++
    }

    if (url === '' || isDataUri(url)) continue
    const descriptor = parseDescriptor(descriptorRaw)
    if (descriptor === undefined) continue
    const resolved = resolveUrl(url, baseUrl)
    if (resolved === undefined) continue
    parsed.push({ url: resolved, ...descriptor })
  }

  parsed.sort((a, b) => unitRank(a.unit) - unitRank(b.unit) || b.value - a.value)

  const seen = new Set<string>()
  return parsed
    .filter((c) => {
      const key = `${c.url} ${c.descriptor}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((c) => ({ url: c.url, descriptor: c.descriptor }))
}

function unitRank(unit: 'w' | 'x'): number {
  return unit === 'w' ? 0 : 1
}

function parseDescriptor(
  raw: string,
): { descriptor: string; unit: 'w' | 'x'; value: number } | undefined {
  if (raw === '') return { descriptor: '1x', unit: 'x', value: 1 }
  const m = /^(\d+(?:\.\d+)?)(w|x)$/.exec(raw)
  if (m === null || m[1] === undefined) return undefined
  const value = Number(m[1])
  if (!(value > 0)) return undefined
  return { descriptor: raw, unit: m[2] === 'w' ? 'w' : 'x', value }
}

// --- element discovery ---------------------------------------------------

function discoverImg(
  el: HTMLElement,
  rules: StyleRule[],
  pageUrl: string,
): Omit<FoundAsset, 'documentIndex'> | undefined {
  const src = el.getAttribute('src')?.trim() ?? ''
  const srcset = parseSrcset(mergedSrcsetOf(el), pageUrl)

  // A usable URL is the resolved src, or failing that the largest srcset
  // candidate (an <img srcset> without src is valid and common in <picture>).
  const fromSrc = src !== '' && !isDataUri(src) ? resolveUrl(src, pageUrl) : undefined
  const url = fromSrc ?? srcset[0]?.url
  if (url === undefined) return undefined

  const attrWidth = positiveInt(el.getAttribute('width'))
  const attrHeight = positiveInt(el.getAttribute('height'))

  const asset: DiscoveredAsset = { url, referrerPage: pageUrl }
  if (attrWidth !== undefined) asset.declaredWidth = attrWidth
  if (attrHeight !== undefined) asset.declaredHeight = attrHeight
  if (srcset.length > 0) asset.srcset = srcset

  return {
    asset,
    kind: 'img',
    lazy: el.getAttribute('loading')?.trim().toLowerCase() === 'lazy',
    sizing: { attrWidth, attrHeight, css: effectiveCss(el, rules) },
  }
}

/**
 * The srcset evidence for an <img>: its own attribute plus, inside a
 * <picture>, every sibling <source> srcset. Concatenated and parsed as one
 * list so "largest first" holds across the whole picture element.
 */
function mergedSrcsetOf(el: HTMLElement): string {
  const parts: string[] = []
  const parent = el.parentNode as HTMLElement | null
  if (parent !== null && tagOf(parent) === 'picture') {
    for (const child of parent.childNodes) {
      if (child instanceof HTMLElement && tagOf(child) === 'source') {
        const s = child.getAttribute('srcset')
        if (s !== undefined && s.trim() !== '') parts.push(s)
      }
    }
  }
  const own = el.getAttribute('srcset')
  if (own !== undefined && own.trim() !== '') parts.push(own)
  return parts.join(', ')
}

function discoverBackground(
  el: HTMLElement,
  rules: StyleRule[],
  pageUrl: string,
): Omit<FoundAsset, 'documentIndex'> | undefined {
  const css = effectiveCss(el, rules)
  // Cascade per property: an inline background-image (even a gradient)
  // overrides a matched rule's, which is why the lookup happens on the
  // merged declarations rather than on each source in turn.
  const value = css['background-image'] ?? css['background']
  if (value === undefined) return undefined
  const raw = extractCssUrl(value)
  if (raw === undefined || isDataUri(raw)) return undefined
  const url = resolveUrl(raw, pageUrl)
  if (url === undefined) return undefined

  return {
    asset: { url, referrerPage: pageUrl },
    kind: 'background',
    lazy: false,
    sizing: { css },
  }
}

/** Matched <style> rule declarations merged in source order, inline style last. */
function effectiveCss(el: HTMLElement, rules: StyleRule[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const rule of rules) {
    if (selectorMatches(rule.selector, el)) Object.assign(merged, rule.declarations)
  }
  Object.assign(merged, parseDeclarations(el.getAttribute('style') ?? ''))
  return merged
}

// --- same-document CSS ---------------------------------------------------

/**
 * Simple selectors only: one tag, one class, or one id. Anything with
 * combinators, pseudo-classes, or attribute parts is skipped, because a
 * static parse cannot evaluate it honestly.
 */
type SimpleSelector = { kind: 'tag' | 'class' | 'id'; name: string }

type StyleRule = { selector: SimpleSelector; declarations: Record<string, string> }

const TAG_SELECTOR_RE = /^[a-z][a-z0-9-]*$/i
const CLASS_SELECTOR_RE = /^\.([_a-z][\w-]*)$/i
const ID_SELECTOR_RE = /^#([_a-z][\w-]*)$/i

function collectStyleText(root: HTMLElement): string {
  const parts: string[] = []
  walkElements(root, (el) => {
    if (tagOf(el) === 'style') parts.push(el.textContent)
  })
  return parts.join('\n')
}

/**
 * A tolerant flat CSS scan. At-rules are skipped entirely, including
 * everything inside their blocks: a rule under @media is viewport
 * conditional and must not contribute assets or sizing.
 */
function parseStyleRules(cssText: string): StyleRule[] {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules: StyleRule[] = []
  let pos = 0

  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++
    if (pos >= text.length) break

    if (text[pos] === '@') {
      pos = skipAtRule(text, pos)
      continue
    }

    const braceOpen = text.indexOf('{', pos)
    if (braceOpen === -1) break
    const braceClose = findBalancedClose(text, braceOpen)
    const selectorList = text.slice(pos, braceOpen)
    const declarations = parseDeclarations(text.slice(braceOpen + 1, braceClose))
    pos = braceClose + 1

    for (const raw of selectorList.split(',')) {
      const selector = parseSimpleSelector(raw.trim())
      if (selector !== undefined) rules.push({ selector, declarations })
    }
  }

  return rules
}

/** Skips "@name ...;" and "@name ... { ... }" forms, nested blocks included. */
function skipAtRule(text: string, pos: number): number {
  while (pos < text.length && text[pos] !== ';' && text[pos] !== '{') pos++
  if (pos >= text.length) return text.length
  if (text[pos] === ';') return pos + 1
  return findBalancedClose(text, pos) + 1
}

/** Index of the '}' closing the '{' at `open`, or end of text. */
function findBalancedClose(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return text.length
}

function parseSimpleSelector(selector: string): SimpleSelector | undefined {
  const cls = CLASS_SELECTOR_RE.exec(selector)
  if (cls?.[1] !== undefined) return { kind: 'class', name: cls[1] }
  const id = ID_SELECTOR_RE.exec(selector)
  if (id?.[1] !== undefined) return { kind: 'id', name: id[1] }
  if (TAG_SELECTOR_RE.test(selector)) return { kind: 'tag', name: selector.toLowerCase() }
  return undefined
}

function selectorMatches(selector: SimpleSelector, el: HTMLElement): boolean {
  switch (selector.kind) {
    case 'tag':
      return tagOf(el) === selector.name
    case 'class':
      return classListOf(el).includes(selector.name)
    case 'id':
      return el.getAttribute('id') === selector.name
  }
}

function classListOf(el: HTMLElement): string[] {
  const attr = el.getAttribute('class')
  if (attr === undefined) return []
  return attr.split(/\s+/).filter((c) => c !== '')
}

/** "prop: value; prop: value" into a record with lowercased property names. */
function parseDeclarations(styleText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of styleText.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (property !== '' && value !== '') out[property] = value
  }
  return out
}

// --- shared helpers ------------------------------------------------------

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')][^)]*))\s*\)/i

/** The first url(...) token in a CSS value, unquoted; gradients yield none. */
function extractCssUrl(value: string): string | undefined {
  const m = CSS_URL_RE.exec(value)
  if (m === null) return undefined
  const raw = (m[1] ?? m[2] ?? m[3])?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

function isDataUri(url: string): boolean {
  return url.trim().toLowerCase().startsWith('data:')
}

function resolveUrl(raw: string, baseUrl: string): string | undefined {
  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return undefined
  }
}

function positiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return n > 0 ? n : undefined
}

function tagOf(el: HTMLElement): string {
  return el.rawTagName?.toLowerCase() ?? ''
}

/** Pre-order walk over element nodes, which is document order. */
function walkElements(node: HTMLElement, visit: (el: HTMLElement) => void): void {
  for (const child of node.childNodes) {
    if (child instanceof HTMLElement) {
      visit(child)
      walkElements(child, visit)
    }
  }
}
