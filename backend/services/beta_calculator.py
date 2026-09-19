"""
Beta and WACC calculator for Vietnamese stocks.

Source priority:
1. fireant_macro.sqlite → beta_cache (weekly batch fetch, freshest within 8 days)
2. FireAnt API live     → /symbols/{ticker}/fundamental (on cache miss)
3. OLS regression       → vci_price_history.sqlite vs vci_index_history.sqlite (VN30)
4. Fallback 1.0

WACC = Rf + β × ERP  (CAPM, simplified — no debt structure)
  Rf  = 4.5%  (VN 10-year government bond)
  ERP = 9.0%  (Vietnam equity risk premium); banks get +10% premium
"""
from __future__ import annotations

import logging
import math
import sqlite3
import time
import urllib.request

from backend.db_path import resolve_index_history_db_path, resolve_price_history_db_path, resolve_fireant_macro_db_path

logger = logging.getLogger(__name__)

RF_RATE = 0.045
ERP = 0.09
FALLBACK_BETA = 1.0

_FIREANT_BEARER = (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IkdYdExONzViZlZQakdvNERWdjV4QkRI"
    "THpnSSIsImtpZCI6IkdYdExONzViZlZQakdvNERWdjV4QkRITHpnSSJ9.eyJpc3MiOiJodHRwczov"
    "L2FjY291bnRzLmZpcmVhbnQudm4iLCJhdWQiOiJodHRwczovL2FjY291bnRzLmZpcmVhbnQudm4v"
    "cmVzb3VyY2VzIiwiZXhwIjoxODg5NjIyNTMwLCJuYmYiOjE1ODk2MjI1MzAsImNsaWVudF9pZCI6"
    "ImZpcmVhbnQudHJhZGVzdGF0aW9uIiwic2NvcGUiOlsiYWNhZGVteS1yZWFkIiwiYWNhZGVteS13"
    "cml0ZSIsImFjY291bnRzLXJlYWQiLCJhY2NvdW50cy13cml0ZSIsImJsb2ctcmVhZCIsImNvbXBh"
    "bmllcy1yZWFkIiwiZmluYW5jZS1yZWFkIiwiaW5kaXZpZHVhbHMtcmVhZCIsImludmVzdG9wZWRp"
    "YS1yZWFkIiwib3JkZXJzLXJlYWQiLCJvcmRlcnMtd3JpdGUiLCJwb3N0cy1yZWFkIiwicG9zdHMt"
    "d3JpdGUiLCJzZWFyY2giLCJzeW1ib2xzLXJlYWQiLCJ1c2VyLWRhdGEtcmVhZCIsInVzZXItZGF0"
    "YS13cml0ZSIsInVzZXJzLXJlYWQiXSwianRpIjoiMjYxYTZhYWQ2MTQ5Njk1ZmJiYzcwODM5MjM0"
    "Njc1NWQifQ.dA5-HVzWv-BRfEiAd24uNBiBxASO-PAyWeWESovZm_hj4aXMAZA1-bWNZeXt88dqo"
    "go18AwpDQ-h6gefLPdZSFrG5umC1dVWaeYvUnGm62g4XS29fj6p01dhKNNqrsu5KrhnhdnKYVv9Vd"
    "mbmqDfWR8wDgglk5cJFqalzq6dJWJInFQEPmUs9BW_Zs8tQDn-i5r4tYq2U8vCdqptXoM7YgPllX"
    "aPVDeccC9QNu2Xlp9WUvoROzoQXg25lFub1IYkTrM66gJ6t9fJRZToewCt495WNEOQFa_rwLCZ1Qw"
    "zvL0iYkONHS_jZ0BOhBCdW9dWSawD6iF1SIQaFROvMDH1rg"
)

# Simple in-process cache: {ticker: (beta, timestamp)}
_fireant_cache: dict[str, tuple[float, float]] = {}
_CACHE_TTL = 86400  # 24 hours


