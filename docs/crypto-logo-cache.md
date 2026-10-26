# Crypto logo caching

BTC, ETH, SOL, and XRP logos are downloaded from `https://finance-logo.perplexity.ai/crypto/<SYMBOL>USD?format=png&fallback=404&size=50` and served from the website's own `/crypto-logos/` directory. Each PNG filename includes the first 20 hexadecimal characters of its SHA-256 hash. To replace a logo, download the new PNG, use its new hash in the filename, and update `CRYPTO_LOGOS` in `frontend-next/src/components/Sidebar/CryptoPrices.tsx`.

`frontend-next/next.config.mjs` sets both `Cache-Control` and `Cloudflare-CDN-Cache-Control` to `public, max-age=31536000, immutable` for these files. The images bypass Next.js image transformation so requests use these static URLs directly.

Cloudflare can cache these responses when the domain is proxied and no cache bypass or overriding rule applies. This configures origin response headers; it does not change Cloudflare account rules. If a reverse proxy serves public files directly, configure the same headers there. After deployment, request a logo twice and inspect `CF-Cache-Status` and `Age` to confirm edge caching.

Reference: [Cloudflare CDN-Cache-Control documentation](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
