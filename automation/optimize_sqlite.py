"""Reversible SQLite maintenance; default is a read-only report.

Use --apply to snapshot, migrate and compact. Snapshots retain archived logs.
"""
from __future__ import annotations

import argparse
import fcntl
import gzip
import json
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEXES = {
    'vci_price_history.sqlite': ['idx_ph_symbol'],
    'vci_ratio_daily.sqlite': ['idx_ratio_daily_history_ticker_date'],
    'macro_history.sqlite': ['idx_macro_symbol_date'],
    'vci_stats_financial.sqlite': ['idx_sfh_ticker'],
    'vci_financials.sqlite': ['idx_statement_periods_ticker', 'idx_statement_periods_lookup'],
    'vci_short_financials.sqlite': [],
}


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    return {name: conn.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
            for (name,) in tables}


def verify_index(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute("SELECT tbl_name FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone()
    if not row:
        return False
    table = row[0]
    primary = sorted((r[5], r[1]) for r in conn.execute(f'PRAGMA table_info("{table}")') if r[5])
    indexed = [r[2] for r in conn.execute(f'PRAGMA index_info("{name}")')]
    if not indexed or indexed != [col for _, col in primary][:len(indexed)]:
        raise RuntimeError(f'{name}: index no longer matches the primary-key prefix')
    return True


def snapshot(path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / path.name
    if target.exists() or target.with_suffix('.sqlite.gz').exists():
        raise FileExistsError(target)
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as reader:
        with closing(sqlite3.connect(target)) as writer:
            reader.backup(writer)
            if writer.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise RuntimeError(f'Invalid snapshot: {target}')
            writer.execute('PRAGMA journal_mode=DELETE')
    compressed = target.with_suffix('.sqlite.gz')
    with target.open('rb') as source, gzip.open(compressed, 'xb') as output:
        shutil.copyfileobj(source, output)
    with gzip.open(compressed, 'rb') as source:
        while source.read(1024 * 1024):
            pass  # Verify checksum before deleting our temporary snapshot.
    target.unlink()
    return compressed


def migrate(conn: sqlite3.Connection, filename: str, cutoff: str) -> dict:
    before = counts(conn)
    dropped = []
    for name in INDEXES[filename]:
        if verify_index(conn, name):
            conn.execute(f'DROP INDEX "{name}"')
            dropped.append(name)
    compressed = pruned = 0
    if filename == 'vci_short_financials.sqlite':
        for ticker, raw in conn.execute("SELECT ticker,raw_json FROM short_financial_payload WHERE typeof(raw_json)='text'").fetchall():
            json.loads(raw)
            data = raw.encode('utf-8')
            packed = gzip.compress(data, mtime=0)
            if gzip.decompress(packed) != data:
                raise RuntimeError('Payload round-trip failed')
            conn.execute('UPDATE short_financial_payload SET raw_json=? WHERE ticker=?', (packed, ticker))
            compressed += 1
    if filename == 'vci_financials.sqlite':
        # Preserve the last success per ticker for --resume, and all errors.
        pruned = conn.execute("""
            DELETE FROM fetch_log WHERE status='ok' AND fetched_at < ?
            AND (ticker, fetched_at) NOT IN (
                SELECT ticker, MAX(fetched_at) FROM fetch_log WHERE status='ok' GROUP BY ticker
            )
        """, (cutoff,)).rowcount
    expected = dict(before)
    if pruned:
        expected['fetch_log'] -= pruned
    if counts(conn) != expected:
        raise RuntimeError('Unexpected row-count changes')
    return {'indexes_removed': dropped, 'payloads_compressed': compressed,
            'success_logs_archived': pruned}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    archive = ROOT / 'data' / 'backups' / 'sqlite-optimization' / stamp
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    for filename in INDEXES:
        path = (ROOT / 'data' / 'sqlite' / filename).resolve(strict=True)
        if not args.apply:
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as conn:
                print(json.dumps({'database': filename, 'bytes': path.stat().st_size,
                                  'redundant_indexes': [n for n in INDEXES[filename] if verify_index(conn, n)]}))
            continue
        # Same lock as vci_safe_run.sh; never race a scheduled pipeline job.
        with Path(str(path) + '.safe-run.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            backup = snapshot(path, archive)
            before_bytes = path.stat().st_size
            with closing(sqlite3.connect(path, timeout=5)) as conn:
                conn.execute('BEGIN IMMEDIATE')
                try:
                    result = migrate(conn, filename, cutoff)
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                conn.execute('VACUUM')
                conn.execute('ANALYZE')
                if conn.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise RuntimeError(f'Integrity check failed; snapshot: {backup}')
                conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            result.update(database=filename, before_bytes=before_bytes,
                          after_bytes=path.stat().st_size, snapshot=str(backup))
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
