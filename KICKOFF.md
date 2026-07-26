# Claude Code kickoff prompt

Put `BRIEF.md` in the repo root first, then paste the block below. It is written to be pasted whole into a fresh Claude Code session.

Do not ask Claude Code to build all eight milestones in one go. It will produce a large amount of plausible code that has never been run. The prompt below scopes the first session to M0 and M1 and makes stopping mandatory.

---

## Session 1 prompt (paste this)

```
Read BRIEF.md in full before doing anything. It is the complete specification
for this project. Everything below assumes you have read it.

## What we are building

An open source image toolchain called `cupel`. It finds the best surviving
original of each image, works out how much quality that source has left after
its prior encoding history, spends a page-level byte budget where it buys the
most perceived quality by solving a rate-distortion optimization across all
assets, and leaves a verifiable receipt for every decision.

It is named after the vessel used in fire assay. The governing idea is that an
image is a sample to be assayed, not just a file to be shrunk. Full rationale,
algorithms, and architecture are in BRIEF.md.

Two behaviours matter more than any feature and must never be quietly dropped:
the tool refuses to re-encode sources with no quality headroom left, and it
never writes anything without an explicit flag.

## Scope of this session: M0 and M1 only

Build the monorepo skeleton and the metrics package. Do NOT build the CLI,
the allocator, provenance, the crawler, the web app, or the Claude Code skill
in this session. If you find yourself writing code for those, stop.

### M0: skeleton

- pnpm workspaces + turborepo. Node >= 20. TypeScript strict, `noUncheckedIndexedAccess` on.
- Packages: `@cupel/core`, `@cupel/codecs-node`, `@cupel/codecs-wasm`.
  Create empty stubs for `cli`, `crawl`, `recover`, `corpus`, `skill` with
  package.json and a README only. No source.
- `apps/web` scaffolded as a Next.js App Router app that renders a placeholder
  landing page and nothing else.
- Apache-2.0 LICENSE, CC BY 4.0 LICENSE-CORPUS, CODE_OF_CONDUCT.md,
  GOVERNANCE.md, CONTRIBUTING.md.
- `.github/workflows/ci.yml`: lint, typecheck, unit tests, browser-parity
  check. Use pnpm cache. Matrix on Node 20 and 22.
- `vercel.json` exactly as specified in BRIEF.md section 10.
- Vitest for tests. ESLint flat config. Prettier.
- Changesets configured but no release workflow yet.

### The one architectural rule you must not break

`@cupel/core` has ZERO platform dependencies. No `fs`, no `sharp`, no
`node:` imports, no `Buffer`. It operates only on:

    type RawImage = {
      width: number
      height: number
      data: Uint8ClampedArray   // RGBA, 4 bytes per pixel, non-premultiplied
    }

Codecs are injected via the `Encoder` interface in BRIEF.md section 8.1.
Add an ESLint rule or a dependency-cruiser config that FAILS CI if `core`
imports anything platform-specific. I want this enforced mechanically, not
by convention.

### M1: the metrics package

Implement in `@cupel/core/src/metrics/`:

1. `ssim.ts`: 8x8 windowed grayscale SSIM. I will hand you a working ~40 line
   reference implementation; ask me for it before you write this file. Match
   its behaviour, then improve structure and add types. Do not invent your own
   variant without telling me what you changed and why.

2. `deltae.ts`: mean CIE76 deltaE between two RawImages. sRGB to linear to
   XYZ to Lab. Include the standard D65 white point. Return both mean and p95.

3. `laplacian.ts`: tiled Laplacian variance at a normalized scale, reporting
   the p95 across tiles rather than the mean. Normalize by resizing the input
   so the long edge is a fixed size (start with 1024) before measuring, so the
   number is comparable across images of different dimensions.

4. `blocking.ts`: 8x8 block boundary energy ratio. Mean absolute gradient
   across pixel positions falling on 8x8 boundaries, divided by the same
   measure at interior positions. Compute separately for horizontal and
   vertical and return both plus a combined score.

5. `spectrum.ts`: radially averaged power spectrum, and an
   `effectiveResolution(img)` that finds the frequency where energy drops
   below a noise floor and converts it to an implied pixel dimension.
   Implement the DFT yourself or use a small dependency, but if you add a
   dependency to `core`, ask me first.

### Testing requirements for M1

These are not optional and I will check them:

- SSIM of an image against itself is exactly 1.0, not 0.9999999.
- SSIM of an image against heavy gaussian noise is below 0.3.
- SSIM is symmetric: ssim(a,b) === ssim(b,a).
- Property test: for a fixed image, SSIM against progressively stronger blur
  is monotonically decreasing.
- deltaE of an image against itself is 0.
- deltaE correctly detects a pure hue shift that leaves grayscale SSIM at
  approximately 1.0. This test is the entire justification for the metric
  existing, so make it explicit and comment it as such.
- `blocking.ts` scores a synthetic 8x8 blocked image high and a smooth
  gradient low.
- `effectiveResolution` on a 2x-upscaled image returns approximately half the
  declared dimensions.
- Fixtures are generated procedurally in the test setup where possible, so the
  repo does not accumulate binary blobs. Commit only fixtures that genuinely
  cannot be synthesized.

### Codec adapters

`codecs-node` wraps sharp. `codecs-wasm` wraps `@jsquash/webp`,
`@jsquash/avif`, `@jsquash/jpeg`, `@jsquash/png`. Both implement the same
`Encoder` interface. Start with single-threaded jSquash builds so we do not
need COOP/COEP headers.

Write a parity test that runs identical RawImage inputs through both adapters,
decodes the results, and asserts the resulting SSIM values agree to within
1e-6. This test protects the credibility of the browser playground and should
fail loudly.

### How I want you to work

- Propose the exact package.json files, tsconfig layout, and turbo.json first.
  Wait for my approval before generating source.
- After M0 is scaffolded, run the install and the empty test suite and show me
  it passes before starting M1.
- Implement M1 one metric at a time. Write the tests first, show me them
  failing, then implement. Do not batch all five metrics into one edit.
- Run the tests after each metric. Show real output, not a claim that it works.
- If a spec detail in BRIEF.md is ambiguous or you think it is wrong, say so
  and ask. Do not silently pick an interpretation. This is a project where a
  quietly wrong metric is worse than no metric.
- No em dashes in any code comment, doc, or commit message.

Start by reading BRIEF.md, then propose the M0 file layout.
```

