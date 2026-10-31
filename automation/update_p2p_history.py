"""Collect five-minute USD/USDT reference snapshots for later analysis."""
from __future__ import annotations

import json
import math
from pathlib import Path
import sqlite3
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'data' / 'sqlite' / 'p2p_history.sqlite'
INTERVAL_SECONDS = 300


def valid_price(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) and result > 0 else None


def save_snapshot(snapshot: dict, db_path: Path = DB_PATH) -> int:
    fetched_ms = snapshot.get('fetchedAt')
    if isinstance(fetched_ms, bool) or not isinstance(fetched_ms, (int, float)) or not math.isfinite(fetched_ms) or fetched_ms <= 0:
        raise ValueError('Missing valid snapshot time')
    bucket = int(fetched_ms // 1000) // INTERVAL_SECONDS * INTERVAL_SECONDS
    rows = []
    for source in ('okx', 'binance', 'cashUsd', 'bankUsd'):
        value = snapshot.get(source)
        if not isinstance(value, dict):
            continue
        for direction in ('buy', 'sell'):
            item = value.get(direction)
            if source in ('okx', 'binance'):
                if not isinstance(item, dict) or not isinstance(item.get('offer'), dict):
                    continue
                price = valid_price(item['offer'].get('price'))
                details = item['offer']
            else:
                price = valid_price(item)
                details = {key: value[key] for key in ('date', 'updatedAt') if key in value}
            if price is not None:
                rows.append((bucket, int(fetched_ms), source, direction, price,
                             json.dumps(details, ensure_ascii=False, separators=(',', ':'))))
    if not rows:
        raise ValueError('No valid prices in snapshot')
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path, timeout=30) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('''CREATE TABLE IF NOT EXISTS price_snapshots (
            bucket_utc INTEGER NOT NULL, fetched_at_ms INTEGER NOT NULL,
            source TEXT NOT NULL, direction TEXT NOT NULL, price_vnd REAL NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (bucket_utc, source, direction))''')
        # Repeated runs can fill missing sources without rewriting earlier observations.
        conn.executemany('INSERT OR IGNORE INTO price_snapshots VALUES (?, ?, ?, ?, ?, ?)', rows)
    return len(rows)


def main() -> None:
    result = subprocess.run(
        ['node', str(ROOT / 'automation' / 'p2p_snapshot.mjs')],
        cwd=ROOT, capture_output=True, text=True, check=True, timeout=60,
    )
    snapshot = json.loads(result.stdout)
    count = save_snapshot(snapshot)
    missing = [f'{source}/{direction}' for source in ('okx', 'binance') for direction in ('buy', 'sell')
               if not snapshot.get(source, {}).get(direction, {}).get('offer')]
    print(f'Saved {count} available quotes at {int(time.time())}; missing P2P: {", ".join(missing) or "none"}', flush=True)
    if missing:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
