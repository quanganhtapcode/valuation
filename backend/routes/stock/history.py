from __future__ import annotations

import json
import gzip
import os
import tempfile
import threading
from pathlib import Path
import logging
import math
import sqlite3
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import List, Dict

from flask import Blueprint, jsonify, request

from backend.utils import validate_stock_symbol
from backend.db_path import resolve_price_history_db_path
from backend.data_sources.vci import VCIClient
from backend.cache_utils import cache_get_ns, cache_set_ns


logger = logging.getLogger(__name__)


# Keep adjusted candles separate from the raw price-history database.
_HISTORY_CACHE_DIR = Path(__file__).resolve().parents[3] / 'data' / 'cache' / 'chart_history'
_HISTORY_TIMEOUT_SECONDS = 2
_HISTORY_ATTEMPTS = 2
_HISTORY_FAILURE_TTL = 30
_REFRESH_LOCK = threading.Lock()
_REFRESHING: set[str] = set()
_REFRESH_SLOTS = threading.BoundedSemaphore(4)


def _expected_session_date() -> str:
    vn = datetime.now(timezone(timedelta(hours=7)))
    # Before opening, yesterday is the latest possible session.
    if vn.hour < 9:
        vn -= timedelta(days=1)
    while vn.weekday() >= 5:
        vn -= timedelta(days=1)
    return vn.strftime('%Y-%m-%d')


def _history_is_behind(rows: list[dict]) -> bool:
    # This is a refresh hint, not a trading calendar (holidays may have no bar).
    return not rows or rows[-1]['date'] < _expected_session_date()



def _read_chart_cache(key: str) -> dict:
    try:
        payload = json.loads((_HISTORY_CACHE_DIR / f'{key}.json').read_text())
        if isinstance(payload, dict) and isinstance(payload.get('rows'), list):
            return payload
    except (OSError, ValueError):
        pass
    return {}


def _write_chart_cache(key: str, rows: list[dict]) -> None:
    temporary = None
    try:
        _HISTORY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', dir=_HISTORY_CACHE_DIR, delete=False) as handle:
            temporary = handle.name
            json.dump({'saved_at': time.time(), 'rows': rows}, handle)
        os.replace(temporary, _HISTORY_CACHE_DIR / f'{key}.json')
    except OSError:
        logger.warning('Unable to persist adjusted chart history', exc_info=True)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _vietcap_cache_ttl(now: datetime | None = None) -> int:
    vn = (now or datetime.now(timezone.utc)).astimezone(timezone(timedelta(hours=7)))
    minute = vn.hour * 60 + vn.minute
    if vn.weekday() < 5 and 540 <= minute <= 930:
        return 15 * 60
    # Do not let an overnight cache survive into the next opening session.
    opening = vn.replace(hour=9, minute=0, second=0, microsecond=0)
    if opening <= vn:
        opening += timedelta(days=1)
    while opening.weekday() >= 5:
        opening += timedelta(days=1)
    return max(1, min(3600, int((opening - vn).total_seconds())))


def _valid_candles(rows: list[dict]) -> list[dict]:
    """Missing/non-finite OHLC must not become artificial zero-price candles."""
    valid = []
    for row in rows:
        try:
            if all(math.isfinite(float(row[k])) and float(row[k]) > 0
                   for k in ('open', 'high', 'low', 'close')):
                valid.append(row)
        except (KeyError, TypeError, ValueError):
            continue
    return valid


