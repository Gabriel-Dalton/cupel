# cupel

> _Assay before you compress._

**On the name.** A cupel is the porous bone-ash vessel used in fire assay, the reference method for determining what a sample of ore is actually worth. You melt the sample in it; the base metals oxidize and are absorbed into the vessel walls, leaving behind a bead of pure precious metal whose weight tells you exactly what you had. Fire assay is still the method other methods are checked against.

That is the whole tool in one word. It determines what a source image is actually worth before deciding what to do with it, separates the part that carries value from the part that does not, and produces a result that can be independently checked. It is also a real technical term with a precise meaning rather than two English nouns glued together, which puts it in the register of `brotli`, `guetzli`, and `nginx` rather than the register of `smart-image-optimize`.

Five letters, easy to type, pronounced KYOO-pel. `cupel` and `@cupel/*` are both free on npm.

**Runners-up, both free on npm and both defensible** if you want a different flavour: `assize` (the medieval legal standard for weights and measures, and the court that enforced it; leans authoritative and fits the receipts angle) and `nonius` (the Latin name for the vernier scale, after Pedro Nunes; leans precision-instrument). Also free: `fineness`, `mordant`, `craquelure`, `foxing`, `titre`. Taken and unusable: `assay`, `assayer`, `touchstone`, `hallmark`, `latitude`, `gamut`, `vernier`, `pentimento`, `nyquist`, `tare`, `pare`, `frugal`, `thrift`.

To swap the name later: `rg -l cupel | xargs sed -i 's/cupel/newname/g'`. Do it before the first publish, not after.

---

## 1. What this is, in one paragraph

cupel is an open source image toolchain that treats a web page's image weight as a **budget to allocate** rather than a set of files to individually shrink. It measures the rate-distortion curve of every image on a page, detects how much quality headroom each source actually has left after its prior encoding history, and then solves for the allocation of bytes across all images that minimizes total perceived distortion. It refuses to touch files where re-encoding would only cost a generation of quality, it goes looking for better source files before it compresses, and it emits a verifiable receipt for every decision so the numbers can be audited later.

## 2. Why this is different, stated honestly

Quality-targeted encoding is not new. `imgmin` shipped SSIM-threshold quality search in 2012. Cloudinary `q_auto` has done perceptual-target encoding since roughly 2016. Squoosh had butteraugli-guided auto quality. imgix, ImageEngine, Vercel, Cloudflare Images, and Shopify all do a version of this at the CDN layer. **Per-image quality targeting is table stakes and must not be the pitch.**

Four things are genuinely unoccupied:

**1. Cross-asset allocation.** Every existing tool optimizes one image at a time and therefore cannot reason about the page. A flat SSIM 0.99 target gives a 120px avatar the same fidelity guarantee as a full-bleed hero, which is obviously wrong. Nobody solves the actual problem, which is page-level.

**2. Refusal as a first-class output.** No mainstream tool ever says "do nothing." Cloudinary will cheerfully re-encode an already-mangled JPEG for the fourth time and report a byte saving. A tool whose answer is sometimes "this source is spent, go find a better original" is unusual and useful.

**3. Encode provenance.** Nobody answers "what has already been done to this file?" A surprising amount is recoverable: JPEG quantization tables fingerprint the encoder and original quality, double-quantization signatures reveal re-encode generations, 8x8 block boundary energy survives format conversion and exposes PNGs that were laundered from JPEGs, and spectral rolloff reveals images upscaled past their real detail.

**4. Verifiable receipts.** Claims about fidelity are currently unfalsifiable. A signed, re-checkable ledger entry per asset is the thing that settles the argument when a designer says the photos look worse after the optimization pass.

### 2.1 Positioning all four without saying nothing

Leading with four differentiators normally means leading with none. It works here only if you write the single sentence that all four are clauses of, and let the four sections hang off that sentence rather than competing with it.

**The sentence:**

> Find the best surviving original, work out how much quality it has left, spend the page's byte budget where it buys the most, and leave a receipt anyone can check.

Four clauses, four pillars, in pipeline order. Nothing is subordinated, and nothing is mush, because the reader gets a coherent process rather than a feature list.

**The stance underneath it:** every other tool treats an image as a file to shrink. This one treats it as a sample to assay. That single reframe is what generates all four differentiators, and it is why the name carries weight rather than being decoration.

**README and landing page structure.** Do not write four sibling sections and hope the reader ranks them. Write:

