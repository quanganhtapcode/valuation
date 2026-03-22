#!/usr/bin/env python3
"""
Master Pipeline for Stock Data Maintenance

Steps (run daily via systemd stock-fetch.timer at 18:00 VN):
  1. Update financial reports (BCTC) for all symbols — daily, smart-skip
  2. Update stock list + company info               — weekly (Wed/Sun only)
  3. Refresh compatibility views (overview, ratio_wide)
  4. Update price history (OHLCV) from VCI API      — daily

DB: Uses VIETNAM_STOCK_DB_PATH env var → falls back to db_updater/vietnam_stocks.db
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
UPDATER_DIR = BASE_DIR / "backend" / "updater"

# If VIETNAM_STOCK_DB_PATH is not in the environment (i.e. no .env loaded yet),
# default to the db_updater's own DB so both pipeline and backend share one file.
if not os.environ.get("VIETNAM_STOCK_DB_PATH"):
    os.environ["VIETNAM_STOCK_DB_PATH"] = str(BASE_DIR / "vietnam_stocks.db")

# Keep BCTC freshness high by default unless explicitly overridden.
if not os.environ.get("SKIP_IF_UPDATED_WITHIN_DAYS"):
    os.environ["SKIP_IF_UPDATED_WITHIN_DAYS"] = "3"

DB_PATH = os.environ["VIETNAM_STOCK_DB_PATH"]

# ── Logging ─────────────────────────────────────────────────────────────────
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOGS_DIR / "pipeline.log"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _add_updater_to_path() -> None:
    """Ensure backend is importable."""
    if str(BASE_DIR) not in sys.path:
        sys.path.insert(0, str(BASE_DIR))


def _load_symbols() -> list[str]:
    """Load symbol list from symbols.txt, falling back to the DB stocks table."""
    symbols_file = BASE_DIR / "symbols.txt"
    if symbols_file.exists():
        symbols = [
            line.strip().upper()
            for line in symbols_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if symbols:
            logger.info(f"Loaded {len(symbols)} symbols from symbols.txt")
            return symbols

    # Fallback: query stocks table in DB
    logger.warning("symbols.txt not found — querying stocks table from DB")
    import sqlite3
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute(
            "SELECT ticker FROM stocks WHERE status = 'listed' ORDER BY ticker"
        ).fetchall()
        conn.close()
        symbols = [r[0] for r in rows if r[0]]
        if symbols:
            logger.info(f"Loaded {len(symbols)} symbols from DB stocks table")
            return symbols
    except Exception as e:
        logger.error(f"Failed to load symbols from DB: {e}")

    logger.error("No symbols found — aborting pipeline")
    return []


def _invalidate_cache_namespaces(namespaces: list[str], reason: str) -> None:
    """Bump cache namespace versions so long-running API workers drop stale keys."""
    _add_updater_to_path()
    try:
        from backend.cache_utils import cache_invalidate_namespaces

        changed = cache_invalidate_namespaces(namespaces)
        if changed:
            detail = ", ".join(f"{k}={v}" for k, v in changed.items())
            logger.info(f"🔄 Cache invalidated after {reason}: {detail}")
    except Exception as ex:
        logger.warning(f"⚠ Cache invalidation skipped after {reason}: {ex}")


# ── Step 1: Financial Reports (BCTC) ─────────────────────────────────────────

def step_update_financial_reports(symbols: list[str]) -> bool:
    """Daily: fetch balance_sheet / income / cash_flow / ratios via backend.updater."""
    _add_updater_to_path()
    try:
        from backend.updater.pipeline_steps import update_financials

        period = os.getenv("FETCH_PERIOD", "year").strip().lower() or "year"
        if period not in ("year", "quarter"):
            logger.warning(f"Invalid FETCH_PERIOD={period!r}, using 'year'")
            period = "year"

        logger.info(
            f">>> Starting: Fetching BCTC via integrated updater "
            f"(symbols={len(symbols)}, period={period}, db={DB_PATH})"
        )
        results = update_financials(symbols=symbols, period=period)

        new_records = sum(
            sum(int(v or 0) for v in payload.values())
            for payload in (results or {}).values()
            if payload
        )
        success_count = sum(
            1 for payload in (results or {}).values()
            if payload and sum(int(v or 0) for v in payload.values()) > 0
        )
        skipped_count = sum(
            1 for payload in (results or {}).values()
            if not payload
        )
        logger.info(
            f"✅ Finished: BCTC update "
            f"(updated={success_count}, skipped={skipped_count}, total={len(symbols)}, new_records={new_records})"
        )
        if new_records > 0:
            _invalidate_cache_namespaces(
                namespaces=['stock_routes', 'source_priority', 'decorator'],
                reason='financial update',
            )
        return True
    except Exception as e:
        logger.error(f"❌ Failed: BCTC update — {e}\n{__import__('traceback').format_exc()}")
        return False


# ── Step 2: Stock list + Company Info (weekly) ────────────────────────────────

def step_update_company_info(symbols: list[str]) -> bool:
    """Weekly: refresh stocks list + company overview, shareholders, officers."""
    _add_updater_to_path()
    try:
        from backend.updater.pipeline_steps import update_companies
        logger.info(f">>> Starting: Company info update ({len(symbols)} symbols)")
        count = update_companies(symbols)
        logger.info(f"✅ Finished: Company info ({count} records updated)")
        if count > 0:
            _invalidate_cache_namespaces(
                namespaces=['stock_routes', 'source_priority', 'decorator'],
                reason='company update',
            )
        return True
    except Exception as e:
        logger.error(f"❌ Failed: Company info update — {e}")
        return False


# ── Step 3: Compatibility Views ───────────────────────────────────────────────

def step_create_compat_views() -> bool:
    """Always: create/refresh overview + ratio_wide views for backend compatibility."""
    try:
        import importlib.util
        view_script = BASE_DIR / "scripts" / "create_compat_views.py"
        spec = importlib.util.spec_from_file_location("create_compat_views", view_script)
        mod = importlib.util.module_from_spec(spec)  # type: ignore
        spec.loader.exec_module(mod)  # type: ignore
        mod.create_views(DB_PATH)
        try:
            from backend.updater.valuation_datamart import refresh_valuation_datamart

            rows = refresh_valuation_datamart(DB_PATH)
            logger.info(f"✅ Finished: valuation_datamart refreshed ({rows} symbols)")
        except Exception as datamart_ex:
            logger.warning(f"⚠ valuation_datamart refresh skipped/failed: {datamart_ex}")
        logger.info("✅ Finished: Compatibility views refreshed")
        _invalidate_cache_namespaces(
            namespaces=['stock_routes', 'source_priority', 'decorator'],
            reason='compat views/datamart refresh',
        )
        return True
    except Exception as e:
        logger.error(f"❌ Failed: Compatibility views — {e}")
        return False


# ── Step 4: Batch Valuations ──────────────────────────────────────────────────

def step_batch_valuations() -> bool:
    """Daily: compute intrinsic value for all stocks and cache to valuation_cache.sqlite."""
    _add_updater_to_path()
    try:
        from backend.updater.batch_valuations import run_batch_valuations

        logger.info(">>> Starting: Batch valuation computation")
        result = run_batch_valuations()
        logger.info(
            f"✅ Finished: Batch valuations "
            f"(computed={result['computed']}, skipped={result['skipped']}, "
            f"errors={result['errors']}, total={result['total']})"
        )
        return True
    except Exception as e:
        logger.error(f"❌ Failed: Batch valuations — {e}")
        return False


# ── Step 5: Price History ─────────────────────────────────────────────────────

def step_update_price_history(symbols: list[str]) -> bool:
    """Daily: fetch historical OHLCV data from VCI API and update stock_price_history table."""
    _add_updater_to_path()
    try:
        from backend.updater.update_price_history import PriceHistoryUpdater
        
        logger.info(f">>> Starting: Price history update ({len(symbols)} symbols)")
        
        # 5 workers + 1.0 s delay keeps VCI API happy; class default is 3/1.2 s
        updater = PriceHistoryUpdater(
            max_workers=5,
            delay=1.0,
            pages_per_symbol=10,
        )

        # Run the update
        updater.run(symbols=symbols, test_mode=False)

        # Log summary
        stats = updater.stats
        logger.info(
            f"✅ Finished: Price history update "
            f"(success={stats['success']}, failed={stats['failed']}, "
            f"inserted={stats['records_inserted']})"
        )

        # Invalidate cache if new records were written
        if stats['records_inserted'] > 0:
            _invalidate_cache_namespaces(
                namespaces=['stock_routes', 'decorator'],
                reason='price history update',
            )
        
        return True
    except Exception as e:
        logger.error(f"❌ Failed: Price history update — {e}\n{__import__('traceback').format_exc()}")
        return False


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    logger.info("=" * 60)
    logger.info("🚀 STOCK DATA MAINTENANCE PIPELINE")
    logger.info(f"   DB: {DB_PATH}")
    logger.info("=" * 60)

    symbols = _load_symbols()
    if not symbols:
        return 1

    # Step 1 — financial reports (daily)
    if not step_update_financial_reports(symbols):
        logger.error("Stopping pipeline: BCTC fetch failed")
        return 1

    # Step 2 — company info (mid-week + weekly; skip on other days unless forced)
    today = datetime.now().weekday()  # 6 = Sunday
    force_company = os.getenv("FORCE_COMPANY_UPDATE", "").lower() in ("1", "true", "yes")
    # Wednesday (2) + Sunday (6) keeps profiles fresher without heavy API churn.
    if today in (2, 6) or force_company:
        step_update_company_info(symbols)
    else:
        logger.info("Skipping company info update (runs on Wed/Sun; set FORCE_COMPANY_UPDATE=1 to override)")

    # Step 3 — compat views (always)
    step_create_compat_views()

    # Step 4 — batch valuations (daily; non-blocking)
    step_batch_valuations()

    # Step 4b — batch news/events (incremental daily)
    try:
        from backend.updater.batch_news import run as run_batch_news
        logger.info(">>> Starting: Batch news/events (incremental)")
        run_batch_news(incremental=True)
        logger.info("✓ Batch news/events done")
    except Exception as exc:
        logger.warning("⚠ Batch news/events failed (non-fatal): %s", exc)

    # Step 5 — price history (daily)
    logger.info(">>> Starting: Price history update")
    if not step_update_price_history(symbols):
        logger.warning("⚠ Price history update failed (continuing pipeline)")
        # Don't stop the pipeline if price history fails

    logger.info("=" * 60)
    logger.info("✨ PIPELINE COMPLETED")
    logger.info("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

