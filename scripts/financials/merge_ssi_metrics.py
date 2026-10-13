#!/usr/bin/env python3
"""Backfill stock metric history with period-specific, overlap-verified SSI ratios."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ('ticker', 'year_report', 'quarter_report')
FALLBACK = 'ssi_stats_financial_history'
PROVENANCE = 'stock_metrics_provenance'


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def restore_ssi_history(conn: sqlite3.Connection, ticker: str | None = None) -> dict[str, int]:
    """Fill absent periods/cells; caller owns transaction and database write lock."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'", (FALLBACK,)).fetchone():
        return {'inserted_periods': 0, 'filled_cells': 0}
    fields = [r[1] for r in conn.execute(f'PRAGMA table_info({FALLBACK})')]
    metrics = [f for f in fields if f not in (*KEYS, 'period_date', 'fetched_at')]
    where, args = ('WHERE ticker=?', (ticker.upper(),)) if ticker else ('', ())
    columns = ','.join(map(quote, fields))
    inserted = conn.execute(f'INSERT OR IGNORE INTO stats_financial_history ({columns}) SELECT {columns} FROM {FALLBACK} {where}', args).rowcount
    filled = 0
    join = ' AND '.join(f'h.{k}=s.{k}' for k in KEYS)
    for field in metrics:
        qf = quote(field)
        # New SSI periods already hold their values; missing cells are recorded before filling.
        conn.execute(f'''INSERT OR IGNORE INTO {PROVENANCE}
            SELECT s.ticker,s.year_report,s.quarter_report,?, 'SSI',s.fetched_at
            FROM {FALLBACK} s JOIN stats_financial_history h ON {join}
            WHERE s.{qf} IS NOT NULL AND h.{qf} IS NULL
            {'AND s.ticker=?' if ticker else ''}''', (field, *args))
        filled += conn.execute(f'''UPDATE stats_financial_history AS h SET {qf}=(
            SELECT s.{qf} FROM {FALLBACK} s WHERE {join})
            WHERE h.{qf} IS NULL {'AND h.ticker=?' if ticker else ''}
            AND EXISTS (SELECT 1 FROM {FALLBACK} s WHERE {join} AND s.{qf} IS NOT NULL)''', args).rowcount
    return {'inserted_periods': inserted, 'filled_cells': filled}


def merge(conn: sqlite3.Connection, source: Path, mapping: dict) -> dict:
    """Import mapped values atomically, keeping all existing target values intact."""
    metrics = sorted({f for bucket in mapping['approved'].values() for f in bucket})
    target_fields = {r[1] for r in conn.execute('PRAGMA table_info(stats_financial_history)')}
    if not set(metrics).issubset(target_fields):
        raise ValueError('Mapping refers to unknown target metrics')
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as reader:
        reader.row_factory = sqlite3.Row
        metadata = dict(reader.execute('SELECT key,value FROM metadata'))
        if 'ssi.com.vn/FinancialAnalysis/GetFinancialRatioV2' not in metadata.get('endpoint', ''):
            raise ValueError('Unexpected source endpoint')
        stamp = metadata['download_date'] + 'T00:00:00+00:00'
        payloads = []
        for table, bucket in mapping['approved'].items():
            for row in reader.execute(f'SELECT * FROM {quote(table)}'):
                year, quarter = int(row['yearReport']), int(row['lengthReport'])
                if quarter not in ((5,) if table == 'annual' else (1, 2, 3, 4)) or row['timeline'] != f'{year}_{quarter}':
                    raise ValueError('Inconsistent SSI reporting period')
                values = {}
                for field, rule in bucket.items():
                    value = row[rule['field']]
                    if value is not None:
                        value = float(value) * rule['scale']
                        if not math.isfinite(value):
                            raise ValueError('Non-finite source value')
                    values[field] = value
                if not any(v is not None for v in values.values()):
                    continue
                date = f'{year}-12-31' if quarter == 5 else f'{year}-{quarter * 3:02d}-{30 if quarter in (2, 3) else 31}'
                payloads.append((row['symbol'].upper(), year, quarter, date, *[values.get(f) for f in metrics], stamp))
    with conn:
        conn.execute(f'''CREATE TABLE IF NOT EXISTS {FALLBACK} (
            ticker TEXT NOT NULL,year_report INTEGER NOT NULL,quarter_report INTEGER NOT NULL,
            period_date TEXT,{','.join(quote(f)+' REAL' for f in metrics)},fetched_at TEXT NOT NULL,
            PRIMARY KEY(ticker,year_report,quarter_report))''')
        conn.execute(f'''CREATE TABLE IF NOT EXISTS {PROVENANCE} (
            ticker TEXT,year_report INTEGER,quarter_report INTEGER,field TEXT,
            data_source TEXT NOT NULL,fetched_at TEXT NOT NULL,
            PRIMARY KEY(ticker,year_report,quarter_report,field))''')
        fields = [*KEYS, 'period_date', *metrics, 'fetched_at']
        conn.executemany(f"INSERT OR REPLACE INTO {FALLBACK} ({','.join(map(quote,fields))}) VALUES ({','.join('?' for _ in fields)})", payloads)
        # Record cells in wholly new periods before they enter the shared history.
        for field in metrics:
            conn.execute(f'''INSERT OR IGNORE INTO {PROVENANCE}
                SELECT s.ticker,s.year_report,s.quarter_report,?,'SSI',s.fetched_at
                FROM {FALLBACK} s WHERE s.{quote(field)} IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM stats_financial_history h WHERE h.ticker=s.ticker
                AND h.year_report=s.year_report AND h.quarter_report=s.quarter_report)''', (field,))
        result = restore_ssi_history(conn)
        conn.execute('CREATE TABLE IF NOT EXISTS stock_metrics_imports (source_sha256 TEXT PRIMARY KEY, imported_at TEXT, metadata_json TEXT, mapping_json TEXT)')
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        conn.execute('INSERT OR REPLACE INTO stock_metrics_imports VALUES (?,?,?,?)',
                     (digest, datetime.now(timezone.utc).isoformat(), json.dumps(metadata), json.dumps(mapping)))
        result['source_sha256'] = digest
        result['source_mapped_periods'] = len(payloads)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssi-db', type=Path, required=True)
    parser.add_argument('--vci-db', type=Path, default=ROOT / 'data/sqlite/vci_stats_financial.sqlite')
    parser.add_argument('--mapping', type=Path, default=ROOT / 'docs/ssi-stock-metrics-mapping.json')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    target, source = args.vci_db.resolve(strict=True), args.ssi_db.resolve(strict=True)
    if source.samefile(target):
        raise ValueError('Source and target must differ')
    mapping = json.loads(args.mapping.read_text())
    if args.dry_run:
        with closing(sqlite3.connect(target.as_uri() + '?mode=ro', uri=True)) as reader, closing(sqlite3.connect(':memory:')) as preview:
            reader.backup(preview)
            print(json.dumps(merge(preview, source, mapping), indent=2))
        return 0
    with Path(str(target) + '.safe-run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with closing(sqlite3.connect(target, timeout=60)) as conn:
            backup = target.with_name(target.stem + '.pre-ssi-metrics-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite')
            with closing(sqlite3.connect(backup)) as destination:
                conn.backup(destination)
            print('Backup:', backup)
            print(json.dumps(merge(conn, source, mapping), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
