# Gold and mutual fund prices on NYC

Gold uses the HTML at https://phuquygroup.vn/giavang. Four exact retail products are mapped to the existing sidebar: SJC, ring 999.9, Phu Quy bar 999.9 and silver bar 999. All quotes on this page are VND per chi, including silver. The separate 99.9 bar is excluded. `updated_at` is the issuer's Vietnam timestamp; `fetched_at` is retrieval time. A disk cache and inter-process lock limit upstream fetches to once a minute. Upstream errors retain the last good snapshot and mark it stale.

The hourly fundsheet job fetches Fmarket once and publishes the same listing to Google Sheets and `data/cache/funds.json` using `backend.fund_snapshot.publish_snapshot`. `/market/funds` serves that file without upstream calls per visitor. Missing snapshots return 503; snapshots older than two hours are flagged stale. The new `/vi/funds` and `/en/funds` pages show published NAV dates and returns, with search, type filters and sorting.

Fundbot integration in its retry loop, before updating Sheets:

```python
snapshot_path = os.getenv("FUNDS_SNAPSHOT_PATH")
if snapshot_path:
    from backend.fund_snapshot import publish_snapshot
    publish_snapshot(df.to_dict("records"), snapshot_path)
```

The fundsheet systemd drop-in sets `PYTHONPATH=/var/www/valuation` and `FUNDS_SNAPSHOT_PATH=/var/www/valuation/data/cache/funds.json`. Runtime snapshots remain outside Git. `GOLD_SNAPSHOT_PATH` optionally overrides the gold cache file.