1. The sentence above, as the hero.
2. A numbered "how it works" pipeline, four steps, each step being one pillar. This is where they are co-equal, because they are sequential rather than competing.
3. One short section per pillar, each opening with the concrete failure it prevents rather than the capability it provides. "Your build pipeline destroyed the originals two years ago and nobody noticed" lands harder than "source recovery."
4. A single terminal transcript showing a real run where the tool refuses to touch three files, recovers a better source for one, and reallocates the budget. One honest artifact outperforms four paragraphs of claims.

**Do not use a benchmark number as the hero.** Every tool in this space leads with a percentage and they are all unfalsifiable. Leading with the process instead of a number is itself differentiating, and it sets up the receipts pillar rather than undercutting it.

## 3. The core algorithm

### 3.1 Per-image sweep produces a curve, not a point

For image `i`, for each allowed format `f`, step through a quality ladder and record `(bytes, distortion)`. The original spec used one point off this curve and discarded the rest. That waste is the whole opportunity.

```
CandidatePoint = {
  format: 'webp' | 'avif' | 'jpeg' | 'png' | 'keep-original'
  quality: number | null        // null for lossless / keep
  bytes: number
  ssim: number
  deltaE: number                // mean CIE76 against reference
  distortion: number            // derived, see 3.3
  encoder: string               // 'sharp@0.34/libwebp@1.4' etc
}
```

Ladder: `q = 40, 45, ... 95` plus a lossless point where applicable. Do **not** binary search to a single answer. You need the whole hull, and full ladder evaluation is only ~12 encodes per format, which is cheap next to decode.

### 3.2 Convex hull pruning

Only points on the **lower convex hull** of the (bytes, distortion) scatter can ever be selected by any value of lambda. Compute the hull per image across all formats combined, discard the interior points. This typically halves the candidate set and makes the later bisection exact rather than approximate.

```ts
// Sort by bytes ascending. Walk maintaining a stack such that the
// slope (dDistortion / dBytes) is strictly increasing (less negative).
// Points that fail the slope test are dominated and dropped.
function lowerConvexHull(points: CandidatePoint[]): CandidatePoint[]
```

This is the same trick H.264/HEVC encoders use for mode decision. Call it that in the docs, it is accurate and it signals the tool knows what it is doing.

### 3.3 Distortion and visual weight

Raw distortion per image:

```
d = (1 - ssim) + kappa * normalizedDeltaE
```

with `kappa` defaulting around 0.5 and `normalizedDeltaE = min(deltaE / 2.3, 1)` (2.3 being the rough just-noticeable-difference threshold for CIE76). The deltaE term exists because grayscale SSIM is blind to chroma-only shifts, which is exactly where aggressive AVIF chroma subsampling hides.

Visual weight per image:

```
w = (displayAreaCssPx ^ alpha) * viewportFactor * roleFactor
```

- `alpha` default 0.6. Sublinear because perceived importance does not scale linearly with area.
- `viewportFactor`: 1.0 above the fold, decaying to ~0.3 for assets more than two viewport heights down.
- `roleFactor`: LCP candidate 1.5, decorative background 0.6, everything else 1.0.

Display area comes from the page crawl (rendered CSS dimensions, not intrinsic pixels). When there is no page context, weight defaults to 1 for every image and the allocator degenerates gracefully into per-image threshold mode.

### 3.4 Lagrangian allocation

Minimize total weighted distortion subject to a total byte budget.

```
minimize  D = sum_i ( w_i * d_i )
subject to  B = sum_i b_i  <=  budget
```

Solve by relaxation. For a given lambda, each image is chosen independently:

```
choice_i(lambda) = argmin over hull points p of  [ w_i * p.distortion + lambda * p.bytes ]
```

`B(lambda)` is monotone non-increasing, so bisect lambda until `B` lands within tolerance of the budget. Typically 20 to 30 iterations, each a linear scan over pruned hulls, so microseconds.

```ts
function allocate(
  images: { id: string; weight: number; hull: CandidatePoint[] }[],
  opts: { budgetBytes?: number; lambda?: number; floors: FloorConfig },
): {
  lambda: number
  totalBytes: number
  totalDistortion: number
  choices: Map<string, CandidatePoint>
}
```

**Constraints are applied by filtering hulls before allocation**, not by patching afterward:

- Global hard floor: drop any point with `ssim < 0.97`.
- Above-fold / LCP floor: drop any point with `ssim < 0.99`.
- Refused images: hull collapses to the single `keep-original` point.
- No-op images: hull collapses to `keep-original` when the best encode saves under 5 percent.

