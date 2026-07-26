# cupel

> Assay before you compress.

A cupel is the porous bone ash vessel used in fire assay, the reference method for determining what a sample of ore is actually worth. That is the stance of this project: an image is a sample to be assayed, not just a file to be shrunk.

Most image tooling asks "how small can this get". cupel asks what the file has already been through, whether there is any quality left to spend, and refuses to touch it when there is not.

## What it does today

Four commands. Three of them cannot modify a file even if you ask them to.

```
cupel inspect <file>     what has already been done to this image
cupel audit <dir|url>    read-only triage of a directory or a page
cupel write <dir>        apply a plan; dry run unless you pass --apply
cupel verify [dir]       re-measure shipped bytes against the receipts
```

### It refuses to re-encode a spent source

`cupel inspect` on a JPEG that has been through the mill:

```
container                   jpeg
declared resolution         384x384
estimated original quality  34 (+/- 2)
encoder fingerprint         libjpeg
blocking score              0.33
headroom                    none

Verdict: cupel would refuse to re-encode this file. There is no quality left to
spend, so another generation would cost detail and buy nothing. Recover a better
original instead.
```

Refusal is a first class result, not an error. It is decided before any candidate
is encoded, so refusing costs nothing.

### It shows you the plan before it writes

`cupel write` is a dry run unless you pass `--apply`:

```
asset          decision  before    after    saved  ssim    output
chart.png      REFUSED   4.4 kB    -        -      -       -
hero.jpg       encoded   156.2 kB  76.0 kB  51.4%  0.9711  hero.webp
laundered.png  encoded   261.4 kB  18.1 kB  93.1%  0.9840  laundered.jpg
logo.svg       skipped   116 B     -        -      -       -
tired.jpg      REFUSED   18.3 kB   -        -      -       -

Reasons
-------
  chart.png: headroom none: blocking score 1.00 in a lossless container: pixels
    were laundered from a jpeg. Re-encoding is refused
  hero.jpg: webp q75: 51.4% saved, ssim 0.971 (cheapest point clearing the floor)
  logo.svg: svg is reported but not decoded: cupel never rasterizes a vector
```

Two files refused, one skipped, two encoded. That is a normal run.

### Every change leaves a receipt anyone can recheck

`--apply` writes one JSON Lines entry per asset to `.cupel/ledger.jsonl`,
preserves every original byte for byte under `.cupel/sources/`, and writes
outputs atomically. Then:

```
asset          decision  verdict  ssim              deltaE          ref hash
hero.jpg       encoded   pass     0.9711 vs 0.9711  1.973 vs 1.973  match
laundered.png  encoded   pass     0.9840 vs 0.9840  1.652 vs 1.652  match

Every receipt was re-measured and confirmed.
```

Verification re-measures; it never re-encodes. That is what makes a receipt
checkable by someone who does not have cupel's encoder, or the same version of
it, or the same CPU: only decoders are involved, and decoders are bounded by
their standards. The same receipts can be checked in a browser at `/verify`,
which uses WebAssembly codecs rather than cupel's own, and agrees with the CLI
to within a documented cross-decoder tolerance.

When a receipt does not describe the bytes on disk, `cupel verify` says
`refuted` and exits 1. When it cannot tell, it says `unverifiable` and exits 2,
rather than guessing which side is wrong.

## Install and run

Requires Node 20 or newer and pnpm 10.

```
pnpm install
pnpm build
node packages/cli/bin/cupel.js inspect path/to/photo.jpg
```

Nothing is published to npm yet.

## How it decides

1. **Measure.** Decode the pixels and read what is there: windowed SSIM, CIE76
   deltaE, tiled Laplacian sharpness, 8x8 block boundary energy, and a radially
   averaged power spectrum that reports the resolution an image really carries
   rather than the one it declares.
2. **Prove.** Reconstruct the file's history from its own bytes: quantization
   tables give the original quality to about 2 points and fingerprint the
   encoder; double-quantization analysis estimates how many generations it has
   been through. That history sets the headroom, and headroom decides whether
   re-encoding is allowed at all.
3. **Sweep, then choose.** Every allowed format at every rung of a quality
   ladder, each encode measured against the reference. Only points on the lower
   convex hull can ever be chosen. Quality floors filter candidates rather than
   patching results afterwards.
4. **Receipt.** Record the decision, the reason, the reference hash, and the
   numbers, in a form anyone can recompute.

Cross-asset budget allocation, the piece that makes step 3 a page-level decision
rather than a per-file one, is implemented and tested in `@cupel/core` but is not
yet wired into the writer. See `ROADMAP.md`, which is blunt about what is
finished and what is not.

## Layout

- `@cupel/core`: metrics, provenance analysis, the rate-distortion math, the
  decision engine, the ledger schema. No I/O, no codecs, no platform
  dependencies. Runs identically in Node and the browser, and CI enforces that
  mechanically rather than by convention.
- `@cupel/codecs-node`: sharp behind the `Encoder` interface.
- `@cupel/codecs-wasm`: jSquash WASM codecs behind the same interface, with a
  parity test that holds the two adapters to within 1e-6 of each other.
- `@cupel/crawl`: static HTML and CSS parsing to discovered assets and estimated
  display dimensions.
- `@cupel/recover`: seven source recoverers (WordPress, Next.js, Shopify,
  generic CDN, srcset, retina siblings, git history). Built and tested, not yet
  wired into the writer.
- `@cupel/cli`: the four commands above.
- `apps/web`: the site, the docs, the in-browser playground, and the receipt
  verifier.

## Two behaviours that will never be dropped

1. cupel refuses to re-encode a source with no quality headroom left, and the
   refusal names its evidence.
2. cupel never writes anything without an explicit flag, and never onto a dirty
   git tree without a second one. A receipt only means something against a
   committed baseline.

## Development

```
pnpm test        # unit tests across the workspace
pnpm typecheck
pnpm lint
pnpm build
```

`@cupel/core` must never import platform code. The rule is enforced by ESLint in
CI. If you need a codec or the filesystem, you are in the wrong package.

No binary fixtures. Every test image is generated in code from a seeded PRNG, so
the fixtures are reproducible, reviewable in a diff, and identical on every
machine.

`BRIEF.md` is the full specification, `KICKOFF.md` is the build protocol, and
`ROADMAP.md` tracks what is actually done, including a list of the calibration
guesses currently shipping.

## License

Code is Apache-2.0 (see `LICENSE`). The image corpus, when it lands, is CC BY 4.0
(see `LICENSE-CORPUS`).
