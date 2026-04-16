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
    3) stocks_optimized.new.db / stocks_optimized.db in project root
    4) default to <project_root>/stocks_optimized.db (even if missing)
    """

    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("STOCKS_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / "stocks_optimized.new.db")
    candidates.append(root / "stocks_optimized.db")

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "stocks_optimized.db").resolve())


def iter_candidate_db_paths() -> Iterable[str]:
    """Yield paths worth checking when diagnosing 'multiple DB versions'."""
    root = _project_root()
    yield str((root / "stocks_optimized.new.db").resolve())
    yield str((root / "stocks_optimized.db").resolve())


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


def resolve_vci_financial_statement_db_path(explicit_path: Optional[str] = None) -> str:
    """Return absolute path to VCI financial-statement SQLite DB."""
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv("VCI_FINANCIAL_STATEMENT_DB_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    # Wide-format SQLite (preferred — fetched by fetch_vci_financials.py)
    candidates.append(root / "fetch_sqlite" / "vci_financials.sqlite")
    candidates.append(Path("/var/www/valuation/fetch_sqlite/vci_financials.sqlite"))
    # Legacy long-format SQLite
    candidates.append(root / "vci_financial_statement_data" / "hose_only" / "vci_financial_statements.sqlite")
    candidates.append(root / "vci_financial_statement_data" / "vci_financial_statements.sqlite")
    candidates.append(Path("/var/www/valuation/vci_financial_statement_data/hose_only/vci_financial_statements.sqlite"))
    candidates.append(Path("/var/www/valuation/vci_financial_statement_data/vci_financial_statements.sqlite"))
    candidates.append(Path("/var/www/store/vci_financial_statement_data/hose_only/vci_financial_statements.sqlite"))
    candidates.append(Path("/var/www/store/vci_financial_statement_data/vci_financial_statements.sqlite"))

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / "vci_financial_statement_data" / "hose_only" / "vci_financial_statements.sqlite").resolve())


def _resolve_db_path(
    explicit_path: Optional[str],
    env_var: str,
    default_rel: Path,
    extra_candidates: Optional[list[Path]] = None,
) -> str:
    """Generic DB path resolver.

    Resolution order: explicit_path > env_var > project_root/default_rel > extra_candidates.
    """
    candidates: list[Path] = []

    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    env_path = os.getenv(env_var)
    if env_path:
        candidates.append(Path(env_path).expanduser())

    root = _project_root()
    candidates.append(root / default_rel)

    if extra_candidates:
        candidates.extend(extra_candidates)

    for path in candidates:
        try:
            path = path.resolve()
        except Exception:
            pass
        if path.exists():
            return str(path)

    return str((root / default_rel).resolve())


def resolve_vci_company_db_path(explicit_path: Optional[str] = None) -> str:
    """Return absolute path to VCI company info SQLite DB."""
    return _resolve_db_path(
        explicit_path,
        "VCI_COMPANY_DB_PATH",
        Path("fetch_sqlite") / "vci_company.sqlite",
        extra_candidates=[
            Path("/var/www/valuation/fetch_sqlite/vci_company.sqlite"),
            Path("/var/www/store/fetch_sqlite/vci_company.sqlite"),
        ],
    )


def resolve_index_history_db_path(explicit_path: Optional[str] = None) -> str:
    """Return absolute path to VCI index history SQLite DB."""
    return _resolve_db_path(
        explicit_path,
        "INDEX_HISTORY_DB_PATH",
        Path("fetch_sqlite") / "index_history.sqlite",
        extra_candidates=[
            Path("/var/www/valuation/fetch_sqlite/index_history.sqlite"),
            Path("/var/www/store/fetch_sqlite/index_history.sqlite"),
        ],
    )


def resolve_vci_news_events_db_path(explicit_path: Optional[str] = None) -> str:
    """Return absolute path to VCI news/events SQLite DB."""
    return _resolve_db_path(
        explicit_path,
        "VCI_NEWS_EVENTS_DB_PATH",
        Path("fetch_sqlite") / "vci_news_events.sqlite",
        extra_candidates=[
            Path("/var/www/valuation/fetch_sqlite/vci_news_events.sqlite"),
            Path("/var/www/store/fetch_sqlite/vci_news_events.sqlite"),
        ],
    )


def resolve_vci_valuation_db_path(explicit_path: Optional[str] = None) -> str:
    """Return absolute path to VCI valuation history SQLite DB (PE/PB/VNINDEX history)."""
    return _resolve_db_path(
        explicit_path,
        "VCI_VALUATION_DB_PATH",
        Path("fetch_sqlite") / "vci_valuation.sqlite",
        extra_candidates=[
            Path("/var/www/valuation/fetch_sqlite/vci_valuation.sqlite"),
            Path("/var/www/store/fetch_sqlite/vci_valuation.sqlite"),
        ],
    )
