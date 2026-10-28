# Smaller public API responses

Measurements on 2026-10-28 used the public gateway, the same curl client and
Brotli encoding before/after. Wire bytes below are compressed response bodies,
excluding HTTP headers. These are sample payloads, not a site-wide savings rate.

| Request used by the frontend | Previous JSON | New JSON | Previous wire | New wire |
| --- | ---: | ---: | ---: | ---: |
| Downloads field catalogue, first Income Statement section | 691,968 B (all groups) | 24,325 B (one group) | 59,037 B | 5,172 B |
| Financials field labels, all groups | 691,968 B | 237,630 B | 59,037 B | 36,936 B |
| VCB price history, 1Y snapshot | 27,060 B | 15,676 B | 5,045 B | 4,219 B |
| VCB daily technical snapshot | 2,337 B | 2,202 B | 780 B | 692 B |
| VCB AI analysis | 1,399 B | 1,161 B | 779 B | 769 B |

Income Statement is only the initial section: opening another catalogue section
requests that section once and keeps it in component state. Financials requests
only the label fields it uses and shares an in-flight catalogue request. The
larger all-group figures are not charged again for every section.

Price history declares columns once instead of repeating six property names on
every row. The shared frontend decoder restores the existing row objects and
accepts legacy row responses. The live before/after comparison preserved every
date and numeric value exactly. No financial rounding or downsampling was used.

AI compact responses carry parsed analysis/news objects rather than JSON strings
embedded in JSON and omit duplicate prose/metadata. Savings depend on the stored
analysis: the measured VCB response was already small, so wire savings were small.
Technical compact responses omit source trace/status metadata while keeping all
indicator values and freshness metadata.

Conditional requests for the unchanged compact field catalogue returned HTTP 304
with a zero-byte body through Cloudflare. Cacheable JSON receives ETags; live
quotes, mutations, errors and streamed files do not. Existing Brotli/gzip support
remains enabled. HTTP browser caching handles conditional GETs automatically.

Endpoint names remain readable: `/stocks/{symbol}/quote`, `/summary`,
`/price-history`, `/financials`, `/technical`, `/ai-analysis`. Technical timeframe
selection now uses `?timeframe=1h|1d|1w`. Legacy path/timeframe spellings and full
response formats remain available. See `api-contract.md` for schemas and options.

Validation: frontend lint, production Webpack build/TypeScript, 13 backend tests,
real-history frontend codec round-trip (including zero volume and precision),
public response size checks and a live conditional GET. Backend workers must be
reloaded before shipping frontend requests with the short timeframe values.