**Lambda is the better default knob, not the budget.** At the optimum, lambda equals the marginal weighted distortion purchased per byte, and it is uniform across every image. That makes it portable across pages in a way a byte budget is not. Ship both `--budget 400kb` and `--lambda 3.1e-7`, and have the CLI print the resolved lambda whenever a budget is used so people can pin it later. For CI, lambda is the right gate because it gives consistent quality regardless of how many images a new page happens to have.

## 4. Provenance: what has already been done to this file

This module produces a `ProvenanceRecord` and never touches the compression decision directly. It feeds one field into the decision: `headroom`.

```ts
type ProvenanceRecord = {
  container: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'svg'
  estimatedOriginalQuality: number | null
  encoderFingerprint: string | null // 'mozjpeg' | 'adobe-sfw' | 'libjpeg-turbo' | 'apple-isp' | ...
  generations: number | null // >=1, from double-quantization analysis
  chromaSubsampling: '4:4:4' | '4:2:2' | '4:2:0' | 'none' | null
  declaredResolution: { w: number; h: number }
  effectiveResolution: { w: number; h: number } | null
  upscaled: boolean
  blockingScore: number // 8x8 boundary energy ratio, 0..1
  softness: { p95Laplacian: number; verdict: 'sharp' | 'soft' | 'unknown' }
  headroom: 'normal' | 'low' | 'none'
  evidence: string[] // human-readable reasons, always populated
}
```

### 4.1 Quality estimation from quantization tables

Parse the JPEG `DQT` marker. The standard libjpeg quality-to-table mapping is invertible: compute the scale factor that best fits the observed table against the Annex K baseline tables, then invert the scaling formula to recover a quality number, accurate to within about 2 points. Store a hash of the raw table alongside it; distinct encoders ship distinct tables (Adobe Save for Web has a well-known 13-step set, mozjpeg differs from libjpeg-turbo, phone ISPs are each characteristic). Ship a table registry as part of the corpus and let it grow via contribution.

Prior art to read, not copy: ImageMagick's `identify -format "%Q"` implements the libjpeg inversion.

### 4.2 Double-quantization detection

If a JPEG was decoded and re-encoded at a different quality, the DCT coefficient histograms show periodic peaks and gaps. Implement the basic version: for each of the first ~15 AC frequency bands, build a coefficient histogram, take its DFT, and look for a dominant non-DC periodic component. A strong signal across multiple bands implies at least one prior encode. This is established image forensics (Popescu and Farid, 2004). It will not be perfectly reliable and the report must present it as evidence, not verdict.

### 4.3 Laundered-JPEG detection

Even after conversion to PNG or WebP, 8x8 blocking often survives. Compute mean absolute gradient across pixel columns/rows that fall on 8x8 boundaries, divide by the same measure on interior positions. Ratios meaningfully above 1.0 indicate JPEG heritage. This catches the extremely common and extremely costly "someone saved a JPEG as a PNG" case, where the file is huge and already lossy.

### 4.4 Effective resolution

Compute the radially averaged power spectrum, find where energy falls below a noise floor, and derive the effective resolution implied by that cutoff. An image declared at 2400px whose spectrum rolls off at the equivalent of 900px was upscaled and the extra pixels are pure cost. Report both numbers and recommend a resize.

### 4.5 Headroom

```
headroom = 'none'   if generations >= 2, or estimatedOriginalQuality < 60,
                    or blockingScore high while container is lossless
         = 'low'    if generations == 1 and estimatedOriginalQuality < 78
         = 'normal' otherwise
```

`headroom: 'none'` triggers refusal unless a better source is recovered.

## 5. Source recovery

Run before compression. Plugin interface, each recoverer proposes candidates and the framework verifies them.

```ts
interface SourceRecoverer {
  name: string
  match(asset: DiscoveredAsset): boolean
  propose(asset: DiscoveredAsset): Promise<SourceCandidate[]>
}
```

Recoverers to ship in v1:

- **WordPress**: strip `-WIDTHxHEIGHT` suffixes, and try dropping `-scaled` (WP keeps the true original under the bare name when a scaled version exists).
- **Next.js image optimizer**: `/_next/image?url=...&w=...&q=...` decodes directly to the source path.
- **Shopify CDN**: strip `_400x400` style size tokens from `cdn.shopify.com` URLs.
- **Cloudinary / imgix / Contentful**: strip transformation segments and query parameters.
- **srcset**: the largest candidate in a `srcset` is often a better source than the `src`.
- **Retina siblings**: `foo@2x.png` when only `foo.png` is referenced.
- **Git history**: `git log --follow` the path, inspect earlier blobs for larger or higher-quality versions. This one catches the very common case of an optimization pass having already destroyed the original in-place.

