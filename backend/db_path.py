"""Database path resolution utilities.

Goal: avoid multiple accidental SQLite databases created in different locations
(e.g. stocks.db vs backend/stocks.db vs stocks_vps.db) by centralizing path logic.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional


def _project_root() -> Path:
    # backend/ is at <root>/backend
    return Path(__file__).resolve().parents[1]


def resolve_stocks_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the SQLite DB file.

    Precedence:
    1) explicit_path argument
    2) env STOCKS_DB_PATH
    3) known on-disk locations (project root + common VPS paths)
    4) default to <project_root>/stocks.db (even if missing)
    """

    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("STOCKS_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()

    # Most optimized canonical DB (pruned + compacted)
    candidates.append(root / "stocks_optimized.new.db")
    candidates.append(root / "stocks_optimized.db")

    # Preferred canonical DB name (unified schema)
    # On Windows, a previous output file may be locked; keep a side-by-side *.new.db fallback.
    candidates.append(root / "stocks_unified.new.db")
    candidates.append(root / "stocks_unified.db")

    # Main DB used by db_updater pipeline in this repo
    candidates.append(root / "vietnam_stocks.db")

    # Legacy canonical name historically used by the backend
    candidates.append(root / "stocks.db")

    # Legacy/accidental locations seen in scripts
    candidates.append(root / "backend" / "stocks.db")

    # Common VPS locations (historical + current)
    candidates.append(Path("/var/www/store/stocks.db"))
    candidates.append(Path("/var/www/valuation/stocks.db"))
    candidates.append(Path("/var/www/valuation/vietnam_stocks.db"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            # Non-existent *nix paths on Windows will fail resolve(); keep as-is.
            pass
        if path.exists():
            return str(path)

    # Fallback: return the default location (do not create new random names)
    return str((root / "stocks.db").resolve())


def iter_candidate_db_paths() -> Iterable[str]:
    """Yield paths worth checking when diagnosing 'multiple DB versions'."""
    root = _project_root()
    yield str((root / "stocks_optimized.new.db").resolve())
    yield str((root / "stocks_optimized.db").resolve())
    yield str((root / "stocks_unified.new.db").resolve())
    yield str((root / "stocks_unified.db").resolve())
    yield str((root / "vietnam_stocks.db").resolve())
    yield str((root / "stocks.db").resolve())
    yield str((root / "backend" / "stocks.db").resolve())
    yield "/var/www/store/stocks.db"
    yield "/var/www/valuation/stocks.db"
    yield "/var/www/valuation/vietnam_stocks.db"


def resolve_vci_screening_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the VCI screening SQLite DB (vci_screening.sqlite).

    Precedence:
    1) explicit_path argument
    2) env VCI_SCREENING_DB_PATH
    3) known on-disk locations (repo + common VPS paths)
    4) default to <project_root>/fetch_sqlite/vci_screening.sqlite (even if missing)
    """

    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VCI_SCREENING_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "fetch_sqlite" / "vci_screening.sqlite")

    # Common VPS locations
    candidates.append(Path("/var/www/valuation/fetch_sqlite/vci_screening.sqlite"))
    candidates.append(Path("/var/www/store/fetch_sqlite/vci_screening.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "fetch_sqlite" / "vci_screening.sqlite").resolve())


def resolve_vci_stats_financial_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the VCI stats-financial SQLite DB.

    Precedence:
    1) explicit_path argument
    2) env VCI_STATS_FINANCIAL_DB_PATH
    3) known on-disk locations (repo + common VPS paths)
    4) default to <project_root>/fetch_sqlite/vci_stats_financial.sqlite (even if missing)
    """

    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VCI_STATS_FINANCIAL_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "fetch_sqlite" / "vci_stats_financial.sqlite")

    # Common VPS locations
    candidates.append(Path("/var/www/valuation/fetch_sqlite/vci_stats_financial.sqlite"))
    candidates.append(Path("/var/www/store/fetch_sqlite/vci_stats_financial.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "fetch_sqlite" / "vci_stats_financial.sqlite").resolve())


def resolve_vci_shareholders_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the VCI shareholders SQLite DB."""
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VCI_SHAREHOLDERS_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "fetch_sqlite" / "vci_shareholders.sqlite")
    candidates.append(Path("/var/www/valuation/fetch_sqlite/vci_shareholders.sqlite"))
    candidates.append(Path("/var/www/store/fetch_sqlite/vci_shareholders.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "fetch_sqlite" / "vci_shareholders.sqlite").resolve())


def resolve_price_history_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the dedicated price-history SQLite DB.

    Stored separately from vietnam_stocks.db so it can be deleted/rebuilt
    without touching financial statement data.

    Precedence:
    1) explicit_path argument
    2) env PRICE_HISTORY_DB_PATH
    3) known on-disk locations
    4) default to <project_root>/price_history.sqlite (even if missing)
    """
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("PRICE_HISTORY_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "price_history.sqlite")
    candidates.append(Path("/var/www/valuation/price_history.sqlite"))
    candidates.append(Path("/var/www/store/price_history.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "price_history.sqlite").resolve())


def resolve_valuation_cache_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the batch-valuation cache SQLite DB."""
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VALUATION_CACHE_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "fetch_sqlite" / "valuation_cache.sqlite")
    candidates.append(Path("/var/www/valuation/fetch_sqlite/valuation_cache.sqlite"))
    candidates.append(Path("/var/www/store/fetch_sqlite/valuation_cache.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "fetch_sqlite" / "valuation_cache.sqlite").resolve())


def resolve_vci_ratio_daily_db_path(explicit_path: Optional[str] = None) -> str:
    """Return an absolute path to the VCI daily PE/PB TTM SQLite DB."""
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VCI_RATIO_DAILY_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "fetch_sqlite" / "vci_ratio_daily.sqlite")
    candidates.append(Path("/var/www/valuation/fetch_sqlite/vci_ratio_daily.sqlite"))
    candidates.append(Path("/var/www/store/fetch_sqlite/vci_ratio_daily.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "fetch_sqlite" / "vci_ratio_daily.sqlite").resolve())
