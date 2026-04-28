"""
Beta and WACC calculator for Vietnamese stocks.

Data sources:
- vci_index_history.sqlite  → market_index_history (VN30 preferred, VNINDEX fallback)
- price_history.sqlite      → stock_price_history

When price_history is populated, Beta becomes a real regression.
Until then: WACC = Rf(4.5%) + 1.0 × ERP(9%) = 13.5% — reasonable for VN market.
"""
from __future__ import annotations

import logging
import math
import sqlite3

from backend.db_path import resolve_index_history_db_path, resolve_price_history_db_path

logger = logging.getLogger(__name__)

# ── Vietnam market constants ──────────────────────────────────────────────────
RF_RATE = 0.045    # Risk-free: VN 10-year government bond ~4.5%
ERP = 0.09         # Equity Risk Premium Vietnam ~9%
FALLBACK_BETA = 1.0


def _get_index_closes(index_symbol: str = 'VN30', limit: int = 530) -> list[float]:
    """Daily closing prices from market_index_history, oldest-first."""
    db_path = resolve_index_history_db_path()
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            """
            SELECT closeIndex FROM market_index_history
            WHERE symbol = ?
            ORDER BY tradingDate ASC
            LIMIT ?
            """,
            (index_symbol, limit),
        ).fetchall()
        conn.close()
        return [float(r[0]) for r in rows if r[0] is not None and float(r[0]) > 0]
    except Exception as exc:
        logger.debug(f"Index closes failed for {index_symbol}: {exc}")
        return []


def _get_stock_closes(ticker: str, limit: int = 530) -> list[float]:
    """Daily closing prices from stock_price_history, oldest-first."""
    db_path = resolve_price_history_db_path()
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            """
            SELECT close FROM stock_price_history
            WHERE symbol = ?
            ORDER BY time ASC
            LIMIT ?
            """,
            (ticker.upper(), limit),
        ).fetchall()
        conn.close()
        return [float(r[0]) for r in rows if r[0] is not None and float(r[0]) > 0]
    except Exception as exc:
        logger.debug(f"Stock closes failed for {ticker}: {exc}")
        return []


def _log_returns(prices: list[float]) -> list[float]:
    return [math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0]


def _beta_ols(stock_ret: list[float], index_ret: list[float]) -> tuple[float, int]:
    """OLS Beta = Cov(stock, index) / Var(index). Returns (beta, n_obs)."""
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
    raw_beta = cov / var_x
    # Clamp to a sensible range; Blume-adjust toward 1.0 (2/3 raw + 1/3 × 1.0)
    raw_beta = max(-2.0, min(4.0, raw_beta))
    adjusted = 0.67 * raw_beta + 0.33 * 1.0
    return float(round(adjusted, 3)), n


def calculate_beta(ticker: str, lookback_days: int = 252) -> dict:
    """
    Beta vs VN30 (falls back to VNINDEX, then to 1.0).

    Returns:
        beta: float
        n_obs: int
        index_used: str
        is_fallback: bool
    """
    stock_prices = _get_stock_closes(ticker, limit=lookback_days + 20)

    if len(stock_prices) < 30:
        return {
            'beta': FALLBACK_BETA,
            'n_obs': 0,
            'index_used': 'fallback',
            'is_fallback': True,
            'note': 'price_history not populated — using market beta=1.0',
        }

    stock_ret = _log_returns(stock_prices)

    for index_sym in ('VN30', 'VNINDEX'):
        index_prices = _get_index_closes(index_sym, limit=lookback_days + 20)
        if len(index_prices) < 30:
            continue
        index_ret = _log_returns(index_prices)
        beta, n = _beta_ols(stock_ret, index_ret)
        return {
            'beta': beta,
            'n_obs': n,
            'index_used': index_sym,
            'is_fallback': False,
        }

    return {
        'beta': FALLBACK_BETA,
        'n_obs': 0,
        'index_used': 'fallback',
        'is_fallback': True,
        'note': 'insufficient index history',
    }


def suggest_wacc(
    ticker: str,
    is_bank: bool = False,
    tax_rate: float = 0.20,
    debt_weight: float = 0.0,
    cost_of_debt: float = 0.08,
) -> dict:
    """
    Suggest WACC from Beta (CAPM-based).

    Simplified: no debt structure → WACC ≈ Ke = Rf + β × ERP.
    Banks get a 10% ERP premium (higher regulatory leverage risk).

    Returns:
        wacc: float (decimal, e.g. 0.135)
        ke: float
        beta: float
        rf: float
        erp: float
        is_fallback: bool
    """
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
        'is_fallback': beta_result['is_fallback'],
        'beta_source': beta_result.get('index_used', 'fallback'),
        'note': beta_result.get('note', ''),
    }