def _get_beta_from_sqlite(ticker: str, max_age_days: int = 8) -> float | None:
    """Read beta from beta_cache table in fireant_macro.sqlite."""
    try:
        db_path = resolve_fireant_macro_db_path()
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT beta, fetched_at FROM beta_cache WHERE symbol = ?",
            (ticker.upper(),),
        ).fetchone()
        conn.close()
        if row:
            beta, fetched_at = row
            # Check freshness
            from datetime import datetime, timezone
            try:
                ts = datetime.strptime(fetched_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                age_days = (datetime.now(timezone.utc) - ts).days
                if age_days <= max_age_days and 0 < beta < 10:
                    return float(beta)
            except Exception:
                pass
    except Exception as exc:
        logger.debug("beta_cache read failed for %s: %s", ticker, exc)
    return None


def _get_fireant_beta(ticker: str) -> float | None:
    """Fetch beta from FireAnt /symbols/{ticker}/fundamental. Cached 24h."""
    import json

    cached = _fireant_cache.get(ticker.upper())
    if cached and (time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]

    url = f"https://restv2.fireant.vn/symbols/{ticker.upper()}/fundamental"
    req = urllib.request.Request(url, headers={
        "authorization": f"Bearer {_FIREANT_BEARER}",
        "origin": "https://fireant.vn",
        "referer": "https://fireant.vn/",
        "accept": "application/json",
        "user-agent": "Mozilla/5.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        beta = data.get("beta")
        if beta is not None and isinstance(beta, (int, float)) and 0 < float(beta) < 5:
            beta = float(round(beta, 3))
            _fireant_cache[ticker.upper()] = (beta, time.time())
            return beta
    except Exception as exc:
        logger.debug("FireAnt beta fetch failed for %s: %s", ticker, exc)
    return None


def _get_dated_closes(db_path: str, table: str, date_col: str, close_col: str,
                      symbol: str, limit: int) -> dict[str, float]:
    conn = None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows = conn.execute(
            f"SELECT {date_col}, {close_col} FROM {table} WHERE symbol = ? "
            f"ORDER BY {date_col} DESC LIMIT ?", (symbol.upper(), limit),
        ).fetchall()
        return {str(day)[:10]: float(close) for day, close in rows
                if close is not None and math.isfinite(float(close)) and float(close) > 0}
    except sqlite3.Error as exc:
        logger.debug("Price history failed for %s: %s", symbol, exc)
        return {}
    finally:
        if conn is not None:
            conn.close()


def _aligned_returns(stock: dict[str, float], index: dict[str, float],
                     lookback: int) -> tuple[list[float], list[float]]:
    # Both returns must cover exactly the same start/end trading dates.
    days = sorted(stock.keys() & index.keys())[-(lookback + 1):]
    return (_log_returns([stock[d] for d in days]),
            _log_returns([index[d] for d in days]))


def _log_returns(prices: list[float]) -> list[float]:
    return [math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0]


def _beta_ols(stock_ret: list[float], index_ret: list[float]) -> tuple[float, int]:
    """OLS Beta = Cov(stock, index) / Var(index). Blume-adjusted."""
    n = min(len(stock_ret), len(index_ret))
    if n < 30:
        return FALLBACK_BETA, n
    x = index_ret[-n:]
    y = stock_ret[-n:]
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    cov = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n)) / (n - 1)
    var_x = sum((x[i] - mean_x) ** 2 for i in range(n)) / (n - 1)
    if var_x <= 0:
        return FALLBACK_BETA, n
    raw_beta = max(-2.0, min(4.0, cov / var_x))
    adjusted = 0.67 * raw_beta + 0.33 * 1.0
    return float(round(adjusted, 3)), n


def calculate_beta(ticker: str, lookback_days: int = 252) -> dict:
    """
    Beta calculation with source priority:
      1. FireAnt API (live, ~1yr history)
      2. OLS regression vs VN30 / VNINDEX
      3. Fallback 1.0
    """
    # 1. SQLite beta_cache (weekly batch)
    sqlite_beta = _get_beta_from_sqlite(ticker)
    if sqlite_beta is not None:
        return {
            'beta': sqlite_beta,
            'n_obs': 252,
            'index_used': 'fireant',
            'is_fallback': False,
        }

    # 2. FireAnt live (on cache miss)
    fa_beta = _get_fireant_beta(ticker)
    if fa_beta is not None:
        return {
            'beta': fa_beta,
            'n_obs': 252,
            'index_used': 'fireant',
            'is_fallback': False,
        }

    # 3. OLS on the most recent common trading dates.
    stock_prices = _get_dated_closes(
        resolve_price_history_db_path(), 'stock_price_history', 'time', 'close',
        ticker, lookback_days + 20,
    )
    for index_sym in ('VN30', 'VNINDEX'):
        index_prices = _get_dated_closes(
            resolve_index_history_db_path(), 'market_index_history', 'tradingDate',
            'closeIndex', index_sym, lookback_days + 20,
        )
        stock_ret, index_ret = _aligned_returns(stock_prices, index_prices, lookback_days)
        if len(stock_ret) < 30 or len(set(index_ret)) < 2:
            continue
        beta, n = _beta_ols(stock_ret, index_ret)
        return {
            'beta': beta,
            'n_obs': n,
            'index_used': index_sym,
            'is_fallback': False,
        }

    # 3. Fallback
    return {
        'beta': FALLBACK_BETA,
        'n_obs': 0,
        'index_used': 'fallback',
        'is_fallback': True,
        'note': 'no beta data available',
    }


def suggest_wacc(
    ticker: str,
    is_bank: bool = False,
    tax_rate: float = 0.20,
    debt_weight: float = 0.0,
    cost_of_debt: float = 0.08,
) -> dict:
    """CAPM-based WACC. Banks get 10% ERP premium for regulatory leverage risk."""
    beta_result = calculate_beta(ticker)
    beta = beta_result['beta']
    erp_used = ERP * 1.1 if is_bank else ERP
    ke = RF_RATE + beta * erp_used
    if debt_weight > 0:
        equity_weight = 1.0 - debt_weight
        wacc = equity_weight * ke + debt_weight * cost_of_debt * (1.0 - tax_rate)
    else:
        wacc = ke
    wacc = max(0.08, min(0.35, wacc))
    return {
        'wacc': float(round(wacc, 4)),
        'ke': float(round(ke, 4)),
        'beta': beta,
        'rf': RF_RATE,
        'erp': float(round(erp_used, 4)),
        'debt_weight': float(round(debt_weight, 4)),
        'cost_of_debt': float(round(cost_of_debt, 4)),
        'is_fallback': beta_result['is_fallback'],
        'beta_source': beta_result.get('index_used', 'fallback'),
        'note': beta_result.get('note', ''),
    }