**Verification is mandatory.** A proposed candidate is only accepted if it strictly improves at least one of: declared resolution, effective resolution, generation count, estimated original quality. Never trust a recoverer blindly, and log every accepted swap in the receipt.

## 6. Per-image decision state machine

Order matters. This lives in one small file so it can be read end to end.

```
1. classify        -> vector | animated | icon | graphic | photo
                      vector, animated, icon  => SKIP (recorded, not silent)
2. recover source  -> possibly replace the input with a better original
3. provenance      -> ProvenanceRecord
4. if headroom == 'none' and no better source recovered
                   -> REFUSE, keep original bytes, flag in report
5. build reference -> decode, apply EXIF rotation, resize to target display
                      dimensions, hold as raw RGBA. This is the comparison
                      baseline for every candidate. Never the original file bytes.
6. sweep           -> candidate points across allowed formats
7. filter floors   -> drop points below hard/role floors
8. hull            -> lower convex hull
9. no-op guard     -> if best point saves < 5% and format is unchanged,
                      collapse hull to keep-original
10. (page mode)    -> hand hull to allocator
    (single mode)  -> pick cheapest point clearing the threshold
11. write + receipt
```

Steps 4 and 9 are the two that prevent silent damage. Keep them together and test them hardest.

## 7. Receipts

A JSON Lines ledger at `.cupel/ledger.jsonl`, committed to the repo.

```jsonc
{
  "v": 1,
  "ts": "2026-07-25T18:04:11Z",
  "asset": "public/img/hero.jpg",
  "sourceHash": "sha256:...",
  "outputHash": "sha256:...",
  "sourceRecovered": { "from": "public/img/hero-1024x683.jpg", "via": "wordpress" },
  "reference": { "w": 1600, "h": 1067, "hash": "sha256:..." },
  "decision": "encoded", // encoded | kept | refused | skipped
  "reason": null, // populated for kept/refused/skipped
  "output": { "format": "avif", "quality": 62, "bytes": 41208 },
  "before": { "format": "jpeg", "bytes": 318442 },
  "metrics": { "ssim": 0.9931, "deltaE": 0.71, "distortion": 0.00844 },
  "weight": 41.2,
  "lambda": 3.1e-7,
  "provenance": { "generations": 1, "estimatedOriginalQuality": 84, "headroom": "normal" },
  "encoder": "libaom via sharp@0.34.1",
  "tool": "cupel@0.3.0",
}
```

`cupel verify` re-reads the shipped output bytes, re-derives the reference from the source, recomputes SSIM and deltaE, and confirms the recorded numbers. **Verification does not require re-encoding**, only re-measuring, which neatly sidesteps every encoder-determinism problem. Byte-for-byte reproduction is a nice-to-have, not a requirement.

Signing: leave a hook for minisign or sigstore, but v1 ships content-addressed and unsigned. Do not build key management into v1.

## 8. Repository layout

```
cupel/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # lint, typecheck, unit, corpus regression
│   │   ├── corpus.yml              # weekly full-corpus run, publishes JSON artifact
│   │   └── release.yml             # changesets -> npm publish
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   ├── metric-disagreement.yml # "the tool said 0.99 but it looks worse"
│   │   └── recoverer.yml           # "add support for <CMS> source recovery"
│   ├── CODEOWNERS
│   └── dependabot.yml
├── apps/
│   └── web/                        # Next.js App Router, deployed to Vercel
│       ├── app/
│       │   ├── page.tsx            # landing
│       │   ├── playground/         # client-side interactive demo
│       │   ├── docs/[[...slug]]/   # MDX docs
│       │   ├── corpus/             # public benchmark leaderboard
│       │   └── api/
│       │       ├── probe/route.ts      # single-image metadata probe, no decode
│       │       ├── audit/route.ts      # URL triage audit, bounded
│       │       └── cron/corpus/route.ts
│       └── next.config.mjs
├── packages/
│   ├── core/                       # ZERO platform dependencies. Node + browser.
│   │   └── src/
│   │       ├── metrics/{ssim,deltae,laplacian,spectrum,blocking}.ts
│   │       ├── provenance/{jpeg-dqt,double-quant,fingerprints,headroom}.ts
│   │       ├── rd/{hull,allocate,weight,distortion}.ts
│   │       ├── decide.ts
│   │       ├── ledger.ts
│   │       └── types.ts
│   ├── codecs-node/                # sharp + optional avifenc/cjxl shell-out
│   ├── codecs-wasm/                # @jsquash/* wrappers, browser + edge
│   ├── recover/                    # SourceRecoverer implementations
│   ├── crawl/                      # HTML/CSS parse, display dims, LCP guess
│   ├── cli/                        # the `bb` binary
│   ├── skill/                      # Claude Code skill (SKILL.md + script)
│   └── corpus/                     # dataset manifest + runner + scoring
├── docs/
├── vercel.json
├── pnpm-workspace.yaml
├── turbo.json
├── LICENSE                         # Apache-2.0
├── LICENSE-CORPUS                  # CC BY 4.0
├── CONTRIBUTING.md
├── GOVERNANCE.md
├── CODE_OF_CONDUCT.md
└── README.md
```

