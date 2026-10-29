# Frontend load optimization (2026-09-29)

## Changes

- Configure Vercel Functions in Singapore (`frontend-next/vercel.json`, `sin1`). The production measurement previously showed `iad1`. Region changes take effect only on the next deployment; verify the deployed `x-vercel-id` and timings.
- Use real `/[lang]` routes and explicit locale parameters instead of reading request headers. `/vi` and `/en` can be prerendered independently. The overview snapshot revalidates every 15 seconds; stock shells revalidate every 300 seconds. Live prices continue through the existing browser fetch/WebSocket paths.
- The homepage entry URL (`/`) temporarily redirects to the preferred locale with a private, non-cacheable response. As of the Search Console fixes on 2026-10-26, legacy paths such as `/stock/VCB` permanently redirect to Vietnamese URLs; explicit `/en/...` links retain English. Localized page responses no longer set a cookie; LanguageProvider remembers the language in the browser.
- `/api/market/polymarket-events?compact=1` performs the existing selection on the server and returns only the three displayed events. The original endpoint remains compatible with already-open clients. The panel loads near the viewport.
- The stock shell renders without waiting for the optional company profile. The existing client profile endpoint supplies it independently. Identity and stock SEO metadata remain server-rendered.
- Reserve space for quote data, valuation metrics, the company profile and the order book. Load the below-fold bank loan chart near the viewport and avoid fetching its default year twice.

## Validation

- `npm run lint`
- `npx tsc --noEmit --incremental false` (in addition to build, which is configured to skip type validation)
- `npm run build`
- Production-mode local HTTP checks for every localized page, canonical URLs, valid/invalid stocks, entry redirects, sitemap and robots.
- Compare compact Polymarket fields against the previous client selection on the same real payload. Sample: 123 events, 9,038,688 raw JSON bytes reduced to 1,245 bytes (gzip: 831,262 to 556 bytes), with identical displayed output.
- Chromium checks with an empty HTTP cache on desktop and mobile simulation. The final VCB desktop check recorded CLS 0.013, two long tasks, about 407 KB of subresources, no runtime errors and no initial loan-breakdown request. The earlier production audit recorded CLS 0.310. These are individual runs in different environments, not field statistics. Local timings are not a prediction of production latency; rerun after deploying the region change.

No database migration or new environment variable is required. Deploy the frontend as one unit so the localized routes, proxy and compact API ship together. Existing external `/vi/...` and `/en/...` URLs are preserved.

## VNINDEX chart and market downloads (2026-10-26)

The interactive VNINDEX chart requests the SQLite snapshot path so a cold request cannot wait for a remote OHLC provider. Full historical precision and valuation statistics are retained. The client shares in-flight range requests between prefetch and user pans, keeps a bounded 30-second range cache, and delays the next prefetch until 1.2 seconds after the current series arrives. Cancelling a subscriber does not cancel another subscriber's request.

Crosshair samples are coalesced once per animation frame and published only to the tooltip component. Price, volume, PE and PB series update together before restoring the visible date range when older history arrives. Loading state ignores cancelled requests, cached ranges clear the loading flag, and unavailable history offers a retry. Resize work is coalesced per frame.

The downloads page now offers eleven public market datasets through a read-only, allowlisted export endpoint, in addition to the existing financial statements and original workbooks. Both CSV and Excel preserve numeric values and missing cells. See [API contract](api-contract.md#tải-dữ-liệu-thị-trường) for filters and limits. No database migration or additional dependency is required.

## Overview loading (2026-10-29)

The supplied valuation HAR contains only 29 image/fetch requests and no page,
document or script entries. It cannot establish navigation timings or a full-page
speed comparison with the Kalshi HAR. It does show twelve redirects for four
Wikimedia market logos; these now use versioned local SVGs with immutable caching.
Nikkei is also served locally. Asset source links are retained in
`frontend-next/public/market-logos/README.md`.

The overview starts its independent server requests together and renders market,
heatmap, news, movers and gold through separate Suspense boundaries. An unresolved
secondary source no longer holds the market section on an uncached render. Next's
existing 15-second page revalidation and source-specific cache TTLs are preserved.
Cached full-page responses still depend on the hosting layer's cache behavior.

The first one-year compact chart snapshot is included in the market section.
The client parses it once and seeds its range cache, eliminating the normal
post-hydration chart request. An unavailable server chart (800 ms budget) still
uses the existing client fetch/retry path. Longer history remains on demand.
News, movers and gold keep their own refresh state so those updates do not
re-render the main chart and heatmap.

Validation:

- `cd frontend-next && node scripts/check-overview-loading.mjs`
- `cd frontend-next && npm run lint`
- `cd frontend-next && npx tsc --noEmit --incremental false`
- `cd frontend-next && npm run build -- --webpack`

Production-mode localhost checks with a controlled backend confirmed that `/vi`
contains the compact chart snapshot and index quote in its HTML, `/en` returns
200, and a market logo returns SVG directly with immutable caching. These checks
validate rendering and transport, not browser LCP or visual appearance.

No new environment variables, backend changes or database migrations are required.
Production LCP and browser timing improvements must be measured after deployment;
the partial HAR and individual HTTP timings are not sufficient to quantify them.
