#!/usr/bin/env python3
"""Create compatibility views in vietnam_stocks.db.

The backend code was written against a legacy schema that used:
  - `overview`   table (symbol, name, exchange, industry, pe, pb, roe, …)
  - `ratio_wide` table (symbol, year, quarter, period_type, pe, pb, roe, …)

The db_updater repo stores the same data under different table names:
  - `stocks`           → ticker, organ_name, …
  - `company_overview` → symbol, icb_name4 (industry), company_profile, …
  - `stock_exchange`   → ticker, exchange
  - `financial_ratios` → symbol, year, quarter, price_to_earnings (=pe), …

This script creates DROP + CREATE VIEW statements that map the new names to the
old names, making the backend work without code changes.

Safe to re-run at any time — views are always recreated from scratch.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(float(v) for v in values)
    n = len(s)
    m = n // 2
    if n % 2 == 1:
        return s[m]
    return (s[m - 1] + s[m]) / 2.0


def _refresh_valuation_datamart(conn: sqlite3.Connection, db_path: str) -> int:
    """Build per-symbol valuation medians/counters for fast API reads."""
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS valuation_datamart")
    cur.execute(
        """
        CREATE TABLE valuation_datamart (
            symbol TEXT PRIMARY KEY,
            industry TEXT,
            industry_screening_key TEXT,
            industry_screening_name TEXT,
            peer_count INTEGER DEFAULT 0,
            pe_median REAL DEFAULT 0,
            pb_median REAL DEFAULT 0,
            ps_median REAL DEFAULT 0,
            pe_count INTEGER DEFAULT 0,
            pb_count INTEGER DEFAULT 0,
            ps_count INTEGER DEFAULT 0,
            pe_source TEXT,
            pb_source TEXT,
            ps_source TEXT,
            refreshed_at TEXT
        )
        """
    )

    overview_rows = cur.execute(
        """
        SELECT symbol, industry, pe, pb
        FROM overview
        WHERE symbol IS NOT NULL
        """
    ).fetchall() or []

    if not overview_rows:
        cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_industry ON valuation_datamart(industry)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_screening_key ON valuation_datamart(industry_screening_key)")
        return 0

    by_industry: dict[str, list[dict]] = {}
    for r in overview_rows:
        industry = str(r["industry"] or "Unknown").strip() or "Unknown"
        item = {
            "symbol": str(r["symbol"]).upper(),
            "industry": industry,
            "pe": _to_float(r["pe"]),
            "pb": _to_float(r["pb"]),
        }
        by_industry.setdefault(industry, []).append(item)

    ps_rows = cur.execute(
        """
        WITH latest AS (
            SELECT symbol, ps,
                   ROW_NUMBER() OVER (
                       PARTITION BY symbol
                       ORDER BY year DESC,
                                CASE WHEN quarter IS NULL THEN -1 ELSE quarter END DESC
                   ) AS rn
            FROM ratio_wide
            WHERE ps IS NOT NULL
        )
        SELECT symbol, ps
        FROM latest
        WHERE rn = 1
        """
    ).fetchall() or []
    ps_map = {str(r["symbol"]).upper(): _to_float(r["ps"]) for r in ps_rows if r["symbol"]}

    screening_meta: dict[str, dict] = {}
    screening_groups: dict[str, list[dict]] = {}
    try:
        from backend.db_path import resolve_vci_screening_db_path

        screening_db_path = resolve_vci_screening_db_path()
        if screening_db_path and os.path.exists(screening_db_path):
            sconn = sqlite3.connect(screening_db_path)
            sconn.row_factory = sqlite3.Row
            scur = sconn.cursor()
            scur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='screening_data'")
            has_screening = scur.fetchone() is not None
            if has_screening:
                srows = scur.execute(
                    """
                    SELECT ticker, icbCodeLv2, viSector, enSector, ttmPe, ttmPb
                    FROM screening_data
                    WHERE ticker IS NOT NULL
                    """
                ).fetchall() or []
                for r in srows:
                    symbol = str(r["ticker"]).upper().strip()
                    if not symbol:
                        continue
                    key = str(r["icbCodeLv2"]) if r["icbCodeLv2"] is not None else ""
                    name = str(r["viSector"] or r["enSector"] or "").strip()
                    screening_meta[symbol] = {"key": key, "name": name}
                    screening_groups.setdefault(key, []).append(
                        {
                            "symbol": symbol,
                            "pe": _to_float(r["ttmPe"]),
                            "pb": _to_float(r["ttmPb"]),
                        }
                    )
            sconn.close()
    except Exception as ex:
        print(f"  WARNING: valuation_datamart screening load failed: {ex}")

    now_iso = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    inserts: list[tuple] = []

    for r in overview_rows:
        symbol = str(r["symbol"]).upper().strip()
        if not symbol:
            continue

        industry = str(r["industry"] or "Unknown").strip() or "Unknown"
        industry_group = [p for p in by_industry.get(industry, []) if p.get("symbol") != symbol]

        pe_over_vals = [p["pe"] for p in industry_group if 0 < _to_float(p["pe"]) <= 80]
        pb_over_vals = [p["pb"] for p in industry_group if 0 < _to_float(p["pb"]) <= 20]
        ps_vals = [
            _to_float(ps_map.get(str(p.get("symbol") or "").upper()))
            for p in industry_group
            if 0 < _to_float(ps_map.get(str(p.get("symbol") or "").upper())) <= 200
        ]

        pe_count = len(pe_over_vals)
        pb_count = len(pb_over_vals)
        ps_count = len(ps_vals)
        pe_median = _median(pe_over_vals)
        pb_median = _median(pb_over_vals)
        ps_median = _median(ps_vals)
        pe_source = "overview.industry"
        pb_source = "overview.industry"
        ps_source = "ratio_wide.latest_ps"

        meta = screening_meta.get(symbol, {})
        screening_key = str(meta.get("key") or "")
        screening_name = str(meta.get("name") or "")

        if screening_key:
            screening_group = [
                p for p in screening_groups.get(screening_key, []) if str(p.get("symbol") or "") != symbol
            ]
            pe_screen_vals = [p["pe"] for p in screening_group if 0 < _to_float(p["pe"]) <= 80]
            pb_screen_vals = [p["pb"] for p in screening_group if 0 < _to_float(p["pb"]) <= 20]

            if pe_screen_vals:
                pe_median = _median(pe_screen_vals)
                pe_count = len(pe_screen_vals)
                pe_source = "vci_screening.icbCodeLv2"
            if pb_screen_vals:
                pb_median = _median(pb_screen_vals)
                pb_count = len(pb_screen_vals)
                pb_source = "vci_screening.icbCodeLv2"

        inserts.append(
            (
                symbol,
                industry,
                screening_key,
                screening_name,
                int(len(industry_group)),
                float(pe_median or 0.0),
                float(pb_median or 0.0),
                float(ps_median or 0.0),
                int(pe_count),
                int(pb_count),
                int(ps_count),
                pe_source,
                pb_source,
                ps_source,
                now_iso,
            )
        )

    cur.executemany(
        """
        INSERT OR REPLACE INTO valuation_datamart (
            symbol,
            industry,
            industry_screening_key,
            industry_screening_name,
            peer_count,
            pe_median,
            pb_median,
            ps_median,
            pe_count,
            pb_count,
            ps_count,
            pe_source,
            pb_source,
            ps_source,
            refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        inserts,
    )

    cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_industry ON valuation_datamart(industry)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_screening_key ON valuation_datamart(industry_screening_key)")
    return len(inserts)


