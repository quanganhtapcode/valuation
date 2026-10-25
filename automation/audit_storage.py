"""Audit direct SQLite files without changing data, schemas or journal settings.

Run ``python automation/audit_storage.py --directory data/sqlite``. The JSON
contains aggregate counts only; row payloads are never included. Archive findings
remain visible and affect the exit status, but are labelled separately.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import time
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parents[1]
NATURAL_KEYS = {
    'note': ('ticker', 'period_kind', 'year_report', 'quarter_report'),
    'note_periods': ('ticker', 'section', 'period_kind', 'year_report', 'quarter_report'),
    'note_metrics': ('section', 'field'),
}


def quote_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def positive_timeout(value: str | float) -> float:
    timeout = float(value)
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Timeout must be a positive finite number of seconds')
    return timeout


@contextmanager
def read_snapshot(path: Path, timeout: float = 30.0) -> Iterator[sqlite3.Connection]:
    """Use an existing database only, and hold one read snapshot for all queries."""
    timeout = positive_timeout(timeout)
    deadline = time.monotonic() + timeout
    uri = path.resolve().as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True, timeout=timeout)) as conn:
        conn.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        try:
            yield conn
        finally:
            conn.rollback()


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def audit_table(conn: sqlite3.Connection, table: str) -> dict:
    quoted_table = quote_identifier(table)
    columns = conn.execute(f'PRAGMA table_info({quoted_table})').fetchall()
    primary_key = [name for _, name in sorted((row[5], row[1]) for row in columns if row[5])]
    available = {row[1] for row in columns}
    natural_key = NATURAL_KEYS.get(table, ())
    key = primary_key or (list(natural_key) if set(natural_key) <= available else [])
    result = {
        'table': table,
        'row_count': conn.execute(f'SELECT COUNT(*) FROM {quoted_table}').fetchone()[0],
        'primary_key': primary_key,
        'key_kind': 'primary_key' if primary_key else ('natural_key' if key else 'unchecked'),
        'key_columns': key,
        'null_key_rows': None,
        'duplicate_groups': None,
        'duplicate_extra_rows': None,
    }
    if not key:
        result['unchecked_reason'] = (
            'Known natural-key columns are missing' if natural_key else 'No declared primary key'
        )
        return result

    null_predicate = ' OR '.join(f'{quote_identifier(column)} IS NULL' for column in key)
    result['null_key_rows'] = conn.execute(
        f'SELECT COUNT(*) FROM {quoted_table} WHERE {null_predicate}'
    ).fetchone()[0]
    group_columns = ', '.join(quote_identifier(column) for column in key)
    duplicate_groups, duplicate_extra_rows = conn.execute(
        'SELECT COUNT(*), COALESCE(SUM(group_size - 1), 0) FROM '
        f'(SELECT COUNT(*) AS group_size FROM {quoted_table} '
        f'GROUP BY {group_columns} HAVING COUNT(*) > 1)'
    ).fetchone()
    result.update(duplicate_groups=duplicate_groups, duplicate_extra_rows=duplicate_extra_rows)
    return result


def audit_database(path: Path, timeout: float = 30.0) -> dict:
    timeout = positive_timeout(timeout)
    path = Path(path)
    archive = '.pre-' in path.name.lower() or 'notes_fallback' in path.name.lower()
    result = {
        'database': path.name,
        'path': str(path.resolve()),
        'category': 'archive' if archive else 'active',
        'status': 'ok',
        'tables': [],
        'quick_check': None,
    }
    started = time.monotonic()
    try:
        result['file_bytes'] = path.stat().st_size
        result['wal_bytes'] = file_size(Path(str(path) + '-wal'))
        if result['file_bytes'] == 0:
            result['status'] = 'empty'
            return result
        with read_snapshot(path, timeout) as conn:
            result['quick_check'] = [row[0] for row in conn.execute('PRAGMA quick_check')]
            result['page_size'] = conn.execute('PRAGMA page_size').fetchone()[0]
            result['page_count'] = conn.execute('PRAGMA page_count').fetchone()[0]
            result['freelist_count'] = conn.execute('PRAGMA freelist_count').fetchone()[0]
            result['allocated_bytes'] = result['page_size'] * result['page_count']
            result['reclaimable_bytes'] = result['page_size'] * result['freelist_count']
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT GLOB 'sqlite_*' ORDER BY name"
            ).fetchall()
            for (table,) in tables:
                result['tables'].append(audit_table(conn, table))
        if result['quick_check'] != ['ok'] or any(
            table['null_key_rows'] or table['duplicate_groups'] for table in result['tables']
        ):
            result['status'] = 'issues'
    except (OSError, sqlite3.Error) as exc:
        result['status'] = 'error'
        result['error'] = str(exc)
        result['timed_out'] = (
            isinstance(exc, sqlite3.OperationalError)
            and ('interrupted' in str(exc).lower() or 'locked' in str(exc).lower())
            and time.monotonic() - started >= timeout
        )
    finally:
        result['elapsed_seconds'] = round(time.monotonic() - started, 3)
    return result


def audit_directory(directory: Path, timeout: float = 30.0) -> dict:
    timeout = positive_timeout(timeout)
    directory = Path(directory).resolve()
    errors = []
    databases = []
    try:
        if not directory.is_dir():
            raise NotADirectoryError(f'Not a directory: {directory}')
        paths = sorted(path for path in directory.glob('*.sqlite') if path.is_file())
        databases = [audit_database(path, timeout) for path in paths]
    except OSError as exc:
        errors.append(str(exc))
    return build_report(databases, timeout, directory, errors)


def audit_databases(paths: list[Path], timeout: float = 30.0) -> dict:
    """Audit explicit files, including databases outside the default directory."""
    timeout = positive_timeout(timeout)
    unique_paths = dict.fromkeys(Path(path).resolve() for path in paths)
    return build_report([audit_database(path, timeout) for path in unique_paths], timeout)


def build_report(databases: list[dict], timeout: float, directory: Path | None = None,
                 errors: list[str] | None = None) -> dict:
    result = {
        'schema_version': 1,
        'selection': 'directory' if directory is not None else 'explicit',
        'directory': str(directory) if directory is not None else None,
        'timeout_seconds': timeout,
        'errors': errors or [],
        'databases': databases,
    }
    tables = [table for database in databases for table in database['tables']]
    result['summary'] = {
        'database_files': len(databases),
        'active_files': sum(database['category'] == 'active' for database in databases),
        'archive_files': sum(database['category'] == 'archive' for database in databases),
        'empty_files': sum(database['status'] == 'empty' for database in databases),
        'database_errors': sum(database['status'] == 'error' for database in databases),
        'integrity_failures': sum(
            database['quick_check'] is not None and database['quick_check'] != ['ok']
            for database in databases
        ),
        'duplicate_tables': sum(bool(table['duplicate_groups']) for table in tables),
        'null_key_tables': sum(bool(table['null_key_rows']) for table in tables),
        'unchecked_tables': sum(table['key_kind'] == 'unchecked' for table in tables),
    }
    result['has_failures'] = bool(result['errors']) or any(
        database['status'] in ('issues', 'error') for database in databases
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / 'data' / 'sqlite')
    parser.add_argument('--database', type=Path, action='append',
                        help='Audit this file instead of scanning a directory; repeat for several.')
    parser.add_argument('--timeout', type=float, default=30.0, help='Seconds per database (default: 30)')
    args = parser.parse_args(argv)
    try:
        result = (audit_databases(args.database, args.timeout) if args.database
                  else audit_directory(args.directory, args.timeout))
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return int(result['has_failures'])


if __name__ == '__main__':
    raise SystemExit(main())
