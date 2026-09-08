"""Create consistent SQLite snapshots and atomically publish a rollback hard link."""

from __future__ import annotations

import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from uuid import uuid4


def link_snapshot(snapshot: Path, alias: Path) -> None:
    """Replace only the alias directory entry; never overwrite a shared inode."""
    temporary = alias.with_name(f".{alias.name}.{uuid4().hex}.tmp")
    try:
        os.link(snapshot, temporary)
        os.replace(temporary, alias)
    finally:
        temporary.unlink(missing_ok=True)


def create_snapshot(source: Path, snapshot: Path, alias: Path) -> None:
    """Include committed WAL data using SQLite's online backup API."""
    source = source.resolve(strict=True)
    if source in {snapshot.resolve(), alias.resolve()} or snapshot == alias:
        raise ValueError("Source, snapshot and alias must be different paths")
    descriptor, name = tempfile.mkstemp(prefix=".sqlite-backup-", dir=snapshot.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        with closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)) as reader:
            with closing(sqlite3.connect(temporary)) as writer:
                reader.backup(writer)
                if writer.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise RuntimeError("SQLite snapshot failed quick_check")
                # Snapshots are standalone immutable files, with no WAL sidecars.
                writer.execute("PRAGMA journal_mode=DELETE")
        os.replace(temporary, snapshot)
        link_snapshot(snapshot, alias)
    finally:
        temporary.unlink(missing_ok=True)


def restore_snapshot(snapshot: Path, destination: Path) -> None:
    """Restore through SQLite so an existing destination WAL cannot replay bad data."""
    snapshot = snapshot.resolve(strict=True)
    if destination.exists() and snapshot.samefile(destination):
        raise ValueError("Cannot restore a snapshot onto itself")
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as reader:
        if reader.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise RuntimeError("Refusing to restore an invalid SQLite snapshot")
        with closing(sqlite3.connect(destination)) as writer:
            reader.backup(writer)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("alias", type=Path, nargs="?")
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    if args.restore:
        restore_snapshot(args.source, args.snapshot)
    elif args.alias is None:
        parser.error("snapshot creation requires a rollback alias")
    else:
        create_snapshot(args.source, args.snapshot, args.alias)
