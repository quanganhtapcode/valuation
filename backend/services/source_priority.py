import json
import logging
import os
import sqlite3
from typing import Callable

import numpy as np

from backend.cache_utils import cache_get_ns, cache_set_ns
from backend.db_path import (
    resolve_vci_screening_db_path,
    resolve_vci_stats_financial_db_path,
    resolve_vci_ratio_daily_db_path,
)

logger = logging.getLogger(__name__)

VCI_METRICS_SOURCE = "vci_screening.sqlite"
VCI_STATS_FINANCIAL_SOURCE = "vci_stats_financial.sqlite"
VCI_RATIO_DAILY_SOURCE = "vci_ratio_daily.sqlite"
SOURCE_PRIORITY_LABEL = "vci_ratio_daily -> vci_stats_financial -> vci_screening -> vietnam_stocks -> vnstock"

_LOCAL_CACHE_NAMESPACE = "source_priority"
_LOCAL_CACHE_TTL_SECONDS = 600


CacheGet = Callable[[str], object]
CacheSet = Callable[[str, object], None]


def _to_json_number(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        v = float(value)
        if np.isnan(v) or np.isinf(v):
            return default
        return v
    except Exception:
        return default


def _normalize_percent_value(value) -> float | None:
    try:
        if value is None:
            return None
        v = float(value)
        if np.isnan(v) or np.isinf(v):
            return None
        if abs(v) <= 1:
            return float(v * 100.0)
        return float(v)
    except Exception:
        return None


def _cache_get(cache_get: CacheGet | None, key: str):
    if cache_get:
        return cache_get(key)
    return cache_get_ns(_LOCAL_CACHE_NAMESPACE, key)


def _cache_set(cache_set: CacheSet | None, key: str, value):
    if cache_set:
        cache_set(key, value)
        return
    cache_set_ns(_LOCAL_CACHE_NAMESPACE, key, value, ttl=_LOCAL_CACHE_TTL_SECONDS)


def _load_screening_rows(symbols: list[str]) -> dict[str, dict]:
    db_path = resolve_vci_screening_db_path()
    if not db_path or not os.path.exists(db_path):
        return {}

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='screening_data'")
        if cur.fetchone() is None:
            return {}

        cols = {
            str(r[1])
            for r in cur.execute("PRAGMA table_info(screening_data)").fetchall() or []
            if len(r) > 1
        }
        wanted = [
            "ticker",
            "ttmPe",
            "ttmPb",
            "ttmRoe",
            "marketCap",
            "npatmiGrowthYoyQm1",
            "netMargin",
            "grossMargin",
            "revenueGrowthYoy",
        ]
        selected = [c for c in wanted if c in cols]
        if "ticker" not in selected:
            return {}

        unique_symbols = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
        if not unique_symbols:
            return {}

        placeholders = ",".join(["?"] * len(unique_symbols))
        rows = cur.execute(
            f"SELECT {', '.join(selected)} FROM screening_data WHERE UPPER(ticker) IN ({placeholders})",
            unique_symbols,
        ).fetchall()

        out: dict[str, dict] = {}
        for row in rows:
            symbol = str(row["ticker"]).upper().strip()
            row_keys = row.keys()
            out[symbol] = {
                "pe":             _to_json_number(row["ttmPe"])                          if "ttmPe"               in row_keys else 0.0,
                "pb":             _to_json_number(row["ttmPb"])                          if "ttmPb"               in row_keys else 0.0,
                "roe":            _normalize_percent_value(row["ttmRoe"])                if "ttmRoe"              in row_keys else None,
                "market_cap":     _to_json_number(row["marketCap"])                      if "marketCap"           in row_keys else 0.0,
                "profit_growth":  _normalize_percent_value(row["npatmiGrowthYoyQm1"])   if "npatmiGrowthYoyQm1"  in row_keys else None,
                "net_margin":     _normalize_percent_value(row["netMargin"])             if "netMargin"           in row_keys else None,
                "gross_margin":   _normalize_percent_value(row["grossMargin"])           if "grossMargin"         in row_keys else None,
                "revenue_growth": _normalize_percent_value(row["revenueGrowthYoy"])      if "revenueGrowthYoy"    in row_keys else None,
                "source": VCI_METRICS_SOURCE,
            }
        return out
    except Exception as exc:
        logger.debug(f"screening_data batch lookup failed: {exc}")
        return {}
    finally:
        if conn:
            conn.close()


def _load_stats_financial_rows(symbols: list[str]) -> dict[str, dict]:
    """Load the latest TTM financial ratios from vci_stats_financial.sqlite."""
    db_path = resolve_vci_stats_financial_db_path()
    if not db_path or not os.path.exists(db_path):
        return {}

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stats_financial'")
        if cur.fetchone() is None:
            return {}

        cols = {
            str(r[1])
            for r in cur.execute("PRAGMA table_info(stats_financial)").fetchall() or []
            if len(r) > 1
        }

        wanted = [
            "ticker",
            "pe", "pb", "ps",
            "roe", "roa",
            "gross_margin", "pre_tax_margin", "after_tax_margin",
            "net_interest_margin",
            "cir", "car", "casa_ratio", "npl", "ldr",
            "loans_growth", "deposit_growth",
            "debt_to_equity", "financial_leverage",
            "current_ratio", "quick_ratio", "cash_ratio", "asset_turnover",
            "market_cap",
            "raw_json",
        ]
        selected = [c for c in wanted if c in cols]
        if "ticker" not in selected:
            return {}

        unique_symbols = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
        if not unique_symbols:
            return {}

        placeholders = ",".join(["?"] * len(unique_symbols))
        rows = cur.execute(
            f"SELECT {', '.join(selected)} FROM stats_financial WHERE UPPER(ticker) IN ({placeholders})",
            unique_symbols,
        ).fetchall()

        out: dict[str, dict] = {}
        for row in rows:
            symbol = str(row["ticker"]).upper().strip()
            row_keys = row.keys()

            def _pct(key: str) -> float | None:
                if key not in row_keys:
                    return None
                return _normalize_percent_value(row[key])

            def _abs_pct(key: str) -> float | None:
                v = _pct(key)
                return abs(v) if v is not None else None

            def _raw_num(key: str) -> float | None:
                if key not in row_keys:
                    return None
                v = _to_json_number(row[key])
                return v if v != 0.0 else None

            # Parse raw_json for extra banking fields not stored as columns
            extra: dict = {}
            if "raw_json" in row_keys and row["raw_json"]:
                try:
                    raw = json.loads(row["raw_json"])
                    # Cost of Funds — stored negative, take abs
                    cof_raw = _normalize_percent_value(raw.get("averageCostOfFinancing"))
                    extra["cof"] = abs(cof_raw) if cof_raw is not None else None
                    # Yield on earning assets
                    extra["yield_on_assets"] = _normalize_percent_value(raw.get("averageYieldOnEarningAssets"))
                    # Non-interest income ratio (fee income %)
                    extra["fee_income_ratio"] = _normalize_percent_value(raw.get("nonAndInterestIncome"))
                    # Loan loss reserve to NPLs — stored negative, take abs (coverage ratio %)
                    llr_raw = _normalize_percent_value(raw.get("loansLossReservesToNPLs"))
                    extra["llr_coverage"] = abs(llr_raw) if llr_raw is not None else None
                    # Dividend yield
                    extra["dividend_yield"] = _normalize_percent_value(raw.get("dividendYield"))
                except Exception:
                    pass

            nim_val = _pct("net_interest_margin")
            # CIR is stored negative in VCI (cost reduces income) — always use abs
            cir_val = _abs_pct("cir")
            casa_val = _pct("casa_ratio")
            npl_val = _pct("npl")
            net_margin_val = _pct("after_tax_margin")

            out[symbol] = {
                # Valuation multiples — raw ratio form, not percentage
                "pe":   _to_json_number(row["pe"]) if "pe" in row_keys else 0.0,
                "pb":   _to_json_number(row["pb"]) if "pb" in row_keys else 0.0,
                "ps":   _to_json_number(row["ps"]) if "ps" in row_keys else None,
                # Profitability (all as %)
                "roe":              _pct("roe"),
                "roa":              _pct("roa"),
                "gross_margin":     _pct("gross_margin"),
                "net_margin":       net_margin_val,
                "net_profit_margin": net_margin_val,   # alias used by frontend
                "pre_tax_margin":   _pct("pre_tax_margin"),
                # Banking KPIs — both canonical and legacy aliases
                "nim":                 nim_val,
                "net_interest_margin": nim_val,        # alias
                "cir":                 cir_val,        # positive % (abs of stored negative)
                "car":                 _abs_pct("car"),
                "casa":                casa_val,
                "casa_ratio":          casa_val,       # alias
                "npl":                 npl_val,
                "npl_ratio":           npl_val,        # alias used by stock_provider
                "ldr":                 _pct("ldr"),
                "loans_growth":        _pct("loans_growth"),
                "deposit_growth":      _pct("deposit_growth"),
                # Leverage / liquidity (non-banks, raw multiplier form)
                "debt_to_equity":     _raw_num("debt_to_equity"),
                "financial_leverage": _raw_num("financial_leverage"),
                "current_ratio":      _raw_num("current_ratio"),
                "quick_ratio":        _raw_num("quick_ratio"),
                "cash_ratio":         _raw_num("cash_ratio"),
                "asset_turnover":     _raw_num("asset_turnover"),
                "market_cap":         _to_json_number(row["market_cap"]) if "market_cap" in row_keys else 0.0,
                # Extra banking fields from raw_json
                **extra,
                "source": VCI_STATS_FINANCIAL_SOURCE,
            }
        return out
    except Exception as exc:
        logger.debug(f"stats_financial batch lookup failed: {exc}")
        return {}
    finally:
        if conn:
            conn.close()


def _load_ratio_daily_rows(symbols: list[str]) -> dict[str, dict]:
    """Load the latest daily PE/PB TTM from vci_ratio_daily.sqlite."""
    db_path = resolve_vci_ratio_daily_db_path()
    if not db_path or not os.path.exists(db_path):
        return {}

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ratio_daily'")
        if cur.fetchone() is None:
            return {}

        unique_symbols = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
        if not unique_symbols:
            return {}

        placeholders = ",".join(["?"] * len(unique_symbols))
        rows = cur.execute(
            f"SELECT ticker, pe, pb, trading_date FROM ratio_daily WHERE UPPER(ticker) IN ({placeholders})",
            unique_symbols,
        ).fetchall()

        out: dict[str, dict] = {}
        for row in rows:
            symbol = str(row["ticker"]).upper().strip()
            pe = _to_json_number(row["pe"]) if row["pe"] is not None else 0.0
            pb = _to_json_number(row["pb"]) if row["pb"] is not None else 0.0
            out[symbol] = {
                "pe": pe,
                "pb": pb,
                "pe_ttm": pe,
                "pb_ttm": pb,
                "trading_date": str(row["trading_date"] or ""),
                "source": VCI_RATIO_DAILY_SOURCE,
            }
        return out
    except Exception as exc:
        logger.debug(f"ratio_daily batch lookup failed: {exc}")
        return {}
    finally:
        if conn:
            conn.close()


def get_ratio_daily_metrics(
    symbol: str,
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict | None:
    symbol_u = str(symbol or "").upper().strip()
    if not symbol_u:
        return None

    cache_key = f"ratio_daily_{symbol_u}"
    cached = _cache_get(cache_get, cache_key)
    if cached is not None:
        return cached

    rows = _load_ratio_daily_rows([symbol_u])
    result = rows.get(symbol_u)
    _cache_set(cache_set, cache_key, result)
    return result


def get_stats_financial_metrics(
    symbol: str,
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict | None:
    symbol_u = str(symbol or "").upper().strip()
    if not symbol_u:
        return None

    cache_key = f"stats_financial_{symbol_u}"
    cached = _cache_get(cache_get, cache_key)
    if cached is not None:
        return cached

    rows = _load_stats_financial_rows([symbol_u])
    result = rows.get(symbol_u)
    _cache_set(cache_set, cache_key, result)
    return result


def get_stats_financial_metrics_map(
    symbols: list[str],
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict[str, dict]:
    normalized = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
    if not normalized:
        return {}

    out: dict[str, dict] = {}
    misses: list[str] = []

    for symbol in normalized:
        cache_key = f"stats_financial_{symbol}"
        cached = _cache_get(cache_get, cache_key)
        if cached is None:
            misses.append(symbol)
        elif isinstance(cached, dict):
            out[symbol] = cached

    if misses:
        loaded = _load_stats_financial_rows(misses)
        for symbol in misses:
            cache_key = f"stats_financial_{symbol}"
            value = loaded.get(symbol)
            _cache_set(cache_set, cache_key, value)
            if isinstance(value, dict):
                out[symbol] = value

    return out


def get_screening_metrics(
    symbol: str,
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict | None:
    symbol_u = str(symbol or "").upper().strip()
    if not symbol_u:
        return None

    cache_key = f"screening_metrics_{symbol_u}"
    cached = _cache_get(cache_get, cache_key)
    if cached is not None:
        return cached

    rows = _load_screening_rows([symbol_u])
    result = rows.get(symbol_u)
    _cache_set(cache_set, cache_key, result)
    return result


def get_ratio_daily_metrics_map(
    symbols: list[str],
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict[str, dict]:
    normalized = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
    if not normalized:
        return {}

    out: dict[str, dict] = {}
    misses: list[str] = []

    for symbol in normalized:
        cache_key = f"ratio_daily_{symbol}"
        cached = _cache_get(cache_get, cache_key)
        if cached is None:
            misses.append(symbol)
        elif isinstance(cached, dict):
            out[symbol] = cached

    if misses:
        loaded = _load_ratio_daily_rows(misses)
        for symbol in misses:
            cache_key = f"ratio_daily_{symbol}"
            value = loaded.get(symbol)
            _cache_set(cache_set, cache_key, value)
            if isinstance(value, dict):
                out[symbol] = value

    return out


def get_screening_metrics_map(
    symbols: list[str],
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict[str, dict]:
    normalized = sorted({str(s or "").upper().strip() for s in symbols if str(s or "").strip()})
    if not normalized:
        return {}

    out: dict[str, dict] = {}
    misses: list[str] = []

    for symbol in normalized:
        cache_key = f"screening_metrics_{symbol}"
        cached = _cache_get(cache_get, cache_key)
        if cached is None:
            misses.append(symbol)
        elif isinstance(cached, dict):
            out[symbol] = cached

    if misses:
        loaded = _load_screening_rows(misses)
        for symbol in misses:
            cache_key = f"screening_metrics_{symbol}"
            value = loaded.get(symbol)
            _cache_set(cache_set, cache_key, value)
            if isinstance(value, dict):
                out[symbol] = value

    return out


def _apply_overlay(out: dict, src: dict, src_label: str) -> None:
    """Apply a metrics overlay dict onto out, preferring non-None/non-zero values."""
    pe = _to_json_number(src.get("pe"))
    pb = _to_json_number(src.get("pb"))
    roe = src.get("roe")
    market_cap = _to_json_number(src.get("market_cap"))

    if pe > 0:
        out["pe"] = pe
        out["pe_ratio"] = pe
        out["pe_source"] = src_label
    if pb > 0:
        out["pb"] = pb
        out["pb_ratio"] = pb
        out["pb_source"] = src_label
    if roe is not None and roe != 0:
        out["roe"] = float(roe)
        out["roe_source"] = src_label
    if market_cap > 0:
        out["market_cap"] = market_cap
        out["marketCap"] = market_cap
        out["market_cap_source"] = src_label

    for field in (
        # Profitability
        "roa", "gross_margin", "net_margin", "net_profit_margin",
        "pre_tax_margin", "revenue_growth", "profit_growth",
        # Banking KPIs (canonical names)
        "nim", "cir", "car", "casa", "npl", "npl_ratio", "ldr",
        "loans_growth", "deposit_growth",
        "cof", "yield_on_assets", "fee_income_ratio", "llr_coverage", "dividend_yield",
        # Legacy banking aliases
        "net_interest_margin", "casa_ratio",
        # Leverage / liquidity (non-banks)
        "debt_to_equity", "financial_leverage",
        "current_ratio", "quick_ratio", "cash_ratio", "asset_turnover",
    ):
        v = src.get(field)
        if v is not None:
            out[field] = float(v)
            out[f"{field}_source"] = src_label

    # Ensure cross-aliases stay in sync after overlay
    if src.get("net_margin") is not None:
        out.setdefault("net_profit_margin", out["net_margin"])
    if src.get("net_profit_margin") is not None:
        out.setdefault("net_margin", out["net_profit_margin"])
    if src.get("nim") is not None:
        out.setdefault("net_interest_margin", out["nim"])
    if src.get("casa") is not None:
        out.setdefault("casa_ratio", out["casa"])
    if src.get("npl") is not None:
        out.setdefault("npl_ratio", out["npl"])

    out["fresh_metrics_source"] = src_label


def apply_source_priority(
    data: dict,
    symbol: str,
    cache_get: CacheGet | None = None,
    cache_set: CacheSet | None = None,
) -> dict:
    if not isinstance(data, dict):
        return data

    out = dict(data)
    out.setdefault("source_priority", SOURCE_PRIORITY_LABEL)

    # Remove self-calculated PE/PB from overview (vietnam_stocks.db) — use VCI sources only
    out["pe"] = None
    out["pb"] = None
    out["pe_ratio"] = None
    out["pb_ratio"] = None

    # Layer 1 (lowest): VCI ratio-daily — PE/PB TTM against today's closing price
    ratio_daily = get_ratio_daily_metrics(symbol, cache_get=cache_get, cache_set=cache_set)
    if ratio_daily:
        _apply_overlay(out, ratio_daily, ratio_daily["source"])
        if ratio_daily.get("pe_ttm"):
            out["pe_ttm"] = ratio_daily["pe_ttm"]
        if ratio_daily.get("pb_ttm"):
            out["pb_ttm"] = ratio_daily["pb_ttm"]
        if ratio_daily.get("trading_date"):
            out["ratio_daily_date"] = ratio_daily["trading_date"]

    # Layer 2: VCI stats-financial (updated every 60 min, richer data)
    stats_fin = get_stats_financial_metrics(symbol, cache_get=cache_get, cache_set=cache_set)
    if stats_fin:
        _apply_overlay(out, stats_fin, stats_fin["source"])

    # Layer 3 (highest priority): VCI screening — updated every 5 min, most current
    screening = get_screening_metrics(symbol, cache_get=cache_get, cache_set=cache_set)
    if screening:
        _apply_overlay(out, screening, screening["source"])

    return out


def _apply_peer_overlay(out: dict, src: dict) -> None:
    """Apply one overlay source onto a peer dict (lower-priority fields not overwritten by later call)."""
    for dest_key, src_key in (
        ("pe", "pe"),
        ("pb", "pb"),
        ("roe", "roe"),
        ("net_profit_margin", "net_margin"),
        ("profit_growth", "profit_growth"),
        ("gross_margin", "gross_margin"),
        ("revenue_growth", "revenue_growth"),
        ("market_cap", "market_cap"),
        ("roa", "roa"),
        ("net_interest_margin", "net_interest_margin"),
    ):
        v = src.get(src_key)
        if v:  # skip None and 0 — 0 means no data from source
            out[dest_key] = v

    out["fresh_metrics_source"] = src.get("source", VCI_METRICS_SOURCE)


def apply_peer_source_priority(
    peer: dict,
    screening: dict | None,
    stats_financial: dict | None = None,
    ratio_daily: dict | None = None,
) -> dict:
    if not isinstance(peer, dict):
        return peer

    out = dict(peer)
    out["source_priority"] = SOURCE_PRIORITY_LABEL

    # Remove self-calculated PE/PB from overview (vietnam_stocks.db) — use VCI sources only
    out["pe"] = None
    out["pb"] = None

    # Layer 1 (lowest): VCI ratio-daily
    if ratio_daily:
        _apply_peer_overlay(out, ratio_daily)

    # Layer 2: VCI stats-financial (richer, updated every 60 min)
    if stats_financial:
        _apply_peer_overlay(out, stats_financial)

    # Layer 3 (highest): VCI screening — updated every 5 min, most current
    if screening:
        _apply_peer_overlay(out, screening)

    return out
