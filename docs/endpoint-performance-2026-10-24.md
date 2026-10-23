# Endpoint performance audit — 2026-10-24

Production baseline: 27 representative API URLs, two sequential requests each, at most three concurrent URLs. Measurements originate from this VPS, not a browser in Vietnam; they are spot checks rather than p95/load-test claims. `bytes` measures decoded JSON rather than compressed wire transfer. API caches may already have been warm before the first request.

| Resource | First request (ms) | Repeat (ms) | Repeat CDN cache |
| --- | ---: | ---: | --- |
| `health` | 972 | 704 | MISS |
| `market/indices` | 834 | 819 | MISS |
| `market/top-movers?centerID=HOSE&type=UP` | 719 | 621 | MISS |
| `market/heatmap?exchange=HSX&limit=200` | 618 | 81 | HIT |
| `market/news?page=1&size=30&compact=1` | 616 | 92 | HIT |
| `market/gold` | 578 | 560 | MISS |
| `market/ai-takeaways` | 1276 | 1296 | MISS |
| `market/screener?page=1&page_size=20` | 631 | 544 | MISS |
| `market/index-valuations?index=VNINDEX&metric=pe&timeFrame=all` | 3098 | 188 | HIT |
| `market/foreign-flow` | 1548 | 556 | MISS |
| `market/foreign-net-value` | 1222 | 544 | MISS |
| `market/funds` | 568 | 100 | HIT |
| `market/macro/rates` | 596 | 569 | MISS |
| `market/macro/economic` | 613 | 564 | MISS |
| `market/world-indices` | 766 | 715 | MISS |
| `stocks/FPT/summary` | 539 | 714 | MISS |
| `stocks/FPT/profile` | 567 | 62 | HIT |
| `stocks/FPT/overview` | 557 | 556 | MISS |
| `stocks/FPT/quote` | 578 | 547 | MISS |
| `stocks/FPT/price-history?period=1Y` | 1521 | 595 | MISS |
| `stocks/FPT/chart-data` | 562 | 83 | HIT |
| `stocks/FPT/news?compact=1` | 553 | 72 | HIT |
| `stocks/FPT/events` | 575 | 72 | HIT |
| `stocks/FPT/ai-analysis` | 1267 | 73 | HIT |
| `stocks/FPT/technical/ONE_DAY` | 1244 | 91 | HIT |
| `stocks/FPT/peer-valuations` | 590 | 63 | HIT |
| `stocks/FPT/financial-statements?type=income&period=quarter&limit=8` | 591 | 62 | HIT |

## Findings and changes

- Most warm backend handlers take under 15 ms; uncached public requests still take roughly 0.5–1.3 seconds because the frontend proxy runs in Singapore and the backend is reached across regions. Existing edge hits took 60–100 ms in this sample.
- Add five-second edge snapshots for fresh gold, top movers and foreign-flow aggregates; 30 seconds for persisted AI and FX rates; 120 seconds for world indices and historical/economic macro resources. Live stock quotes, indices and screener remain uncached. Explicit cache bypasses and upstream privacy restrictions remain respected. Stale/missing gold remains uncached for rapid recovery.
- AI `compact=1` removes article excerpts and internal input diagnostics while preserving bilingual summaries, headlines, original timestamps, source links and publisher coverage. Real saved data shrank from 95,878 to 25,582 decoded bytes (73.3%); gzip shrank from 29,187 to 7,154 bytes. The default API response remains compatible.
- Chart `compact=1` transmits column names once and every row as values. All 5,680 saved observations round-trip exactly, including nulls and numerical precision. Decoded size shrank from 993,646 to 584,770 bytes (41.1%); gzip from 268,213 to 225,036 bytes. Frontend accepts both formats, allowing either deployment order.
- Skip the external recent-bar patch when SQLite already includes the expected trading session; retain the provider patch when the session is missing.
- AI production currently reports `available=true`, model `groq:openai/gpt-oss-120b`, five English summaries and a fresh snapshot. This supersedes the earlier missing-translation observation.

## Remaining operational observations

Health returns 207 warnings: some news/events and financial ingestion runs are partial; index-history metadata shows an older latest record. These are data freshness issues rather than proof of slow HTTP handling. Long-lived WebSocket connections also appear in the shared latency summary, so its p99 is not a REST latency percentile. No ingestion jobs or database files were rewritten in this change.

## Deployment and verification

Backend was active with start time 06:11 on 2026-10-24 (+07) before this audit. New backend changes require graceful worker reload; the oneshot AI job imports current code on its next run. New frontend cache policy and compact requests require a frontend deployment. No environment variable or schema changes.

Validation: Python snapshot, HTTP contract and chart transport regressions; frontend unit tests; ESLint; production Webpack build. Post-deployment measurements are recorded below when available.
