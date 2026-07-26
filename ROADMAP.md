# Roadmap

Where cupel actually is, what is next, and what is known to be wrong. `BRIEF.md`
is the full specification and does not change; this file tracks reality against
it and is the one to trust when the two disagree.

Last updated 2026-07-26.

## Status by milestone

|     | Milestone             | State        | What that means                                                                                                                                                                                                                                                                                      |
| --- | --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Skeleton              | done         | Monorepo, CI, licences, both codec adapters behind one `Encoder` interface, with a parity test holding them to 1e-6.                                                                                                                                                                                 |
| M1  | Measurement           | done         | SSIM, CIE76 deltaE, tiled Laplacian sharpness, 8x8 block boundary energy, radially averaged power spectrum with effective-resolution estimation. Platform-pure, enforced by ESLint in CI.                                                                                                            |
| M2  | Site and playground   | done         | Landing page, MDX docs, `/playground` (full sweep in a web worker, nothing uploaded), `/verify` (browser receipt checking), `/api/probe` with an SSRF-guarded fetch, rate limiter, and TTL cache.                                                                                                    |
| M3  | File history          | done         | `analyzeProvenance` plus `cupel inspect`: container, chroma subsampling, DQT-derived quality estimate, encoder fingerprint, double-quantization evidence, effective vs declared resolution, headroom verdict with its reasons.                                                                       |
| M4  | Auditor               | mostly done  | `cupel audit` works on a local directory (full pixel evidence) and on a URL (crawl for display dimensions, 64 kB ranged GETs, header-only evidence, every BRIEF 9.2 cap enforced and reported). The hosted `/audit` page and `/api/audit` endpoint are **not built**.                                |
| M5  | Allocator             | partial      | The math ships in `@cupel/core` (`allocate`, `lowerConvexHull`, `visualWeight`, lambda bisection) and is tested. Nothing calls it with a real page budget yet: `cupel write` decides per asset in single mode.                                                                                       |
| M6  | Writer and receipts   | done         | `cupel write` (dry run by default, `--apply` to touch anything, git guard, atomic writes, originals preserved) and `cupel verify`, in lockstep with the `/verify` page.                                                                                                                              |
| M7  | Source recovery       | library only | All seven recoverers exist and are tested in `@cupel/recover` (WordPress, Next.js, Shopify, generic CDN, srcset, retina siblings, git history), and `acceptRecoveredSource` in core verifies proposals. **Nothing wires them into `cupel write`**, so every receipt records `sourceRecovered: null`. |
| M8  | Corpus, action, skill | not started  | `@cupel/corpus` holds a manifest type and nothing else. No benchmark corpus, no GitHub Action, no Claude Code skill.                                                                                                                                                                                 |

## The two behaviours that will never be dropped

Both are implemented and tested, not aspirations:

1. cupel refuses to re-encode a source with no quality headroom left, and the
   refusal names its evidence. Verified end to end: a JPEG re-encoded seven
   times at low quality is refused, and the refusal costs nothing because it
   happens before the sweep.
2. cupel never writes without an explicit flag. `cupel write` is a dry run
   unless `--apply` is passed, and `--apply` refuses on a dirty git tree
   unless `--force` is passed too.

## Next, in the order worth doing

1. **Wire M7 into the writer.** The recoverers and the acceptance rule both
   exist; what is missing is the loop in `cupel write` that proposes
   candidates, verifies them with `acceptRecoveredSource`, and records the
   accepted swap in `sourceRecovered`. This is the single highest-value piece
   left, and it is what makes the four-pillar pitch on the landing page fully
   true.
2. **Hosted `/audit`.** The CLI audit engine is the reference implementation;
   the hosted flavour needs the route, the page, the permalink encoding, and
   the rate limiting composed from `apps/web/lib/net`, which already exists.
   Restore the `apps/web/app/api/audit/route.ts` entry in `vercel.json` when
   the route lands: it was removed because declaring a function that does not
   exist fails the Vercel build.
3. **Page-level allocation in the writer.** Give `cupel write` a page context
   (display dimensions from a crawl, above-the-fold estimation) so it can call
   `allocate` with one lambda across all assets instead of deciding each in
   isolation. The allocator is the differentiating idea and nothing currently
   exercises it on real input.
4. **Calibrate the guesses below against a corpus (M8).** Several constants are
   documented guesses; a benchmark corpus is what turns them into measurements.

## Known problems and honest caveats

These are real and currently shipping. None of them are hidden in the code:
each has a comment at the site of the guess.

- **The SSIM floors are uncalibrated** (issue #7). `DEFAULT_FLOORS` was written
  against standard SSIM's scale, and cupel uses an 8x8 window variant. Every
  encode/keep boundary moves when this is fixed.
- **Effective resolution over-reports upscaling on smooth synthetic content.**
  A 512x512 generated photograph measures an effective resolution of 32x32 and
  is flagged `upscaled`. Real photographs behave, but the spectral cutoff is
  clearly too aggressive on low-frequency content, and the calibration notes in
  `provenance/headroom.ts` predate it.
- **The laundered-PNG threshold fires on legitimate flat graphics.** A banded
  graphic whose edges land on 8-pixel boundaries scores a blocking ratio of 1.0
  and is refused as "laundered from a jpeg". The conservative direction is
  deliberate (a false laundered verdict refuses a healthy file rather than
  destroying one) but the false-positive rate is too high.
- **The recoverable-bytes estimate in `cupel audit` is a model, not a
  measurement.** Every coefficient in `audit/recoverable.ts` is a labelled
  guess. The output says so on every line it prints. `cupel write --dry-run`
  measures for real; only its numbers belong in an argument.
- **`LOW_HEADROOM_SSIM_MARGIN` (0.01) and the 5% effective-resolution tolerance
  band are invented**, not specified by BRIEF. Both are exported and pinned by
  tests so recalibration is a one-line change.
- **The 5% no-op threshold is a guess**, per BRIEF section 15.
- **Double-quantization detection is noisy by nature** and reports a confidence
  score. It never alone triggers a refusal, by design.
- **Display dimensions from a static crawl are approximate.** Responsive
  images, container queries, and JS-driven layout defeat it. The audit output
  states the assumed viewport every time.
- **`sharp` exposes no libwebp `exact` flag** (issue #5), so node-encoded
  lossless webp may rewrite RGB under fully transparent pixels. The wasm
  adapter preserves them.
- **The Laplacian softness verdict needs regime-aware calibration** (issue #4).
- **Cross-decoder reference hashes will differ between the CLI and the browser
  verifier.** The CLI decodes with sharp/libvips, `/verify` with jSquash wasm.
  Both re-derive the reference the same way, but a one-code-value IDCT
  difference changes the hash. This is handled, not ignored: the metrics are
  compared within documented tolerances and the verdict says the reference hash
  differed rather than claiming the file is wrong.

## Packaging notes

`cupel` is bundled with esbuild into a single `dist/main.js` (see
`packages/cli/build.mjs`). Every `@cupel/*` package publishes TypeScript source
rather than compiled output, which vitest and Next transpile on the fly but
plain Node cannot load; bundling resolves that at build time so the shipped CLI
runs on any Node 20+ with no loader. `sharp` stays external because it ships a
per-platform native binary, so it is a real runtime dependency of the CLI.

Nothing is published to npm yet.
