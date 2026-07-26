# @cupel/crawl

Static page crawling for the auditor (milestone M4 groundwork): fetch a page, discover its images, estimate how large each one displays, and guess which is the LCP.

All network goes through an injected fetch-compatible `Fetcher`; nothing here touches a global network primitive, so the CLI passes the platform `fetch` and the hosted endpoint passes an SSRF-guarded wrapper. Every request carries the descriptive `CUPEL_USER_AGENT` and `robots.txt` is honoured for the page fetch: a disallow yields a `PageCrawl` with `blockedByRobots: true` and no assets, while a missing or unreachable robots.txt means allowed.

## What it does

- `crawlPage(url, opts)`: robots check, fetch, parse, sizing, and fold estimation folded into a `PageCrawl`. Never rejects for network reasons; failures come back as notes on an empty crawl.
- `parseHtml(html, pageUrl)`: static discovery of `<img>` (src, srcset, `<picture>` sources, `loading`), inline `background-image` styles, and `background-image` rules in same-document `<style>` blocks with simple tag, class, or id selectors. Relative URLs resolve against the final page URL.
- `parseSrcset(srcset, baseUrl)`: srcset candidates, largest first (width descriptors before densities).
- `estimateDisplayDims(sizing, viewport)`: display size from attributes and statically resolvable CSS (`px`, `%`, `vw`, `vh`) against an assumed viewport, default 1440x900.
- `estimateFold(items, viewport)`: above-the-fold flags and the LCP guess (largest estimated above-fold display area; ties go to the earliest asset in document order).

## Approximate by design

This is a parse, not a render. Responsive layouts, external stylesheets, container queries, and JS driven sizing defeat static analysis (BRIEF section 15), so display dimensions and fold flags are estimates, and every `PageCrawl` whose sizing used an estimate says so in `notes`. A headless-browser mode may sharpen this later.
