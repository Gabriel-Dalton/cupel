import type { SourceRecoverer } from './types.js'
import { wordpressRecoverer } from './wordpress.js'
import { nextjsRecoverer } from './nextjs.js'
import { shopifyRecoverer } from './shopify.js'
import { cdnRecoverer } from './cdn.js'
import { srcsetRecoverer } from './srcset.js'
import { retinaRecoverer } from './retina.js'
import { gitHistoryRecoverer } from './git-history.js'

export type { SourceCandidate, SourceRecoverer } from './types.js'
export { wordpressRecoverer } from './wordpress.js'
export { nextjsRecoverer } from './nextjs.js'
export { shopifyRecoverer } from './shopify.js'
export { cdnRecoverer } from './cdn.js'
export { srcsetRecoverer } from './srcset.js'
export { retinaRecoverer } from './retina.js'
export { createGitHistoryRecoverer, gitHistoryRecoverer } from './git-history.js'
export type { GitRunner } from './git-history.js'

/**
 * Every shipped recoverer, in proposal order: platform-specific rewrites
 * first (they decode a known URL scheme, so their candidates are the most
 * likely to verify), then the generic markup and filesystem heuristics.
 * Callers filter with match() and merge the propose() results; candidates
 * are only proposals until core's verification phase accepts them.
 */
export const allRecoverers: readonly SourceRecoverer[] = [
  wordpressRecoverer,
  nextjsRecoverer,
  shopifyRecoverer,
  cdnRecoverer,
  srcsetRecoverer,
  retinaRecoverer,
  gitHistoryRecoverer,
]
