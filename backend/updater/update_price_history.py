"""
Price History Updater
Fetches historical price data from VCI API and stores in price_history.sqlite.
Stored separately from vietnam_stocks.db so it can be deleted/rebuilt independently.
"""

import os
import sys
import sqlite3
import logging
import time
import random
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Tuple

# Add backend to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data_sources.vci import VCIClient
from db_path import resolve_price_history_db_path, resolve_stocks_db_path

os.makedirs('logs', exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/price_history_update.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

PRICE_HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS stock_price_history (
    symbol  TEXT NOT NULL,
    time    TEXT NOT NULL,
    open    REAL,
    high    REAL,
    low     REAL,
    close   REAL,
    volume  INTEGER,
    PRIMARY KEY (symbol, time)
);
CREATE INDEX IF NOT EXISTS idx_ph_symbol ON stock_price_history(symbol);
CREATE INDEX IF NOT EXISTS idx_ph_time   ON stock_price_history(time);
"""


def _ensure_schema(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    for stmt in PRICE_HISTORY_SCHEMA.strip().split(';'):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)
    conn.commit()
    conn.close()


class PriceHistoryUpdater:
    """Fetches and updates historical price data for all stocks."""

    def __init__(
        self,
        max_workers: int = 3,
        delay: float = 1.2,
        pages_per_symbol: int = 5,
        incremental: bool = True,
        recent_page_size: int = 50,
        retries: int = 2,
        retry_backoff: float = 1.5,
    ):
        self.price_db_path = resolve_price_history_db_path()
        self.stocks_db_path = resolve_stocks_db_path()
        self.max_workers = max_workers
        self.delay = delay
        self.pages_per_symbol = pages_per_symbol
        self.incremental = incremental
        self.recent_page_size = recent_page_size
        self.retries = retries
        self.retry_backoff = retry_backoff

        _ensure_schema(self.price_db_path)
        logger.info(f"Price history DB: {self.price_db_path}")

        self.stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'records_inserted': 0,
            'up_to_date': 0,
            'retried_ok': 0,
        }

    def _fetch_recent_with_retry(self, symbol: str) -> Dict | None:
        """
        Fetch page 0 history with retry/backoff for transient 403/5xx or network issues.
        """
        max_attempts = self.retries + 1
        for attempt in range(1, max_attempts + 1):
            result = VCIClient.fetch_price_history(
                symbol=symbol,
                page=0,
                size=self.recent_page_size,
            )
            if result:
                if attempt > 1:
                    self.stats['retried_ok'] += 1
                return result
            if attempt < max_attempts:
                sleep_sec = (self.retry_backoff ** (attempt - 1)) + random.uniform(0, 0.4)
                time.sleep(sleep_sec)
        return None

    def get_latest_date(self, symbol: str) -> str | None:
        """Return latest trading date (YYYY-MM-DD) currently stored for symbol."""
        conn = sqlite3.connect(self.price_db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT MAX(time) FROM stock_price_history WHERE symbol = ?",
                (symbol,),
            )
            row = cursor.fetchone()
            latest = row[0] if row else None
            return str(latest) if latest else None
        finally:
            conn.close()

    def get_all_symbols(self) -> List[str]:
        """Fetch all stock symbols from the main stocks DB."""
        try:
            conn = sqlite3.connect(self.stocks_db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'")
            if cursor.fetchone():
                cursor.execute("SELECT DISTINCT ticker FROM stocks WHERE status != 'delisted' ORDER BY ticker")
            else:
                cursor.execute("SELECT DISTINCT symbol FROM overview ORDER BY symbol")
            symbols = [row[0] for row in cursor.fetchall()]
            conn.close()
            logger.info(f"Found {len(symbols)} symbols to update")
            return symbols
        except Exception as e:
            logger.error(f"Failed to fetch symbols: {e}")
            return []

    def insert_price_records(self, symbol: str, records: List[Dict]) -> int:
        """Upsert OHLCV records into price_history.sqlite. Returns inserted count."""
        if not records:
            return 0

        conn = sqlite3.connect(self.price_db_path)
        cursor = conn.cursor()
        inserted = 0

        try:
            for record in records:
                if not isinstance(record, dict):
                    continue

                trading_date = record.get('tradingDate') or record.get('time') or record.get('date')
                if not trading_date:
                    continue

                # Normalize: strip time component if present (e.g. "2026-03-17T00:00:00")
                try:
                    trading_date = str(trading_date)[:10]
                    datetime.strptime(trading_date, '%Y-%m-%d')
                except ValueError:
                    continue

                # VCI API uses openPrice/closePrice/highestPrice/lowestPrice/totalVolume
                # Fall back to short-form open/high/low/close/volume for compatibility
                open_val = record.get('openPrice') or record.get('open')
                high_val = record.get('highestPrice') or record.get('high')
                low_val = record.get('lowestPrice') or record.get('low')
                close_val = record.get('closePrice') or record.get('matchPrice') or record.get('close')
                volume_val = record.get('totalVolume') or record.get('totalMatchVolume') or record.get('volume') or 0

                cursor.execute(
                    """
                    INSERT INTO stock_price_history (symbol, time, open, high, low, close, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(symbol, time) DO UPDATE SET
                        open   = excluded.open,
                        high   = excluded.high,
                        low    = excluded.low,
                        close  = excluded.close,
                        volume = excluded.volume
                    """,
                    (
                        symbol,
                        trading_date,
                        open_val,
                        high_val,
                        low_val,
                        close_val,
                        volume_val,
                    ),
                )
                inserted += 1

            conn.commit()
        except Exception as e:
            logger.error(f"DB write error for {symbol}: {e}")
            conn.rollback()
        finally:
            conn.close()

        return inserted

    def fetch_and_store_symbol(self, symbol: str) -> Dict:
        try:
            if self.incremental:
                latest_date = self.get_latest_date(symbol)
                # If symbol is missing from DB, bootstrap with full backfill.
                if latest_date:
                    result = self._fetch_recent_with_retry(symbol)
                    if not result:
                        return {'symbol': symbol, 'success': False, 'error': 'No data', 'inserted': 0}

                    records = result.get('data') if isinstance(result, dict) else []
                    if not isinstance(records, list):
                        records = []

                    new_records = []
                    for record in records:
                        trading_date = str(record.get('tradingDate') or record.get('time') or record.get('date') or '')[:10]
                        if trading_date and trading_date > latest_date:
                            new_records.append(record)

                    if not new_records:
                        return {'symbol': symbol, 'success': True, 'inserted': 0, 'up_to_date': True}

                    inserted = self.insert_price_records(symbol, new_records)
                    logger.info(f"+ {symbol}: incremental {len(new_records)} new, {inserted} upserted")
                    return {'symbol': symbol, 'success': True, 'inserted': inserted}

            records = VCIClient.fetch_price_history_batch(
                symbol=symbol,
                pages=self.pages_per_symbol,
                size=self.recent_page_size,
                delay=self.delay,
            )
            if not records:
                return {'symbol': symbol, 'success': False, 'error': 'No data', 'inserted': 0}

            inserted = self.insert_price_records(symbol, records)
            logger.info(f"+ {symbol}: {len(records)} fetched, {inserted} upserted")
            return {'symbol': symbol, 'success': True, 'inserted': inserted}

        except Exception as e:
            logger.error(f"x {symbol}: {e}")
            return {'symbol': symbol, 'success': False, 'error': str(e), 'inserted': 0}

    def run(self, symbols: List[str] = None, test_mode: bool = False):
        start_time = time.time()
        logger.info("=" * 70)
        logger.info(
            f"Price History Update — {self.pages_per_symbol} pages x {self.recent_page_size} = "
            f"~{self.pages_per_symbol * self.recent_page_size} candles per symbol"
        )
        logger.info("=" * 70)

        if symbols is None:
            symbols = self.get_all_symbols()
        if test_mode:
            symbols = symbols[:5]
            logger.info(f"TEST MODE: {len(symbols)} symbols only")

        self.stats['total'] = len(symbols)
        if not symbols:
            logger.error("No symbols to process")
            return

        logger.info(f"Processing {len(symbols)} symbols with {self.max_workers} workers…")
        failed_symbols = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_symbol = {
                executor.submit(self.fetch_and_store_symbol, sym): sym
                for sym in symbols
            }
            for future in as_completed(future_to_symbol):
                result = future.result()
                if result['success']:
                    self.stats['success'] += 1
                    self.stats['records_inserted'] += result.get('inserted', 0)
                    if result.get('up_to_date'):
                        self.stats['up_to_date'] += 1
                else:
                    self.stats['failed'] += 1
                    failed_symbols.append(result['symbol'])

        elapsed = time.time() - start_time
        logger.info("=" * 70)
        logger.info(f"Done — {self.stats['success']}/{self.stats['total']} ok, "
                    f"{self.stats['records_inserted']} records upserted, {elapsed:.1f}s")
        if self.incremental:
            logger.info(f"Up-to-date symbols: {self.stats['up_to_date']}")
            logger.info(f"Recovered by retry: {self.stats['retried_ok']}")
        if failed_symbols:
            logger.warning(f"Failed ({len(failed_symbols)}): {', '.join(failed_symbols[:30])}")
            if len(failed_symbols) > 30:
                logger.warning(f"  … and {len(failed_symbols) - 30} more")


def main():
    os.makedirs('logs', exist_ok=True)
    test_mode = '--test' in sys.argv or '-t' in sys.argv

    symbols = None
    if '--symbols' in sys.argv:
        idx = sys.argv.index('--symbols')
        if idx + 1 < len(sys.argv):
            symbols = sys.argv[idx + 1].split(',')

    incremental = '--full' not in sys.argv

    updater = PriceHistoryUpdater(
        max_workers=3,
        delay=1.2,
        pages_per_symbol=5,
        incremental=incremental,
        retries=2,
        retry_backoff=1.5,
    )
    updater.run(symbols=symbols, test_mode=test_mode)


if __name__ == '__main__':
    main()
