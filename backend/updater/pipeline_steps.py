import logging
import os
import time
from .database import StockDatabase
from .updaters import FinancialUpdater, CompanyUpdater

logger = logging.getLogger(__name__)


def update_financials(symbols: list[str], period: str = 'year') -> dict:
    """Entry point for daily financial data updates.

    The rate limiter inside FinancialUpdater already enforces per-request
    delays (default 20 req/min = 3s between calls).  No extra sleep needed
    here — add ``FETCH_DELAY_SECONDS`` to the env only if you want an
    *additional* inter-symbol pause beyond the API rate limit.
    """
    extra_delay = max(0, int(float(os.getenv("FETCH_DELAY_SECONDS", "0"))) - 3)

    with StockDatabase() as db:
        updater = FinancialUpdater(db.conn, requests_per_minute=20)
        results: dict = {}
        for i, symbol in enumerate(symbols, 1):
            logger.info(f"[{i}/{len(symbols)}] {symbol}")
            res = updater.update_stock(symbol, period=period)
            results[symbol] = res
            if extra_delay > 0 and i < len(symbols):
                time.sleep(extra_delay)
        return results


def update_companies(symbols: list[str]) -> int:
    """Entry point for weekly company info updates."""
    with StockDatabase() as db:
        updater = CompanyUpdater(db.conn, requests_per_minute=30)
        count = 0
        for i, symbol in enumerate(symbols, 1):
            logger.info(f"[{i}/{len(symbols)}] Updating company: {symbol}")
            count += updater.update_overview(symbol)
        return count
