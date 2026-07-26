# @cupel/recover

Source recoverers. Each one proposes candidate URLs where a better original of a discovered asset plausibly lives; none of them fetch, verify, or accept anything. Core's decision layer verifies every candidate (a swap must strictly improve declared resolution, effective resolution, generation count, or estimated original quality) and logs accepted swaps in the receipt.

Shipped recoverers, in registry order (`allRecoverers`):

| name | mechanism |
| --- | --- |
| `wordpress` | strips `-WIDTHxHEIGHT`, `-scaled`, `-rotated` suffixes to reach the upload |
| `nextjs` | decodes the `url` param of `/_next/image?url=...&w=...&q=...` |
| `shopify` | strips `_800x600`, named size, `_crop_*`, `@2x` tokens from Shopify CDN filenames |
| `cdn` | removes Cloudinary transformation path segments and imgix-style transform query params |
| `srcset` | proposes larger `srcset` entries than the URL the page actually used |
| `retina` | proposes `@2x` / `@3x` siblings when only the 1x file is referenced |
| `git-history` | walks `git log --follow` for assets with a `localPath` and proposes larger historical blobs as `git:<commit>:<path>` |

`git-history` is the only recoverer that touches the platform: its default runner shells out to git via `node:child_process`, injected as a `GitRunner` function so tests never spawn a process. Everything else is pure string surgery on the asset URL and preserves query strings and fragments byte for byte.