### 8.1 The architectural rule that matters

**`packages/core` has no I/O, no `fs`, no `sharp`, no `Buffer`-only APIs.** It operates on `{ width, height, data: Uint8ClampedArray }` and plain numbers. Codecs are injected.

```ts
interface Encoder {
  id: string
  format: OutputFormat
  version(): Promise<string>
  supportsAlpha: boolean
  capabilities: { qualityRange: [number, number]; lossless: boolean }
  encode(img: RawImage, opts: EncodeOptions): Promise<Uint8Array>
  decode(bytes: Uint8Array): Promise<RawImage>
}
```

This is what lets the exact same SSIM implementation run in the CLI, in the browser playground, and in CI. That is not architectural neatness for its own sake, it is what makes the published numbers checkable by anyone with a browser. It is the single most important structural decision in the project.

### 8.2 Package responsibilities

| Package       | Owns                                       | Never touches                  |
| ------------- | ------------------------------------------ | ------------------------------ |
| `core`        | all math, all decisions, ledger schema     | filesystem, network, codecs    |
| `codecs-node` | sharp, avifenc detection and shell-out     | decisions                      |
| `codecs-wasm` | jSquash WASM codecs                        | decisions, filesystem          |
| `recover`     | proposing better sources                   | accepting them (core verifies) |
| `crawl`       | HTML/CSS to display dimensions             | encoding                       |
| `cli`         | argv, config resolution, output, git guard | math                           |
| `corpus`      | fixtures, regression scoring               | production code paths          |

## 9. Web app architecture

The single most important constraint: **the server never runs a quality sweep.**

A sweep is 12 to 24 encodes per image. On a 60 image page that is hundreds of encodes and gigabytes of intermediate buffers. It does not belong in a serverless function, and putting it there would force a queue, a store, and a job runner into v1 for a feature that is a lead magnet rather than the product.

That constraint is the only carve-out. **Everything else ships on Vercel in v1**, and none of it needs a queue, a database, a blob store, or a single environment variable, because none of it decodes images on the server.

### 9.1 What ships

| Route                      | What it does                                                                                                                          | Where it runs                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `/`                        | Landing. Hero sentence, four-step pipeline, one honest terminal transcript.                                                           | Static                         |
| `/docs/*`                  | MDX docs, generated API reference from TSDoc.                                                                                         | Static                         |
| `/playground`              | Drop an image, full sweep in-browser via jSquash WASM, live RD curve, draggable lambda. The image never leaves the browser.           | Client                         |
| `/verify`                  | Paste a ledger entry, drop the source and output files, recompute SSIM and deltaE in-browser, confirm or refute the recorded numbers. | Client                         |
| `/audit` + `/audit/[slug]` | URL triage. Enter a site, get a page-level report with a shareable permalink.                                                         | Server + static cache          |
| `/corpus`                  | Public benchmark leaderboard. Encoder configurations scored against the corpus.                                                       | Static, rebuilt weekly by cron |
| `/api/probe`               | Single asset metadata probe. Container, dimensions, DQT-derived quality, generations.                                                 | Server                         |
| `/api/audit`               | The triage crawl.                                                                                                                     | Server                         |
| `/api/cron/corpus`         | Weekly leaderboard rebuild from the published corpus artifact.                                                                        | Cron                           |

`/verify` is worth building even though it is small. It is the only page on the internet where someone can falsify a fidelity claim in thirty seconds, and it makes the receipts pillar concrete rather than aspirational.

### 9.2 How the audit stays inside serverless limits

