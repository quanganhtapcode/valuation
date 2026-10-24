# Stock opening performance — 2026-10-24

## Before

Chromium headless, desktop viewport 1440×1000, measured against production from the VPS. These are individual browser observations, not regional p95 or Core Web Vitals guarantees.

| Flow | Selected ticker heading | Visible quote | Chart canvas |
| --- | ---: | ---: | ---: |
| Direct `/vi/stock/FPT` | 2,027 ms | 2,462 ms | 2,487 ms |
| Search click → HPG | 2,050 ms | 2,068 ms | 2,073 ms |
| Direct `/en/stock/VCB` | 1,004 ms | 1,136 ms | 1,145 ms |

Canvas availability is a UI readiness signal, not proof that every candle has rendered. The quote can arrive over WebSocket before the HTTP quote request completes. No browser runtime errors were observed.

Opening a stock launched summary, quote, uncached history, AI, technical and description requests together. Search/watchlist intent only prefetched the quote; HPG even fetched its quote a second time after its one-second freshness window expired during navigation. History always sent `nocache=1`, even when adjusted candles were already persisted.

## Changes

- Search intent, watchlist, screener and market-mover links warm the destination's summary, quote, visible-year history and chart code. Lists do not fetch every stock's data merely by rendering. Heatmap links preserve the current language and warm data on hover.
- Summary and history prefetches share in-flight requests with the destination. Public snapshots are bounded to 20 entries each and expire after 30/15 seconds respectively. Failed requests are removed so navigation can retry. Live quotes retain their existing one-second limit and are refreshed through WebSocket/HTTP.
- `snapshot=1` price history reads saved adjusted candles without blocking on an external provider. Missing/expired adjusted data triggers a bounded background refresh; a cold snapshot returns retryable 503. The existing SQLite fallback becomes usable once a provider failure is known. The standard history API keeps its existing behavior.
- Opt-in history snapshots use a five-second edge cache, while explicit bypasses and standard history requests remain uncached. The current live candle still updates from the live quote stream.
- The chart initializes from prefetched history; failed cold requests retry with bounded backoff. Aborted destinations cannot apply late results to a different symbol.
- AI and technical enrichment wait until primary quote/history requests have settled.
- Twenty common tickers are generated at build time in both languages (40 stock pages). Other tickers use ISR and a stock-specific loading shell that displays the selected symbol during navigation.

No environment variables or database schema changes. Reload backend workers and deploy the frontend; either deployment order remains compatible because older backends ignore the optional snapshot query.

## Verification

- Python chart tests cover stale saved adjusted data, nonblocking cold snapshots, provider-failure SQLite fallback and unchanged normal history behavior.
- TypeScript tests cover shared requests, ticker/period isolation, snapshot expiry, retry after failed intent and edge-cache bypasses.
- Local Chromium with controlled 150 ms API latency: HPG shell appeared in 180 ms after click; prefetch plus navigation issued exactly one quote, one summary and one history request. No runtime errors; mobile viewport 390×844 did not overflow. This local timing is not a production latency claim.
- ESLint, TypeScript through production Webpack build, and frontend unit suites.
