# Fund logo caching

The 26 issuer logos are served from `/fund-logos/<content-hash>.png` (or `.jpg`) on the website's own domain. They no longer load from Fmarket in the browser. To update a logo, save the new image under its SHA-256 content hash (first 20 hex characters) and update `frontend-next/src/lib/fundIssuers.ts`.

`frontend-next/next.config.mjs` sets these headers for `/fund-logos/:path*`:

- `Cache-Control: public, max-age=31536000, immutable`
- `Cloudflare-CDN-Cache-Control: public, max-age=31536000, immutable`

Cloudflare can use the origin headers when the domain is proxied through Cloudflare and no overriding cache bypass rule applies. This change configures the application response; it does not modify account-level Cloudflare Cache Rules. If a reverse proxy serves `public` files directly, it must send the same headers.

After deployment, request a logo twice and inspect `CF-Cache-Status` and `Age` to confirm edge caching. New image content uses a new URL, so old cached files do not need purging.

Reference: [Cloudflare CDN-Cache-Control documentation](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