Fetch the page, parse HTML and CSS, resolve asset URLs, then issue **ranged GETs for the first 64 KB of each image only**. That is enough for container headers, dimensions, EXIF, chroma subsampling, and the full JPEG `DQT` segment, which is where quality estimation and encoder fingerprinting come from. Estimate recoverable bytes from a heuristic model calibrated against the corpus. Never decode, never encode.

Output shape: "this page ships 3.2 MB across 47 images, an estimated 2.1 MB is recoverable, 4 files show generation damage, 2 PNGs were laundered from JPEGs, 6 are upscaled past their real detail." Then a link to run `npx cupel audit` locally for exact numbers.

Hard caps, all enforced server-side and all reported in the response so the user knows the audit was truncated:

- 60 assets probed per audit
- 64 KB fetched per asset
- 8 MB total fetched per audit
- 5 second timeout per fetch, 25 second budget for the whole request
- 3 redirects maximum

Vercel limits as of July 2026, for reference: with Fluid Compute enabled (on by default) Hobby allows 300 seconds and Pro allows up to 800, with a 1800 second extended maximum in beta that requires per-function configuration. The Standard instance is 1 vCPU / 2 GB and Hobby projects now use Standard CPU. Hobby cannot configure memory under Fluid Compute, which is why `memory` is absent from the config below. The design above finishes well under 30 seconds, so none of these ceilings are load-bearing. Keep it that way.

### 9.3 Abuse hardening, non-optional

A public endpoint that fetches arbitrary user-supplied URLs is an SSRF vector and a free bandwidth proxy. This must be built correctly the first time, not hardened later.

**SSRF.** Resolve DNS yourself and check the resolved address before connecting. Reject loopback, link-local (169.254.0.0/16, including the cloud metadata endpoint at 169.254.169.254), all RFC 1918 private ranges, carrier-grade NAT (100.64.0.0/10), IPv6 unique-local (fc00::/7) and link-local (fe80::/10), and any non-http(s) scheme. **Re-check after every redirect**, because a public URL redirecting to `127.0.0.1` is the standard bypass. Reject DNS names that resolve to multiple addresses where any one is private, to close the rebinding window.

**Bandwidth and DoS.** Rate limit per IP with `@vercel/firewall`'s `checkRateLimit`, which needs no external store and preserves the zero-environment-variable property. Suggested: 5 audits per minute, 30 per hour. Reject responses whose `Content-Type` is not an image. Abort a stream that exceeds the byte cap rather than buffering and then discarding it.

**Citizenship.** Respect `robots.txt` for the page fetch. Send a descriptive `User-Agent` containing the project URL so site owners can identify the crawler. Cache audit results for one hour keyed on the normalized URL, so a shared link does not re-crawl the target on every view. This is an open source project and getting a reputation as a badly behaved crawler is a permanent, unrecoverable cost.

**Content.** Audit results are public and permalinked. Do not include page text, alt text, or image thumbnails in the stored result. Store only URLs, byte counts, and metadata. Add a `noindex` header on `/audit/[slug]` so a competitor's site does not end up indexed under your domain.

## 10. vercel.json

Assumes the Vercel project's Root Directory is left at the repo root and the monorepo build is driven from here. If you instead set Root Directory to `apps/web` in the dashboard, delete `buildCommand`, `installCommand`, and `outputDirectory` and let the framework preset handle it.

```jsonc
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm turbo run build --filter=@cupel/web...",
  "outputDirectory": "apps/web/.next",
  "ignoreCommand": "npx turbo-ignore @cupel/web",
  "regions": ["iad1"],

  "functions": {
    "apps/web/app/api/probe/route.ts": { "maxDuration": 15 },
    "apps/web/app/api/audit/route.ts": { "maxDuration": 30 },
    "apps/web/app/api/cron/corpus/route.ts": { "maxDuration": 300 },
  },

  "crons": [{ "path": "/api/cron/corpus", "schedule": "0 7 * * 1" }],

  "headers": [
    {
      "source": "/(.*)\\.wasm",
      "headers": [
        { "key": "Content-Type", "value": "application/wasm" },
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" },
      ],
    },
    {
      "source": "/playground",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
      ],
    },
    {
      "source": "/corpus/data/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, s-maxage=3600, stale-while-revalidate=86400" },
        { "key": "Access-Control-Allow-Origin", "value": "*" },
      ],
    },
    {
      "source": "/audit/(.*)",
      "headers": [
        { "key": "X-Robots-Tag", "value": "noindex, nofollow" },
        { "key": "Cache-Control", "value": "public, s-maxage=3600, stale-while-revalidate=600" },
      ],
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],

  "rewrites": [{ "source": "/install", "destination": "/docs/installation" }],
}
```

