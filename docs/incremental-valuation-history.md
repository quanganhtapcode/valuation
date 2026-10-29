# Incremental VN-Index valuation history

The overview chart starts with at most 250 rows from the stored VN-Index,
P/E and P/B history. Panning near the left edge requests the next older page;
it no longer replaces the entire dataset with 2Y, 5Y or ALL responses.

## API

`GET /market/index-valuations?metric=both&limit=250&compact=1&snapshot=1`

For older data, add `before=YYYY-MM-DD`. The boundary is exclusive. Each page
is ascending by date and includes:

```json
{"pagination":{"hasMore":true,"nextBefore":"2025-10-29"}}
```

The final page returns `hasMore: false` and `nextBefore: null`. An older cursor
may return an empty terminal page. Limits must be between 1 and 500; cursor
requests support VNINDEX and must omit `timeFrame`. Existing timeframe callers
retain their original response format. With `schema=2`, pagination and compact
column names live in `meta`, decoded by the existing frontend API adapter.

SQLite reads use the date primary key, descending order and `LIMIT limit+1`;
the extra row determines whether another page exists. Empty valuation rows are
excluded. These requests never call the upstream provider. Missing/unreadable
storage or an empty initial dataset returns 503 with `Retry-After: 30` and
`Cache-Control: no-store`. `data_as_of` remains the latest stored session, even
when requesting old pages; statistics retain their existing full-history meaning.

## Chart behavior

Only one page can be in flight. The chart retains existing rows, merges older
dates without duplicates and preserves the latest logical viewport, including
pans made while a request is pending. The prepend offset accounts for the union
of price, P/E and P/B dates. A small loading status leaves the chart usable.
Failed pages retain the chart and expose Retry; automatic fetching pauses until
Retry succeeds. No requests are made after the terminal page.

## Validation and rollout

```bash
.venv/bin/python -m unittest tests.test_valuation_pagination tests.test_api_payloads
cd frontend-next
node scripts/check-valuation-history.mjs
node scripts/check-overview-loading.mjs
npm run lint
npm run build -- --webpack
```

Deploy/reload the backend before releasing the frontend. Verify a 250-row page
and its cursor against the public API first: an older backend ignores the new
query parameters. The client deliberately rejects responses without pagination
metadata instead of treating unbounded history as a page. No database migration
or new environment variable is required.

Verified on 2026-10-29 with an isolated 603-row SQLite fixture and Chromium:
SSR avoids a duplicate initial request; a failed older page pauses automatic
requests; Retry reuses its cursor; the date under the pointer stays unchanged
after prepending; and the final 103-row page stops further requests. P/E and P/B
toggles and mobile page width also passed, with no uncaught page exceptions.

After gracefully reloading Gunicorn, public API checks returned:

| Request | Rows | JSON bytes | Wall time from VPS |
| --- | ---: | ---: | ---: |
| Latest page | 250 | 28,571 | 88 ms |
| Before 2025-10-28 | 250 | 28,625 | 111 ms |
| Legacy ALL snapshot | 5,684 | 585,327 | 306 ms |

Sizes are uncompressed JSON. These are single API observations, not browser
load-time statistics. The second page ended on 2025-10-27, confirming the cursor
excluded the first page's 2025-10-28 boundary.
