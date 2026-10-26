# Crypto logo caching

BTC, ETH, SOL, and XRP logos are downloaded as SVGs from CryptoLogos and served from the website's own `/crypto-logos/` directory:

- BTC: `https://cryptologos.cc/logos/bitcoin-btc-logo.svg`
- ETH: `https://cryptologos.cc/logos/ethereum-eth-logo.svg`
- SOL: `https://cryptologos.cc/logos/solana-sol-logo.svg`
- XRP: `https://cryptologos.cc/logos/xrp-xrp-logo.svg`

Each SVG filename includes the first 20 hexadecimal characters of its SHA-256 hash. To replace a logo, download the new SVG, use its new hash in the filename, and update `CRYPTO_LOGOS` in `frontend-next/src/components/Sidebar/CryptoPrices.tsx`. Previous hashed PNG assets remain available for cached pages.

The SVGs have no square image backgrounds. Each logo is displayed inside a 36px white circle with a border; the white background also keeps the dark XRP symbol visible in dark mode.

`frontend-next/next.config.mjs` sets both `Cache-Control` and `Cloudflare-CDN-Cache-Control` to `public, max-age=31536000, immutable` for these files. The images bypass Next.js image transformation so requests use these static URLs directly.

Cloudflare can cache these responses when the domain is proxied and no cache bypass or overriding rule applies. This configures origin response headers; it does not change Cloudflare account rules. If a reverse proxy serves public files directly, configure the same headers there. After deployment, request a logo twice and inspect `CF-Cache-Status` and `Age` to confirm edge caching.

Reference: [Cloudflare CDN-Cache-Control documentation](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