---

## Session 2 onward

Keep BRIEF.md as the persistent context and open each session the same way:

```
Read BRIEF.md. We have completed M0 through M<n>. This session builds
M<n+1> only: <name>. Do not touch anything outside its scope. Run tests
after each meaningful change and show me real output.
```

The milestone list is in BRIEF.md section 14. The ones with the highest chance of Claude Code going off the rails, and where you should be most insistent about incremental work:

- **M3 Provenance.** Double-quantization detection is subtle and it is very easy to produce code that runs, returns plausible numbers, and is measuring nothing. Demand a test that a known single-generation JPEG scores low and a known double-encoded JPEG scores high, generated in the test itself by encoding twice with sharp at different qualities.
- **M4 Hosted audit.** This ships a public endpoint that fetches arbitrary user-supplied URLs, which is an SSRF vector and a free bandwidth proxy. Section 9.3 of BRIEF.md is a checklist, not a suggestion. Require a test that a URL redirecting to `127.0.0.1` or `169.254.169.254` is rejected **after** the redirect, since pre-redirect validation alone is the classic bypass. Do not let this milestone be marked done with the hardening deferred to a follow-up.
- **M5 Allocator.** Insist on the brute-force equivalence property test: hull pruning followed by lambda selection must return the same point as exhaustive search over the unpruned candidate set, for randomly generated candidate sets. If that property holds, the allocator is correct.
- **M6 Writer.** This is the only milestone that can destroy someone's files. Require the git-clean guard and the dry-run default to be implemented and tested before any write path exists at all.

## A note on repo initialization

Create the GitHub repo empty, with no license or README selected, and let Claude Code generate everything. A pre-existing README from the GitHub template causes merge friction on the first push for no benefit.

For Vercel, import the repo, leave Root Directory at the repo root so the `vercel.json` above applies as written, and confirm Fluid Compute is on (it is on by default now). No environment variables are needed for v1, which means preview deploys work for outside contributors without any secret sharing.