# Market AI snapshot correction — 2026-10-16

## Reproduced incorrect output

The persisted v2 snapshot generated at `2026-10-16T05:10:16Z` (12:10 ICT)
called PNJ (-6.99%) and TSC (-6.95%) the largest decliners. The underlying
screening rows were quotes from **2026-09-30**, ingested on October 1:

| Symbol | Price | Reference | Calculated change | Quote date |
| --- | ---: | ---: | ---: | --- |
| PNJ | 26,600 | 28,600 | -6.9930% | 2026-09-30 |
| TSC | 1,740 | 1,870 | -6.9519% | 2026-09-30 |

The model repeated the supplied percentages. The input lacked a session date,
and generated market bullets had no independent validation.

## Why prices stayed old

`logs/cron_screener.log` showed successful price downloads followed by a
financial-quality drop from 655 populated records to 8. The unfiltered price
feed omitted financial fields; UPSERT erased those fields. The safety wrapper
then rolled back the entire database, including fresh quotes. In addition,
financial synchronization attempted DETACH before committing, resulting in
`database sf is locked` and losing that enrichment transaction.

UPSERT now preserves unavailable enrichment while replacing quote/reference
fields together. Financial synchronization fills missing metrics and commits
before detaching. The safety wrapper and its quality thresholds remain active.
An upstream timeout still fails the refresh and retains the backed-up snapshot;
stale quotes are independently excluded from the AI market ranking.

## What news the AI actually saw

Before this change the model received titles, ticker, publication date and an
upstream sentiment label, but **no article excerpt or full article body**.
Mover-specific news was fetched without a time window and inserted before the
24-hour news feed. Examples in the incorrect snapshot included:

- PNJ / Người quan sát, publication `2026-10-15 00:06 ICT`: already over 36 hours
  old when the October 16 snapshot was generated.
- CLW / Vietstock, October 9: outside the 24-hour window.
- VDP / FireAnt, September 27: outside the 24-hour window.

The general feed's cutoff also depended on the machine timezone rather than
Vietnam publication time.

## Corrected contract

- Market changes and their direction are computed in Python from price and
  reference in a dated matching quote. No copied daily-change percentage, old
  ingestion date or model-generated market bullet is accepted as current data.
- The expected weekday session uses ICT and rolls back before opening and on
  weekends. Holidays without a matching quote yield unavailable data; this
  helper does not pretend to be an exchange holiday calendar.
- News is filtered to `[as_of - 24 hours, as_of]` in ICT, excluding future,
  undated and invalid-source articles. Tracking variants of URLs are deduplicated.
- The model receives titles, published times, source URLs and up to 500
  characters of the upstream `news_short_content` excerpt. It does not crawl
  full articles and does not use sentiment labels as evidence of price moves.
- The model returns bilingual news summaries linked to exact supplied source
  IDs. Unknown sources, unsupported numbers and unsupported uppercase ticker
  references are rejected. Price summaries remain deterministic regardless of
  the model response. These checks bound the output; they do not substitute for
  verification of every assertion in the original news source.
- Persisted snapshots retain the actual `input_snapshot` and `news_sources`.
  The UI exposes the sources used, their links and publication times.
- v3 invalidates v2 output. Reads reject wrong-session or older-than-six-hour
  snapshots; the HTTP endpoint does not cache an old narrative.

## Verification

- `python -m unittest discover -s tests -p test_market_ai_takeaways.py` — 12 pass.
- `python -m unittest discover -s tests -p test_screener_quote_refresh.py` — 3 pass.
- `python -m unittest discover -s tests -p test_heatmap.py` — 4 pass.
- Frontend TypeScript check, ESLint and production Webpack build pass. ESLint
  retains the existing unused-disable warning in `useScroll.ts`.
- Broader ingestion regressions: 37/38 pass; the untouched cron installer test
  expects 17 lines but the existing installer emits 18. This unrelated failure
  was not changed as part of the AI correction.

## Live refresh verification

The second guarded refresh successfully downloaded 1,519 records. The database
kept 1,562 symbols and the populated-financial-metric count rose from 655 to
1,555; the safety health check passed without rollback. In the refreshed
October 16 snapshot, PNJ was 18,550 against reference 18,200 (+1.9231%) and TSC
was 1,770 against 1,710 (+3.5088%). Their match timestamps were respectively
`2026-10-16T04:29:57.710Z` and `2026-10-16T04:21:54.160Z`.
These are dated observations from this refresh, not a promise of a later live
price. Neither symbol appeared in the corrected decliner ranking.
