# Central public API

The frontend is served by Vercel at `stock.quanganh.org`. All first-party public
REST data and exports use `https://api.quanganh.org/v1/valuation` through Cloudflare
and the VPS Nginx gateway. WebSockets use the same backend. Images, fonts, signed
storage downloads and vendor-operated streams are separate asset/feed transports.

## Configuration

- `NEXT_PUBLIC_API_BASE_URL`: public REST base, baked into the browser bundle.
  Production defaults to `https://api.quanganh.org/v1/valuation`; development to
  `/api`. Set `/api` and rebuild to roll back to the compatibility proxy.
- `BACKEND_API_URL` / `BACKEND_API_URL_LOCAL`: server-rendered data and legacy
  Next.js API routes call these backend bases.
- `NEXT_PUBLIC_BACKEND_WS_URL`: optional explicit WebSocket override. Otherwise
  production derives it from the absolute REST base; local defaults to port 8000.
- Retired variables `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_REALTIME_API_URL` and
  `NEXT_PUBLIC_STOCK_QUOTE_API_URL` are ignored and can be removed from deployment
  settings. Never put credentials in these public variables.

Components use `API`, `API_BASE` or `apiUrl()` from `src/lib/apiCore.ts`.
`resolveApiLink()` resolves relative `/api/...` links returned in workbook
responses to the public API base and leaves signed storage URLs intact.
Static ticker files remain a local fallback and build-time SEO catalogue.

## Backend ownership

The VPS owns company descriptions (including language selection), financial field
codes, Polymarket fetching and compact selection, financial statements, market
data, valuations and exports. Next.js `/api` routes remain compatibility adapters
for already-open clients and rollback; they no longer independently fetch these
external resources.

`apiRouteAliases.json` defines canonical/legacy resource aliases.
`apiCacheRules.json` defines default HTTP cache policies, read by both Flask and
the compatibility proxy. Live quotes, exports, unknown resources, mutations and
errors are `no-store`. Existing endpoint freshness/privacy headers take priority
for cacheable responses. No database migration is required.

Successful GETs require backend CORS. JSON POSTs require OPTIONS and permission
for Content-Type. `Access-Control-Expose-Headers` includes download filenames,
row counts and retry metadata. Browser requests use no backend credentials.
Keep the site's cross-origin referrer policy compatible with the current Nginx
rate-limit classification; Origin/Referer are not authentication.

## Cloudflare and deployment order

1. Deploy backend code and shared JSON files first; reload Gunicorn workers.
2. Verify fields, descriptions, compact Polymarket, existing canonical APIs,
   CORS/OPTIONS and downloads through the public gateway.
3. Push/deploy the frontend. Verify Network requests use the central API host.
4. Keep compatibility routes during the transition. Confirm deployment aliases
   and the direct API host have appropriate abuse limits.

Cloudflare does not cache JSON by default. Moving browser data off Vercel removes
Vercel's response cache from the normal browser path; backend data caches remain.
The API emits shared-cache TTLs for a deliberate Cloudflare Cache Rule later.
No Cloudflare dashboard settings are changed by this commit. Before making API
JSON eligible for edge caching, ensure rules honor `no-store`, privacy and expiry,
retain query parameters (symbol, period, language, filters, compact), and never
force a TTL over live data, exports, errors or POSTs. Rate limits must still count
cached responses when the goal is limiting data extraction.

Rollback browser routing by setting `NEXT_PUBLIC_API_BASE_URL=/api` and rebuilding.
Keep the new backend endpoints available because compatibility routes use them.
Quote requests retain one same-origin fallback for connectivity/5xx/invalid JSON;
HTTP 4xx, including 429, do not retry through that path.

## Verification

- `cd frontend-next && npm run lint`
- `cd frontend-next && npm run build -- --webpack`
- `.venv/bin/python -m unittest discover -s tests -p 'test_public_api.py' -v`
- Check browser navigation between tickers, financial tabs, funds, news, valuation
  POSTs, CSV/Excel exports and reconnecting WebSockets after deployment.

Migration checks also compared 560 frontend/backend cache cases and 50 generated
Polymarket fixtures against the previous selector. These transport changes do
not by themselves provide stronger authorization or prevent crawling.
