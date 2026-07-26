/**
 * Corpus manifest entry. license and source are REQUIRED and CI fails if
 * either is missing: getting sloppy here poisons the most valuable asset
 * in the project (BRIEF section 11). Corpus content is CC BY 4.0; every
 * entry must be CC0, public domain, or signed over by a contributor.
 */
export type CorpusLicense = 'CC0' | 'public-domain' | 'contributor-assigned'

export type CorpusEntry = {
  id: string
  file: string
  license: CorpusLicense
  /** Where the image came from: URL, photographer credit, or statement. */
  source: string
  /** Freeform tags: 'photo', 'screenshot', 'illustration', 'upscaled', ... */
  tags: string[]
  /** Optional human perceptual judgments accumulated over time. */
  judgments?: { pairId: string; preferred: 'a' | 'b' | 'tie'; note?: string }[]
}

export type CorpusManifest = {
  v: 1
  entries: CorpusEntry[]
}
