# Frontend load optimization (2026-09-29)

## Changes

- Configure Vercel Functions in Singapore (`frontend-next/vercel.json`, `sin1`). The production measurement previously showed `iad1`. Region changes take effect only on the next deployment; verify the deployed `x-vercel-id` and timings.
- Use real `/[lang]` routes and explicit locale parameters instead of reading request headers. `/vi` and `/en` can be prerendered independently. The overview snapshot revalidates every 15 seconds; stock shells revalidate every 300 seconds. Live prices continue through the existing browser fetch/WebSocket paths.
- Cookie-dependent entry URLs (`/`, `/stock/VCB`, etc.) temporarily redirect to an explicit locale URL with private, non-cacheable responses. This preserves language preference without caching one visitor's language for another. Localized page responses no longer set a cookie; LanguageProvider remembers the language in the browser.
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
