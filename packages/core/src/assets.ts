/**
 * The shared shape of "an image we found somewhere" as it flows between
 * the crawler (which discovers it), the recoverers (which propose better
 * originals for it), and the decision layer. Kept deliberately loose in
 * v1; fields are added as milestones need them, never repurposed.
 */
export type AssetRole = 'lcp' | 'content' | 'decorative'

export type DiscoveredAsset = {
  /** Absolute URL for remote assets, or a file path for local ones. */
  url: string
  /** Set when the asset exists on the local filesystem. */
  localPath?: string
  /** The page the asset was discovered on, when crawled. */
  referrerPage?: string
  bytes?: number
  contentType?: string
  /** Intrinsic pixel dimensions when known. */
  declaredWidth?: number
  declaredHeight?: number
  /** Rendered CSS dimensions from the crawl, when known. */
  displayWidthCssPx?: number
  displayHeightCssPx?: number
  aboveFold?: boolean
  role?: AssetRole
  /** Parsed srcset candidates, largest first, when present. */
  srcset?: { url: string; descriptor: string }[]
}
