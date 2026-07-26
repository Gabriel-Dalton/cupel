# cupel

> Assay before you compress.

A cupel is the porous bone ash vessel used in fire assay, the reference method for determining what a sample of ore is actually worth. That is the stance of this project: an image is a sample to be assayed, not just a file to be shrunk.

The full ambition, only partly built today: find the best surviving original, work out how much quality it has left, spend the page's byte budget where it buys the most, and leave a receipt anyone can check.

## Status

Pre-release. Milestones M0 (skeleton) and M1 (metrics) are complete. See `BRIEF.md` for the complete specification and roadmap, and `KICKOFF.md` for the build protocol.

What exists today:

- `@cupel/core`: platform neutral metrics. Windowed grayscale SSIM, CIE76 deltaE (mean and p95), tiled Laplacian sharpness, 8x8 block boundary energy, radially averaged power spectrum with effective resolution estimation. No I/O, no codecs, no platform dependencies. Runs identically in Node and the browser, and CI enforces that mechanically.
- `@cupel/codecs-node`: sharp behind the `Encoder` interface.
- `@cupel/codecs-wasm`: jSquash WASM codecs behind the same interface, with a parity test that keeps the two adapters honest.
- `apps/web`: a placeholder landing page, deployed to prove the pipeline.

What does not exist yet: provenance analysis, the auditor, the allocator, the writer, source recovery, receipts. The README will grow as those land. It will not promise them before they exist.

## Two behaviours that will never be dropped

1. cupel refuses to re-encode a source with no quality headroom left. Refusal is a first class output, not a failure.
2. cupel never writes anything without an explicit flag.

## Development

Requires Node 20 or newer and pnpm 10.

```
pnpm install
pnpm test        # unit tests across the workspace
pnpm typecheck
pnpm lint
pnpm build
```

`@cupel/core` must never import platform code. The rule is enforced by ESLint in CI, not by convention. If you need a codec or the filesystem, you are in the wrong package.

## License

Code is Apache-2.0 (see `LICENSE`). The image corpus, when it lands, is CC BY 4.0 (see `LICENSE-CORPUS`).