Notes on the choices:

- **`memory` is deliberately omitted.** Under Fluid Compute it is not configurable on Hobby, and the Standard 2 GB default is sufficient because the server never decodes images. Add it only if you move to Pro and Tier 2 grows.
- **COOP/COEP is scoped to `/playground` only.** Those headers enable `SharedArrayBuffer` for threaded WASM, but they also break third-party embeds site-wide. Scoping them avoids breaking the docs pages. If you use single-threaded jSquash builds you can drop this block entirely, and I would start there.
- **`turbo-ignore`** stops Vercel rebuilding the site on every CLI-only commit, which will be most commits.
- **The cron** rebuilds the public corpus leaderboard weekly. Vercel cron on Hobby is limited to daily granularity, and weekly schedules are fine there.
- **`iad1`** because the corpus artifacts and any future blob storage default there. Single region is correct for this workload.

- **Durations are deliberately tight.** The audit is capped at 30 seconds, well below the Hobby ceiling of 300. A generous `maxDuration` hides failures: a function that dies at 28 seconds of a 300 second allowance looks identical to a network blip in the logs. Set the limit to just above what the work should take, so a timeout is a real signal.
- **`X-Robots-Tag: noindex` on audit permalinks** so other people's sites do not get indexed under your domain, which is both a courtesy and a way to avoid a duplicate-content mess.

Environment variables needed: **none**. `@vercel/firewall` rate limiting works without an external store, the corpus is a static artifact, and audit results are cached at the edge rather than in a database. A zero-secret deploy means any outside contributor gets a fully working preview deployment on their first PR, which is a meaningful contribution-funnel advantage and worth protecting. Treat "still no environment variables" as a design constraint, and if something needs one, question the something first.

## 11. GitHub setup

### Licensing

- **Code: Apache-2.0.** Not MIT. Image codecs are a patent minefield and Apache-2.0's explicit patent grant from contributors is genuinely protective here. It also reads as more serious to the codec community you want contributing.
- **Corpus: CC BY 4.0**, in a separate `LICENSE-CORPUS`. Every image in the corpus must be CC0, public domain, or shot by a contributor who signs it over. Enforce this in the corpus manifest with a required `license` and `source` field and fail CI if either is missing. Getting sloppy here poisons the most valuable asset in the project.

### CI (`ci.yml`)

Jobs: lint, typecheck, unit tests, **corpus regression**, and a browser-parity check.

The corpus regression is the interesting one. Any PR that touches `packages/core/src/metrics/**` or `packages/core/src/rd/**` must run the full corpus and post a diff of scores as a PR comment. Changing a metric is allowed, changing it silently is not. Encode this as a hard rule in `CONTRIBUTING.md`.

The browser-parity check runs the same SSIM inputs through `codecs-node` and `codecs-wasm` and asserts agreement to within 1e-6. If those two ever drift, the playground's credibility is gone.

### Issue templates

Include a `metric-disagreement.yml` template. "The tool reported SSIM 0.993 but this looks worse to me" is the single highest-value bug report this project can receive, and asking for the image pair, the ledger entry, and the viewing conditions turns complaints into corpus entries.

### Governance

Start as BDFL, document it plainly in `GOVERNANCE.md`, and say what would change that. Do not pretend to a foundation structure that does not exist. Add a short "decisions we will not revisit" list (Apache-2.0, core has no I/O, refusal stays a first-class output) so that recurring arguments get resolved once.

## 12. On "open weights"

Worth being precise, because it affects how you write the README. There are no weights in this project. It is deterministic signal processing, not a learned model, so "open weights" does not apply and claiming it would read as hype to exactly the audience you want.

The real equivalent, and it is arguably stronger, is a **three-part open artifact**:

1. **Open reference implementation.** Apache-2.0, and critically, the metrics run in a browser so anyone can check a claim without installing anything.
2. **Open corpus.** A CC BY 4.0 dataset of source images with published rate-distortion curves, provenance records, and human perceptual judgments where you can collect them. This is the thing that would take a competitor a year to replicate and it grows with every metric-disagreement issue you receive.
3. **Open benchmark.** A public leaderboard on the site scoring encoder configurations against the corpus. Anyone can submit a configuration and see where it lands.

