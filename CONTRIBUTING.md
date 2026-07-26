# Contributing to cupel

Thanks for looking at cupel. The project is early, and the fastest way to help right now is to read `BRIEF.md`, try what exists, and file precise issues.

## Setup

You need Node 20 or newer and pnpm 10 (`npm install -g pnpm@10` or corepack).

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Tests use Vitest. Each package owns its own test suite under `test/`.

## The rules that are not negotiable

1. **`@cupel/core` is platform neutral.** No `fs`, no `node:` imports, no `Buffer`, no codec packages. It operates on `RawImage` (`{ width, height, data: Uint8ClampedArray }`) and plain numbers. ESLint enforces this and CI fails on violations. If your change needs I/O or a codec, it belongs in an adapter package.
2. **Metric changes are never silent.** Any PR touching `packages/core/src/metrics/**` or `packages/core/src/rd/**` must run the full corpus regression and post the score diff as a PR comment once the corpus exists (milestone M8). Until the corpus lands, the PR description must explain the behavioural difference and include tests demonstrating it.
3. **Refusal stays a first class output.** Do not add code paths that quietly re-encode something the decision layer refused.
4. **Nothing writes without an explicit flag.** Dry run is the default, always.
5. **Fixtures are procedural.** Generate test images in test setup where possible. Commit a binary fixture only when it genuinely cannot be synthesized, and say why in the PR.
6. **No em dashes** in code comments, docs, or commit messages.

## Style

Prettier and ESLint run in CI (`pnpm format:check`, `pnpm lint`). TypeScript is strict with `noUncheckedIndexedAccess`; do not weaken compiler options.

## Changesets

User-facing changes need a changeset (`pnpm changeset`). Internal refactors and test-only changes do not.

## Reporting metric disagreements

"The tool said SSIM 0.993 but it looks worse to me" is the most valuable issue you can file. Use the metric disagreement template and include the image pair, the ledger entry when one exists, and your viewing conditions. These reports become corpus entries.
