# @cupel/core

Platform neutral metrics, math, and decision logic for cupel.

This package has zero platform dependencies. No `fs`, no `node:` imports, no `Buffer`, no codec packages. It operates on `RawImage` (`{ width, height, data: Uint8ClampedArray }`, RGBA, non premultiplied) and plain numbers, so the exact same code runs in Node, in the browser playground, and in CI. That is what makes cupel's published numbers checkable by anyone with a browser.

Codecs are injected through the `Encoder` interface defined in `src/types.ts` and implemented by `@cupel/codecs-node` and `@cupel/codecs-wasm`.

Note for consumers: the package currently exports TypeScript source directly (`main` points at `src/index.ts`). It is consumed inside the monorepo only. A publish oriented build (`dist/` plus `publishConfig`) exists via `pnpm build` and will be wired up when the first release is cut.

## Metrics (milestone M1)

- `ssim(a, b)`: windowed grayscale SSIM over 8x8 blocks.
- `deltaE(a, b)`: mean and p95 CIE76 deltaE through sRGB to linear to XYZ to Lab (D65).
- `laplacianSharpness(img)`: tiled Laplacian variance at a normalized scale, p95 across tiles.
- `blockingScore(img)`: 8x8 block boundary energy ratio, horizontal, vertical, and combined.
- `radialPowerSpectrum(img)` and `effectiveResolution(img)`: radially averaged power spectrum and the implied real resolution of upscaled images.

All metrics ignore the alpha channel in this milestone. Images are compared premultiplication free, at identical dimensions; dimension mismatches throw.