And then the honest path to literal open weights: once the corpus has enough human judgments, train a small distortion predictor on it, one that estimates perceived distortion better than SSIM plus deltaE. That model would be tiny, would run in WASM, and publishing its weights would be a real open-weights release rather than a borrowed term. Put it on the roadmap as v2, not v1.

## 13. Testing

- **SSIM correctness**: identity pair returns exactly 1.0, heavily degraded pair returns low, published reference pairs match to within tolerance, and results are invariant to a constant offset in the way the definition requires.
- **Allocator correctness**: with all weights equal and a generous budget, output must match per-image threshold mode exactly. Monotonicity of `B(lambda)`. Hull pruning must never change the selected point relative to brute force over the unpruned set, which is a strong property worth property-testing.
- **Decision safety**: a synthetic already-optimized file must produce `kept`, a synthetic multi-generation JPEG must produce `refused`, an SVG must produce `skipped`, an animated WebP must produce `skipped` and never be silently flattened.
- **Edge cases**: alpha, fake alpha, grayscale, CMYK, 16-bit, 1x1, extreme aspect ratios, EXIF orientations 1 through 8, animated GIF and WebP, truncated and corrupt files.
- **Golden ledgers**: fixed inputs produce ledger entries matching committed snapshots for every field except timestamps and encoder versions.

## 14. Build order

Each milestone is independently useful, which matters for an open source project because it means every stage has something to show.

- **M0 Skeleton.** Monorepo, CI, licenses, both codec adapters behind the `Encoder` interface, parity test between them. Landing page placeholder deployed to Vercel so the pipeline is proven end to end on day one. No features.
- **M1 Metrics.** SSIM, deltaE, Laplacian, blocking, spectrum. Full test suite. This is the trust foundation and everything downstream depends on it being unimpeachable.
- **M2 Playground and site.** Landing page with the hero sentence and pipeline, MDX docs, and the client-side single-image sweep with live RD curve. First public artifact, and it validates M1 in a way people can see rather than take on faith.
- **M3 Provenance.** DQT parsing, quality estimation, fingerprint registry, double-quantization, headroom. `cupel inspect <file>` as a standalone command. This is also the point where the `/api/probe` endpoint becomes possible.
- **M4 Auditor.** Crawl, classify, sweep, report. Read-only, no writes at all. `cupel audit` locally, plus the hosted `/audit` triage with the full abuse hardening from section 9.3. **Do not ship the hosted endpoint without every item in 9.3 implemented and tested.**
- **M5 Allocator.** Hull, lambda bisection, weights, floors. Wire into audit output as a recommended plan.
- **M6 Writer.** Actually write files. Git guard, atomic writes, ledger, `cupel verify`, plus the `/verify` page in the browser.
- **M7 Recovery.** Source recoverers, verification, ledger integration.
- **M8 Skill, action, corpus.** Claude Code skill, GitHub Action, corpus leaderboard, cron.

The auditor before the optimizer is deliberate. It tests whether anyone cares before you build the risky part, and the allocator needs the auditor's output as input regardless.

**Note on the four-pillar positioning:** the pillars land in the order M3 (provenance), M4 (refusal, since headroom drives it), M5 (allocation), M6 (receipts), M7 (source recovery). The README's hero sentence is therefore only fully true after M7. Until then, write the README to describe what ships today and keep the full sentence in the roadmap. Shipping a README that promises four things when two exist is the fastest way to lose the technical audience you want.

## 15. Risks and open questions to resolve before or during M1

- **Cross-asset RDO may have prior art I have not found.** I am fairly confident in the math and I have not seen a web image tool do it, but I have not exhaustively checked whether a CDN vendor ships it. Spend thirty minutes searching before committing to it as the headline. The provenance and refusal angles stand on their own if it turns out to be occupied.
- **Double-quantization detection is genuinely hard to make reliable.** Budget for it being noisy, present it as evidence with a confidence score, and never let it alone trigger a refusal.
- **jSquash AVIF encoding in-browser is slow.** A full ladder on a large image may take tens of seconds. Mitigate by downscaling the playground reference to a fixed maximum, running the ladder progressively so the curve fills in live, and being upfront that the playground is a demonstration rather than a production path.
- **Display dimensions from a static crawl are approximate.** Responsive images, container queries, and JS-driven layout will defeat naive parsing. Consider an optional headless-browser mode later, and until then report the assumption explicitly in the audit output.
- **The 5 percent no-op threshold is a guess.** Calibrate it against the corpus once the corpus exists.
