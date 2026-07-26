/**
 * String-level URL surgery shared by the recoverers. Deliberately not the
 * WHATWG URL class: DiscoveredAsset.url may be a bare file path or a
 * site-relative path, and every recoverer must preserve the parts of the
 * URL it did not touch byte for byte (query order, encoding, fragments),
 * which a parse/serialize round trip does not guarantee.
 */

export type UrlParts = {
  /** Everything before the query and fragment. */
  path: string
  /** The query including its leading '?', or ''. */
  query: string
  /** The fragment including its leading '#', or ''. */
  hash: string
}

export function splitUrl(url: string): UrlParts {
  const hashIndex = url.indexOf('#')
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = beforeHash.indexOf('?')
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex)
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex)
  return { path, query, hash }
}

/** Splits a path into the directory (with trailing separator) and last segment. */
export function splitLastSegment(path: string): { dir: string; name: string } {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx === -1) return { dir: '', name: path }
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}

/** Splits a filename into stem and extension (extension keeps its dot). */
export function splitExtension(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf('.')
  // idx <= 0 covers "no dot" and dotfiles like ".htaccess".
  if (idx <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, idx), ext: name.slice(idx) }
}

export type QueryPair = {
  key: string
  value: string
  /** The undecoded key=value text, used to rebuild the query untouched. */
  raw: string
}

/** Parses a query string ('?a=1&b=2' or '') into ordered raw pairs. */
export function parseQueryPairs(query: string): QueryPair[] {
  if (query === '' || query === '?') return []
  return query
    .slice(1)
    .split('&')
    .filter((part) => part !== '')
    .map((raw) => {
      const eq = raw.indexOf('=')
      if (eq === -1) return { key: raw, value: '', raw }
      return { key: raw.slice(0, eq), value: raw.slice(eq + 1), raw }
    })
}

const ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i
const HOST_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i

/** 'https://host:port' for absolute URLs, '' for relative ones and paths. */
export function originOf(url: string): string {
  const m = ORIGIN_RE.exec(url)
  return m?.[0] ?? ''
}

/** Lowercased hostname for absolute URLs, '' otherwise. */
export function hostOf(url: string): string {
  const m = HOST_RE.exec(url)
  return m?.[1]?.toLowerCase() ?? ''
}

const IMAGE_EXT_RE = /\.(avif|gif|jpe?g|png|webp)$/i

/** True when the filename carries a raster image extension. */
export function hasImageExtension(name: string): boolean {
  return IMAGE_EXT_RE.test(name)
}