def register(stock_bp: Blueprint) -> None:
    def get_price_history_from_db(symbol: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """
        Fetch price history from SQLite database.
        
        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date
            
        Returns:
            List of price records
        """
        try:
            db_path = resolve_price_history_db_path()
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT time as date, open, high, low, close, volume
                FROM stock_price_history
                WHERE symbol = ? AND time >= ? AND time <= ?
                ORDER BY time ASC
            ''', (symbol, start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')))
            
            rows = cursor.fetchall()
            conn.close()
            
            if not rows:
                return []
            
            # Convert to list of dicts
            result = []
            for row in rows:
                result.append({
                    'date': row['date'],
                    'open': float(row['open']) if row['open'] is not None else 0.0,
                    'high': float(row['high']) if row['high'] is not None else 0.0,
                    'low': float(row['low']) if row['low'] is not None else 0.0,
                    'close': float(row['close']) if row['close'] is not None else 0.0,
                    'volume': float(row['volume']) if row['volume'] is not None else 0.0,
                })
            
            return _valid_candles(result)
            
        except Exception as e:
            logger.error(f"Error fetching price history from DB for {symbol}: {e}")
            return []
    
    def get_price_history_from_vietcap(symbol: str, count_back: int, time_frame: str = "ONE_DAY", *, force: bool = False) -> List[Dict]:
        """
        Fetch gap-adjusted OHLC price history from Vietcap API.
        This handles stock splits correctly — prices are adjusted for continuity.
        Results are cached in-memory (15 min during session, 60 min after close).

        Args:
            symbol: Stock symbol
            count_back: Number of bars to fetch
            time_frame: Vietcap timeFrame string ("ONE_DAY", "ONE_WEEK", "ONE_MONTH")

        Returns:
            List of price records sorted by date ascending
        """
        cache_key = f"{symbol}:{count_back}:{time_frame}"
        disk_key = f"{symbol}_{count_back}_{time_frame}"
        cached = cache_get_ns("vietcapHistory", cache_key)
        if cached is not None and not force:
            return cached

        saved = _read_chart_cache(disk_key)
        saved_rows = _valid_candles(saved.get('rows', []))
        if not force and saved_rows and time.time() - saved.get('saved_at', 0) < _vietcap_cache_ttl():
            return saved_rows
        if not force and cache_get_ns('vietcapHistoryFailure', cache_key) is not None:
            return saved_rows

        try:
            now_ts = int(time.time())
            body = json.dumps(
                {"symbols": [symbol], "timeFrame": time_frame, "countBack": count_back, "to": now_ts},
                separators=(',', ':')
            ).encode()

            req = urllib.request.Request(
                "https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Origin": "https://trading.vietcap.com.vn",
                    "Referer": f"https://trading.vietcap.com.vn/iq/company?tab=overview&ticker={symbol}&isIndex=false",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                },
                method="POST",
            )

            # Retry on a new connection: upstream sometimes stalls after TLS.
            for attempt in range(_HISTORY_ATTEMPTS):
                try:
                    with urllib.request.urlopen(req, timeout=_HISTORY_TIMEOUT_SECONDS) as resp:
                        body = resp.read()
                        if resp.headers.get('Content-Encoding', '').lower() == 'gzip' or body[:2] == b'\x1f\x8b':
                            body = gzip.decompress(body)
                        raw = json.loads(body.decode())
                    if not isinstance(raw, list) or not raw:
                        raise ValueError('Vietcap returned no chart series')
                    break
                except Exception:
                    if attempt + 1 == _HISTORY_ATTEMPTS:
                        raise

            # Response: [{"symbol":"X","o":[...],"h":[...],"l":[...],"c":[...],"v":[...],"t":[...]}]
            if not raw or not isinstance(raw, list):
                return []

            item = raw[0]
            timestamps = item.get("t") or []
            opens      = item.get("o") or []
            highs      = item.get("h") or []
            lows       = item.get("l") or []
            closes     = item.get("c") or []
            volumes    = item.get("v") or []

            result = []
            for i, ts in enumerate(timestamps):
                # Timestamps may be strings or numbers, in seconds or milliseconds
                ts = float(ts)
                if ts > 1e10:
                    ts = ts / 1000
                date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                result.append({
                    "date":   date_str,
                    "open":   float(opens[i] or 0)   if i < len(opens)   else 0.0,
                    "high":   float(highs[i] or 0)   if i < len(highs)   else 0.0,
                    "low":    float(lows[i] or 0)    if i < len(lows)    else 0.0,
                    "close":  float(closes[i] or 0)  if i < len(closes)  else 0.0,
                    "volume": float(volumes[i] or 0) if i < len(volumes) else 0.0,
                })

            result = sorted(_valid_candles(result), key=lambda x: x["date"])
            if result:
                cache_set_ns("vietcapHistory", cache_key, result, ttl=_vietcap_cache_ttl())
                _write_chart_cache(disk_key, result)
            else:
                cache_set_ns('vietcapHistoryFailure', cache_key, True, ttl=_HISTORY_FAILURE_TTL)
            return result or saved_rows

        except Exception as e:
            logger.warning('Vietcap chart failed for %s after %s attempts: %s: %s',
                           symbol, _HISTORY_ATTEMPTS, type(e).__name__, e)
            cache_set_ns('vietcapHistoryFailure', cache_key, True, ttl=_HISTORY_FAILURE_TTL)
            return saved_rows

    def refresh_chart_in_background(symbol: str, count_back: int) -> None:
        key = f'{symbol}:{count_back}:ONE_DAY'
        with _REFRESH_LOCK:
            if key in _REFRESHING or cache_get_ns('chartRefreshCooldown', key) is not None:
                return
            if not _REFRESH_SLOTS.acquire(blocking=False):
                return
            _REFRESHING.add(key)
            cache_set_ns('chartRefreshCooldown', key, True, ttl=60)

        def refresh() -> None:
            try:
                for attempt in range(6):
                    rows = get_price_history_from_vietcap(symbol, count_back, force=True)
                    if rows and not _history_is_behind(rows):
                        break
                    if attempt < 5:
                        time.sleep(2)
            finally:
                with _REFRESH_LOCK:
                    _REFRESHING.discard(key)
                    _REFRESH_SLOTS.release()

        threading.Thread(target=refresh, name=f'chart-refresh-{symbol}', daemon=True).start()

    def get_price_history_from_vci(symbol: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """
        Fetch price history from VCI API as fallback.
        
        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date
            
        Returns:
            List of price records
        """
        try:
            # Fetch from VCI API (single page for fallback)
            records = VCIClient.fetch_price_history_batch(symbol=symbol, pages=1, size=250, delay=0)
            
            if not records:
                return []
            
            # Filter by date range and convert format
            result = []
            for record in records:
                trading_date_str = str(record.get('tradingDate') or record.get('time') or record.get('date') or '')[:10]
                try:
                    trading_date = datetime.strptime(trading_date_str, '%Y-%m-%d')
                    if start_date <= trading_date <= end_date:
                        result.append({
                            'date': trading_date_str,
                            'open': float(record.get('openPrice') or record.get('open') or 0),
                            'high': float(record.get('highestPrice') or record.get('high') or 0),
                            'low': float(record.get('lowestPrice') or record.get('low') or 0),
                            'close': float(record.get('closePrice') or record.get('matchPrice') or record.get('close') or 0),
                            'volume': float(record.get('totalVolume') or record.get('totalMatchVolume') or record.get('volume') or 0),
                        })
                except (ValueError, TypeError):
                    continue
            
            return sorted(_valid_candles(result), key=lambda x: x['date'])
            
        except Exception as e:
            logger.error(f"Error fetching price history from VCI for {symbol}: {e}")
            return []
    
    @stock_bp.route("/stock/history/<symbol>")
    def get_stock_history(symbol):
        """Get historical price data for charting (returns last 6M to 10Y based on param)."""
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result, "success": False}), 400
            symbol = result

            try:
                range_param = request.args.get("period", request.args.get("range", "6M")).upper()
                # Map range to countBack (trading days, ~252/year)
                count_map = {"1M": 25, "3M": 65, "6M": 130, "1Y": 260, "2Y": 520, "3Y": 780, "5Y": 1300, "ALL": 2520}
                count_back = count_map.get(range_param, 130)

                days_map = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825, "ALL": 3650}
                days_back = days_map.get(range_param, 180)
                end_date = datetime.now()
                start_date = end_date - timedelta(days=days_back)

                # Primary: Vietcap gap-adjusted API (handles stock splits)
                history_data = get_price_history_from_vietcap(symbol, count_back)
                data_source = "vietcap"

                # A saved adjusted series must not hide a newer committed DB session.
                db_history = get_price_history_from_db(symbol, start_date, end_date)
                if history_data and db_history and db_history[-1]['date'] > history_data[-1]['date']:
                    history_data = db_history
                    data_source = 'sqlite'

                # Fallback 1: SQLite DB
                if not history_data:
                    logger.info(f"Vietcap unavailable for {symbol}, falling back to DB")
                    history_data = db_history
                    data_source = "sqlite"

                # Fallback 2: VCI API
                if not history_data:
                    logger.info(f"No DB data for {symbol}, falling back to VCI API")
                    history_data = get_price_history_from_vci(symbol, start_date, end_date)
                    data_source = "vci_api"

                if data_source != 'vietcap' or _history_is_behind(history_data):
                    refresh_chart_in_background(symbol, count_back)

                if not history_data:
                    return jsonify({"success": False, "message": "No historical data available"}), 404

                response = jsonify({"symbol": symbol, "data": history_data, "count": len(history_data),
                                    "success": True, "source": data_source,
                                    "latest_date": history_data[-1]['date']})
                response.headers['Cache-Control'] = 'no-store'
                return response
            except Exception as e:
                logger.error(f"Error fetching history for {symbol}: {e}")
                return jsonify({"success": False, "error": str(e)}), 500
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/history/<symbol>")
    def api_history_legacy(symbol):
        """Legacy endpoint for history (flexible start/end dates)."""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=365)
            start_str = request.args.get("start", start_date.strftime("%Y-%m-%d"))
            end_str = request.args.get("end", end_date.strftime("%Y-%m-%d"))

            start_date = datetime.strptime(start_str, "%Y-%m-%d")
            end_date = datetime.strptime(end_str, "%Y-%m-%d")
            days_back = (end_date - start_date).days
            count_back = max(25, int(days_back * 252 / 365))

            # Primary: Vietcap gap-adjusted API
            history_data = get_price_history_from_vietcap(symbol, count_back)

            # Filter to requested date range
            if history_data:
                start_str_filter = start_date.strftime("%Y-%m-%d")
                end_str_filter = end_date.strftime("%Y-%m-%d")
                history_data = [r for r in history_data if start_str_filter <= r["date"] <= end_str_filter]

            # Fallback to DB
            if not history_data:
                history_data = get_price_history_from_db(symbol, start_date, end_date)

            # Fallback to VCI
            if not history_data:
                logger.info(f"No DB data for {symbol}, falling back to VCI API")
                history_data = get_price_history_from_vci(symbol, start_date, end_date)

            return jsonify({"success": True, "data": history_data})
        except Exception as exc:
            logger.error(f"Error in legacy history endpoint for {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