def create_views(db_path: str | None = None) -> None:
    if db_path is None:
        # 1. Prefer explicit env var (set by systemd .env or run_pipeline.py)
        db_path = os.environ.get("VIETNAM_STOCK_DB_PATH") or os.environ.get("STOCKS_DB_PATH")
    if db_path is None:
        # 2. Fall back to backend resolver
        from backend.db_path import resolve_stocks_db_path
        db_path = resolve_stocks_db_path()

    print(f"[create_compat_views] DB: {db_path}")
    conn = sqlite3.connect(db_path)

    # ── Verify required tables exist ─────────────────────────────────────────
    existing = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    needed = {"stocks", "company_overview", "financial_ratios", "income_statement"}
    missing = needed - existing
    if missing:
        print(f"  WARNING: tables not yet populated: {sorted(missing)}")
        print("  Views will be created but may return 0 rows until company info is fetched.")

    # ── overview view ────────────────────────────────────────────────────────
    # Maps db_updater schema → legacy column names used by backend/stock_provider.py
    # and backend/services/valuation_service.py.
    #
    # Uses two subqueries from financial_ratios:
    #   fr_ann — latest ANNUAL row (highest year with quarter IS NULL)
    #   fr_qtr — latest QUARTERLY row (highest year*10+quarter)
    # pe/pb/eps prefer the annual row (always populated); bvps prefers quarterly (more current).
    # market_cap_billions stores raw VND despite its name — do NOT multiply.
    conn.execute("DROP VIEW IF EXISTS overview")
    conn.execute(
        """
        CREATE VIEW overview AS
        SELECT
            s.ticker                                                                   AS symbol,
            s.organ_name                                                               AS name,
            'HOSE'                                                                     AS exchange,
            COALESCE(co.icb_name4, co.icb_name3, '')                                   AS industry,
            NULL                                                                       AS current_price,
            -- pe/pb: annual rows always carry correct full-year multiples;
            -- quarterly rows often have pe=0 if data wasn't populated.
            COALESCE(NULLIF(fr_ann.price_to_earnings, 0), NULLIF(fr_qtr.price_to_earnings, 0), 0)  AS pe,
            COALESCE(NULLIF(fr_ann.price_to_book,     0), NULLIF(fr_qtr.price_to_book,     0), 0)  AS pb,
            COALESCE(NULLIF(fr_ann.roe, 0), NULLIF(fr_qtr.roe, 0), 0)                              AS roe,
            COALESCE(NULLIF(fr_ann.roa, 0), NULLIF(fr_qtr.roa, 0), 0)                              AS roa,
            -- market_cap_billions stores raw VND (the column name is misleading);
            -- do NOT multiply by 1e9.
            COALESCE(fr_ann.market_cap_billions, fr_qtr.market_cap_billions, 0)                     AS market_cap,
            -- eps_ttm: annual row = full-year EPS (true TTM); quarterly = one period only.
            COALESCE(NULLIF(fr_ann.eps_vnd, 0), fr_qtr.eps_vnd * 4, 0)                             AS eps_ttm,
            -- bvps: latest quarterly is most current; fall back to annual.
            COALESCE(NULLIF(fr_qtr.bvps_vnd, 0), NULLIF(fr_ann.bvps_vnd, 0), 0)                   AS bvps,
            co.company_profile                                                         AS company_profile,
            COALESCE(NULLIF(fr_ann.net_profit_margin, 0), NULLIF(fr_qtr.net_profit_margin, 0), 0)  AS net_profit_margin,
            -- profit_growth: YoY net profit growth (%) from annual income statements.
            -- Uses the two most recent annual rows per symbol.
            CASE
                WHEN is_cur.net_profit_parent_company IS NOT NULL
                     AND is_prev.net_profit_parent_company IS NOT NULL
                     AND is_prev.net_profit_parent_company != 0
                THEN (is_cur.net_profit_parent_company - is_prev.net_profit_parent_company)
                     * 100.0 / ABS(is_prev.net_profit_parent_company)
                ELSE NULL
            END                                                                        AS profit_growth,
            co.updated_at                                                              AS updated_at
        FROM stocks s
        LEFT JOIN company_overview co ON co.symbol = s.ticker
        LEFT JOIN (
            -- latest ANNUAL row per symbol: highest year with quarter IS NULL.
            -- NOTE: cannot use MAX(rowid) here because historical data was inserted
            --       AFTER recent data, so 2013 has higher rowids than 2025.
            SELECT *
            FROM financial_ratios f1
            WHERE f1.quarter IS NULL
              AND f1.year = (
                  SELECT MAX(f2.year)
                  FROM financial_ratios f2
                  WHERE f2.symbol = f1.symbol
                    AND f2.quarter IS NULL
              )
        ) fr_ann ON fr_ann.symbol = s.ticker
        LEFT JOIN (
            -- latest QUARTERLY row per symbol: highest (year*10 + quarter).
            SELECT *
            FROM financial_ratios f1
            WHERE f1.quarter IS NOT NULL
              AND (f1.year * 10 + f1.quarter) = (
                  SELECT MAX(f2.year * 10 + f2.quarter)
                  FROM financial_ratios f2
                  WHERE f2.symbol = f1.symbol
                    AND f2.quarter IS NOT NULL
              )
        ) fr_qtr ON fr_qtr.symbol = s.ticker
        LEFT JOIN (
            -- latest annual income statement per symbol
            SELECT symbol, net_profit_parent_company
            FROM income_statement f1
            WHERE f1.quarter IS NULL
              AND f1.year = (
                  SELECT MAX(f2.year)
                  FROM income_statement f2
                  WHERE f2.symbol = f1.symbol AND f2.quarter IS NULL
              )
        ) is_cur ON is_cur.symbol = s.ticker
        LEFT JOIN (
            -- second-to-latest annual income statement per symbol (prior year)
            SELECT symbol, net_profit_parent_company
            FROM income_statement f1
            WHERE f1.quarter IS NULL
              AND f1.year = (
                  SELECT MAX(f2.year)
                  FROM income_statement f2
                  WHERE f2.symbol = f1.symbol AND f2.quarter IS NULL
              ) - 1
        ) is_prev ON is_prev.symbol = s.ticker
        """
    )

    # ── ratio_wide view ──────────────────────────────────────────────────────
    # Maps financial_ratios → legacy ratio_wide column names.
    # NOTE: The backend checks sqlite_master WHERE type='table' AND name='ratio_wide'.
    #       A VIEW has type='view' so that check returns empty → backend skips ratio_wide.
    #       The backend handles this gracefully (falls back to other data sources).
    #       To fully enable ratio_wide in the backend, see backend/stock_provider.py line ~311.
    conn.execute("DROP VIEW IF EXISTS ratio_wide")
    conn.execute(
        """
        CREATE VIEW ratio_wide AS
        SELECT
            symbol,
            year,
            quarter,
            CASE
                WHEN quarter IS NULL OR period = 'year' THEN 'year'
                ELSE 'quarter'
            END                                                    AS period_type,
            CASE
                WHEN quarter IS NULL OR period = 'year'
                    THEN CAST(year AS TEXT)
                ELSE CAST(year AS TEXT) || 'Q' || CAST(quarter AS TEXT)
            END                                                    AS period_label,
            price_to_earnings                                      AS pe,
            price_to_book                                          AS pb,
            roe,
            roa,
            roic,
            net_profit_margin,
            eps_vnd                                                AS eps,
            bvps_vnd                                               AS bvps,
            market_cap_billions                                    AS market_cap,
            shares_outstanding_millions                            AS outstanding_share,
            financial_leverage                                     AS financial_leverage,
            equity_to_charter_capital                              AS owners_equity_charter_capital,
            debt_to_equity                                         AS debt_equity,
            fixed_assets_to_equity                                 AS fixed_asset_to_equity,
            price_to_sales                                         AS ps,
            price_to_cash_flow                                     AS p_cash_flow,
            ev_to_ebitda                                           AS ev_ebitda,
            current_ratio,
            quick_ratio,
            cash_ratio,
            interest_coverage_ratio                                AS interest_coverage,
            asset_turnover,
            inventory_turnover,
            gross_margin                                           AS gross_profit_margin,
            ebit_margin,
            NULL                                                   AS nim,
            updated_at                                             AS fetched_at
        FROM financial_ratios
        """
    )

    # ── fin_stmt view ────────────────────────────────────────────────────────
    # The revenue-profit endpoint (stock_routes.py) queries a `fin_stmt` table
    # with columns: symbol, report_type, year, quarter, period_type, data (JSON).
    # The db_updater stores the same data in `income_statement` with structured
    # columns.  This view serialises key fields back to JSON so the endpoint
    # can parse them without code changes.
    conn.execute("DROP VIEW IF EXISTS fin_stmt")
    conn.execute(
        """
        CREATE VIEW fin_stmt AS
        SELECT
            symbol,
            'income'                                                AS report_type,
            year,
            quarter,
            CASE WHEN quarter IS NULL THEN 'year' ELSE 'quarter' END AS period_type,
            '{' ||
                '"revenue":'                         || COALESCE(CAST(revenue AS TEXT), 'null') || ',' ||
                '"Attribute to parent company":'     || COALESCE(CAST(net_profit_parent_company AS TEXT), 'null') || ',' ||
                '"Net Profit For the Year":'         || COALESCE(CAST(net_profit_parent_company AS TEXT), 'null') || ',' ||
                '"net profit margin":'               || CASE
                    WHEN revenue IS NOT NULL AND CAST(revenue AS REAL) != 0
                    THEN CAST(ROUND(CAST(net_profit_parent_company AS REAL) * 100.0 / CAST(revenue AS REAL), 2) AS TEXT)
                    ELSE 'null'
                END ||
            '}'                                                     AS data,
            updated_at
        FROM income_statement
        WHERE revenue IS NOT NULL
        """
    )

    # ── company view ─────────────────────────────────────────────────────────
    # The backend's stock_provider.py and stock_routes.py reference a `company`
    # table that doesn't exist in the db_updater schema.  This view provides it.
    #
    # Columns used by backend:
    #   symbol  – WHERE / JOIN key
    #   name    – display name
    #   industry – sector label for peers grouping
    #   exchange – HOSE / HNX / UPCOM
    #   company_profile – long description text
    conn.execute("DROP VIEW IF EXISTS company")
    conn.execute(
        """
        CREATE VIEW company AS
        SELECT
            s.ticker                                                        AS symbol,
            s.organ_name                                                    AS name,
            COALESCE(co.icb_name4, co.icb_name3, '')                       AS industry,
            'HOSE'                                                          AS exchange,
            co.company_profile                                              AS company_profile,
            s.updated_at                                                    AS updated_at
        FROM stocks s
        LEFT JOIN company_overview co ON co.symbol = s.ticker
        """
    )

    # ── valuation_datamart table ────────────────────────────────────────────
    # Precomputed medians/sample sizes per symbol for fast valuation requests.
    datamart_rows = _refresh_valuation_datamart(conn, db_path)

    # ── Performance indexes ──────────────────────────────────────────────────
    # Composite indexes so queries like WHERE symbol=? ORDER BY year DESC, quarter DESC
    # use an index scan instead of a symbol-index scan + temp B-tree sort.
    # Single-column indexes already exist; these composites are additive.
    for tbl in ("income_statement", "balance_sheet", "cash_flow_statement"):
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{tbl}_sym_yr_qtr "
            f"ON {tbl}(symbol, year, quarter)"
        )
    # (symbol, quarter, year) order helps the overview view's correlated subqueries
    # which filter on symbol + quarter IS NULL/NOT NULL + MAX(year).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_financial_ratios_sym_qtr_yr "
        "ON financial_ratios(symbol, quarter, year)"
    )

    conn.commit()

    # ── Print row counts ─────────────────────────────────────────────────────
    ov = conn.execute("SELECT COUNT(*) FROM overview").fetchone()[0]
    rw = conn.execute("SELECT COUNT(*) FROM ratio_wide").fetchone()[0]
    co = conn.execute("SELECT COUNT(*) FROM company").fetchone()[0]
    fs = conn.execute("SELECT COUNT(*) FROM fin_stmt").fetchone()[0]
    dm = conn.execute("SELECT COUNT(*) FROM valuation_datamart").fetchone()[0]
    print(f"  overview view  : {ov:,} rows")
    print(f"  ratio_wide view: {rw:,} rows")
    print(f"  company view   : {co:,} rows")
    print(f"  fin_stmt view  : {fs:,} rows")
    print(f"  valuation_datamart: {dm:,} rows (rebuilt={datamart_rows:,})")
    conn.close()
    print("[create_compat_views] Done.")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    create_views(arg)
