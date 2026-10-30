# Stock quote transport

Production stock quotes use `https://trading-api.quanganh.org/v1/valuation/stocks/<symbol>/quote`
directly from the browser. The subsequent central API migration extends this
transport to the other REST resources. See `public-api-architecture.md` for the
current configuration and deployment order.

`NEXT_PUBLIC_API_BASE_URL` overrides the shared API base. Production defaults
to the public backend; development defaults to `/api`. Set the variable to `/api`
and rebuild to roll back to the Vercel proxy. This public URL is not a credential.
No database migration is required.

Quotes use a simple GET without cookies or custom headers, so no CORS preflight is
required. The backend must return an appropriate `Access-Control-Allow-Origin`
header. Keep the website's referrer policy compatible with the origin rate limit:
the existing policy sends `https://stock.quanganh.org/` on cross-origin requests.

Quote requests share the same in-flight request and retain successful results for
at most one second. Network/CORS failures, timeouts (three seconds on the direct
path), invalid JSON and HTTP 5xx fall back once to `/api`, with an eight-second
timeout. HTTP 4xx, including 429, do not fall back. All quotes use `no-store`.

The public backend remains subject to Cloudflare/Nginx limits. Apply frontend and
API-host security rules separately; allowing direct quotes is not crawl protection.

## Measurement before this change

On 2026-10-28, low-volume HTTP checks through Cloudflare EWR measured stock quote
TTFB of 602–1,644 ms through Vercel and 33–60 ms directly to the backend (three
requests per path). History cache hits through Vercel took 88–122 ms; a cache miss
took 1,563 ms. Both history paths returned identical content. These are samples
from one network location, not Vietnam browser timings or an isolated measurement
of Cloudflare overhead. Measure again from the target audience after deployment.

Verify a deployed stock page in browser Network: quotes, summary and history go to
the configured direct host. A local-only blocked
request to the direct quote host should trigger one same-origin fallback. A 429
should not. Check prices, orderbook and WebSocket updates on navigation.
