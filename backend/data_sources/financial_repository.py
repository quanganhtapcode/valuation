import sqlite3
import pandas as pd
import numpy as np
from typing import Optional, List, Dict, Any

class FinancialRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA temp_store=MEMORY")
        except Exception:
            pass
        return conn

    def get_latest_ratios(self, symbol: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            # Note: quarter=0 or quarter=5 often means yearly in this DB schema for ratios
            query = """
                SELECT * FROM financial_ratios 
                WHERE symbol = ? AND (quarter = 0 OR quarter = 5 OR quarter IS NULL)
                ORDER BY year DESC 
                LIMIT 1
            """
            row = conn.execute(query, (symbol.upper(),)).fetchone()
            return dict(row) if row else None

    def get_financial_reports(self, symbol: str, period: str = 'year', limit: int = 5) -> Dict[str, pd.DataFrame]:
        with self._get_connection() as conn:
            reports = {}
            for table in ['income_statement', 'balance_sheet', 'cash_flow_statement']:
                if period == 'year':
                    period_filter = "(quarter = 0 OR quarter IS NULL)"
                else:
                    period_filter = "quarter > 0"
                    
                query = f"""
                    SELECT * FROM {table}
                    WHERE symbol = ? AND {period_filter}
                    ORDER BY year DESC, quarter DESC
                    LIMIT ?
                """
                reports[table] = pd.read_sql_query(query, conn, params=(symbol, limit))
            return reports

    def get_stock_industry(self, symbol: str) -> Optional[str]:
        """Get the industry sector for a symbol from VCI screening."""
        from backend.db_path import resolve_vci_screening_db_path
        try:
            conn = sqlite3.connect(resolve_vci_screening_db_path())
            row = conn.execute(
                "SELECT enSector FROM screening_data WHERE ticker = ? LIMIT 1",
                (symbol.upper(),)
            ).fetchone()
            conn.close()
            return row[0] if row else None
        except Exception:
            return None

    def get_industry_peers(self, symbol: str, limit: int = 15) -> Dict[str, Any]:
        """Get top peers in the same industry with their latest ratios."""
        industry = self.get_stock_industry(symbol)
        if not industry:
            return {'sector': 'N/A', 'peers_detail': [], 'median_pe': 0, 'median_pb': 0}

        from backend.db_path import resolve_vci_screening_db_path
        try:
            s_conn = sqlite3.connect(resolve_vci_screening_db_path())
            peer_tickers = [r[0] for r in s_conn.execute(
                "SELECT ticker FROM screening_data WHERE enSector = ? AND ticker != ? ORDER BY marketCap DESC LIMIT ?",
                (industry, symbol.upper(), limit)
            ).fetchall()]
            s_conn.close()
        except Exception:
            peer_tickers = []

        if not peer_tickers:
            return {'sector': industry, 'peers_detail': [], 'median_pe': 0, 'median_pb': 0}

        with self._get_connection() as conn:
            placeholders = ','.join('?' * len(peer_tickers))
            query = f"""
                WITH latest_ratios AS (
                    SELECT fr.symbol,
                           fr.price_to_earnings as pe_ratio,
                           fr.price_to_book as pb_ratio,
                           fr.market_cap_billions as market_cap,
                           ROW_NUMBER() OVER (PARTITION BY fr.symbol ORDER BY fr.year DESC) as rn
                    FROM financial_ratios fr
                    WHERE fr.symbol IN ({placeholders})
                      AND (fr.quarter = 0 OR fr.quarter = 5 OR fr.quarter IS NULL)
                )
                SELECT symbol, pe_ratio, pb_ratio, market_cap
                FROM latest_ratios WHERE rn = 1
                ORDER BY market_cap DESC LIMIT ?
            """
            rows = conn.execute(query, peer_tickers + [limit]).fetchall()
            peers = [dict(r) for r in rows]

        pe_values = [p['pe_ratio'] for p in peers if p.get('pe_ratio') and p['pe_ratio'] > 0]
        pb_values = [p['pb_ratio'] for p in peers if p.get('pb_ratio') and p['pb_ratio'] > 0]

        return {
            'sector': industry,
            'peers_detail': peers,
            'median_pe': float(np.median(pe_values)) if pe_values else 0,
            'median_pb': float(np.median(pb_values)) if pb_values else 0,
        }
