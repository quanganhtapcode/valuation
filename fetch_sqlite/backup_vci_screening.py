#!/usr/bin/env python3
"""Backup vci_screening.sqlite and prune old backups.

Designed for VPS cron usage:
- Create 1 backup per run (recommended weekly)
- Delete backups older than retention window (recommended 30 days)
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
from pathlib import Path


def utc_now() -> dt.datetime:
    return dt.datetime.now(tz=dt.timezone.utc)


def compact_ts(ts: dt.datetime) -> str:
    return ts.strftime("%Y%m%d_%H%M%SZ")


def backup_sqlite(
    *,
    db_path: str,
    backup_dir: str,
    retention_days: int,
) -> tuple[str, int]:
    src = Path(db_path)
    if not src.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    bdir = Path(backup_dir)
    bdir.mkdir(parents=True, exist_ok=True)

    ts = utc_now()
    dst_name = f"{src.stem}_{compact_ts(ts)}{src.suffix}"
    dst = bdir / dst_name

    # Copy atomically best-effort: copy to temp then replace
    tmp = bdir / (dst_name + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)

    deleted = prune_backups(backup_dir=str(bdir), retention_days=retention_days)
    return str(dst), deleted


def prune_backups(*, backup_dir: str, retention_days: int) -> int:
    retention_days = int(retention_days or 0)
    if retention_days <= 0:
        return 0

    bdir = Path(backup_dir)
    if not bdir.exists():
        return 0

    cutoff = utc_now() - dt.timedelta(days=retention_days)
    deleted = 0

    for p in bdir.glob("*.sqlite"):
        try:
            mtime = dt.datetime.fromtimestamp(p.stat().st_mtime, tz=dt.timezone.utc)
            if mtime < cutoff:
                p.unlink(missing_ok=True)
                deleted += 1
        except Exception:
            # best-effort pruning
            continue
    return deleted


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backup vci_screening.sqlite and prune old backups")
    p.add_argument("--db", default="fetch_sqlite/vci_screening.sqlite", help="Source SQLite file")
    p.add_argument(
        "--backup-dir",
        default="fetch_sqlite/backups/vci_screening",
        help="Directory to store backups",
    )
    p.add_argument(
        "--retention-days",
        type=int,
        default=30,
        help="Delete backups older than N days (default: 30)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out, deleted = backup_sqlite(
        db_path=args.db,
        backup_dir=args.backup_dir,
        retention_days=args.retention_days,
    )
    print(f"Backup created: {out}")
    if args.retention_days and args.retention_days > 0:
        print(f"Pruned old backups: {deleted} (retention_days={args.retention_days})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
