# Structured JSON response contract

Browser and server data requests negotiate `schema=2` through the shared
`apiFetch()` client. It is a response-format revision within the existing API;
requests without the parameter retain the legacy representation. Negotiation is
in the query string so ordinary GETs do not need a CORS preflight.

## Success, metadata and errors

Successful JSON contains `data` and, only when needed, `meta`. The HTTP status
indicates success; there is no redundant top-level `success: true`. Empty lists
are `{"data":[]}`. An unavailable analysis still has `available: false` as
business data, distinct from a transport error.

Metadata carries context such as symbol, period, source, freshness or column
definitions. A count equal to the returned array length is omitted; a total
larger than the current page is retained in `meta.count`. Preserve `has_more`,
pagination and missing-file information. No optional empty `meta` is emitted.
Dates such as `latest_date` (latest observation) and `fetched_at_utc` (fetch time)
remain distinct because they describe different events.

Errors retain their HTTP status and use only:

```json
{"error":{"code":"NOT_FOUND","message":"Symbol not found"}}
```

Do not convert unavailable measurements to zero, remove nulls globally or change
the units/precision of financial values. Preserve `0`, `false`, `null`, empty
lists and different values even when field names look like aliases.

## Resource examples

Quotes group prices, session statistics, capital data and the orderbook:

```json
{
  "data": {
    "symbol": "VCB",
    "price": {"last": 57500, "change": 0, "change_pct": 0, "reference": 57500},
    "session": {"open": 57500, "high": 58000, "low": 57000, "volume": 0},
    "capital": {"market_cap": null, "shares": 8355675094},
    "orderbook": {"columns": ["price", "volume"], "bid": [[57400, 100]], "ask": [[57600, 200]]}
  },
  "meta": {"source": "cache", "timestamp": "2026-10-28T10:00:00+07:00"}
}
```

Summary groups are `company`, `price`, `valuation`, `profitability`, `growth`,
`balance`, `banking` and `efficiency`. Empty groups are omitted. The three
net-margin aliases are transmitted once only when all three exist and have
identical values and types. Different values remain separate.

Columnar history separates its records from context:

```json
{"data":[["2026-10-27",58000,59000,57000,58500,1200000]],"meta":{"symbol":"VCB","columns":["date","open","high","low","close","volume"],"source":"sqlite","latest_date":"2026-10-27"}}
```

Row lists such as financial statements use `data: [...]`. Catalogues such as
tickers and file manifests also put the array in `data`; timestamps, missing
items and genuine pagination totals go into `meta`. Dictionaries such as market
prices by symbol remain dictionaries inside `data`.

Examples are formatted for documentation. Actual responses are minified UTF-8
and retain existing Brotli/gzip, selective projections, columnar history and
ETag/304 support. Grouping improves clarity; it does not guarantee fewer bytes
after compression for every small object. Measure compressed payloads rather
than treating nesting or shorter field names as a savings percentage.

## Compatibility and implementation

`apiContract.json` declares grouping, collection names and duplicate sets shared
by the Python serializer and TypeScript adapter. The server emits
`X-API-Schema: 2` and a compact `X-API-Shape` compatibility hint; CORS exposes
both. New consumers read the envelope directly or use `response.payload<T>()`.
Existing feature code uses `response.json()` on `ApiFetchResponse`, which restores
the old shape at one boundary. The compatibility hint is not business data.

`apiFetch` preserves method, POST body, abort signals and Next.js fetch options.
Signed storage URLs and static assets are not given the schema parameter.
Files keep their binary stream and response headers. WebSocket frames are a
separate transport and retain their existing protocol.

Serialization runs after application error normalization and before compression
and ETag generation. The compatibility proxy forwards contract headers and
streams successful bodies without parsing them. Deploy/reload the backend before
shipping the updated frontend. A client receiving an old server response without
the schema header continues to read it unchanged.

Validation: `npm run test:api` and backend unittest discovery share 23 deterministic
fixtures covering resource grouping, zero/null precision, lists, maps, pagination,
duplicate aliases, error bodies and signed file links. HTTP tests cover compressed
schema-2 responses, matching ETags returning 304, and binary download preservation.
