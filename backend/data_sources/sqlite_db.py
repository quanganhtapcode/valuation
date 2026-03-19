"""
SQLite Database Client
Provides access to local stocks.db for cached financial data
"""

import sqlite3
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
import os

from backend.db_path import resolve_stocks_db_path

logger = logging.getLogger(__name__)

class SQLiteDB:
    """Client for SQLite stocks database"""
    
    def __init__(self, db_path: str = None):
        self.db_path = resolve_stocks_db_path(db_path)
    
    def _get_connection(self):
        """Get a new database connection"""
        conn = sqlite3.connect(self.db_path, timeout=30)
        try:
            # Pragmas chosen for read-heavy API workloads.
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA temp_store=MEMORY")
        except Exception:
            # Best-effort only; keep working even if PRAGMA fails.
            pass
        return conn

    
    def get_company(self, symbol: str) -> Optional[Dict]:
        """Get company profile from database"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT symbol, name, exchange, industry, company_profile, updated_at
                FROM company WHERE symbol = ?
            """, (symbol.upper(),))
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'symbol': row[0],
                    'name': row[1],
                    'exchange': row[2],
                    'industry': row[3],
                    'company_profile': row[4],
                    'updated_at': row[5]
                }
        except Exception as e:
            logger.error(f"SQLite get_company failed for {symbol}: {e}")
        return None
    
    def get_financial_statement(self, symbol: str, report_type: str, period_type: str, 
                                 year: int = None, quarter: int = None) -> Optional[List[Dict]]:
        """
        Get financial statements from database
        
        Args:
            symbol: Stock symbol
            report_type: 'income', 'balance', 'cashflow', 'ratio'
            period_type: 'quarter' or 'year'
            year: Optional specific year
            quarter: Optional specific quarter
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            query = """
                SELECT year, quarter, data, updated_at
                FROM fin_stmt 
                WHERE symbol = ? AND report_type = ? AND period_type = ?
            """
            params = [symbol.upper(), report_type, period_type]
            
            if year:
                query += " AND year = ?"
                params.append(year)
            if quarter:
                query += " AND quarter = ?"
                params.append(quarter)
            
            query += " ORDER BY year DESC, quarter DESC"
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                data = json.loads(row[2]) if row[2] else {}
                results.append({
                    'year': row[0],
                    'quarter': row[1],
                    'data': data,
                    'updated_at': row[3]
                })
            return results
            
        except Exception as e:
            logger.error(f"SQLite get_financial_statement failed: {e}")
        return None
    
    def get_stock_overview(self, symbol: str) -> Optional[Dict]:
        """Get stock overview metrics from database"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT symbol, exchange, industry, pe, pb, roe, roa, 
                       market_cap, current_price, eps, bvps, updated_at
                FROM overview WHERE symbol = ?
            """, (symbol.upper(),))
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'symbol': row[0],
                    'exchange': row[1],
                    'industry': row[2],
                    'pe': row[3],
                    'pb': row[4],
                    'roe': row[5],
                    'roa': row[6],
                    'market_cap': row[7],
                    'current_price': row[8],
                    'eps': row[9],
                    'bvps': row[10],
                    'updated_at': row[11]
                }
        except Exception as e:
            logger.error(f"SQLite get_stock_overview failed for {symbol}: {e}")
        return None
    
    def get_all_symbols(self) -> List[str]:
        """Get list of all stock symbols in database"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT symbol FROM company ORDER BY symbol")
            rows = cursor.fetchall()
            conn.close()
            return [row[0] for row in rows]
        except Exception as e:
            logger.error(f"SQLite get_all_symbols failed: {e}")
        return []
    
    def search_companies(self, query: str, limit: int = 20) -> List[Dict]:
        """Search companies by symbol or name"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT symbol, name, exchange, industry 
                FROM company 
                WHERE symbol LIKE ? OR name LIKE ?
                ORDER BY symbol
                LIMIT ?
            """, (f"%{query}%", f"%{query}%", limit))
            rows = cursor.fetchall()
            conn.close()
            
            return [
                {'symbol': row[0], 'name': row[1], 'exchange': row[2], 'industry': row[3]}
                for row in rows
            ]
        except Exception as e:
            logger.error(f"SQLite search_companies failed: {e}")
        return []
    
    def get_stock_ratios(self, symbol: str, period_type: str = None, 
                         year: int = None, quarter: int = None, 
                         limit: int = 10) -> List[Dict]:
        """
        Get stock ratio data from the wide ratio table (single source of truth)
        
        Args:
            symbol: Stock symbol
            period_type: 'quarter' or 'year' (optional)
            year: Specific year (optional)
            quarter: Specific quarter (optional)
            limit: Number of records to return
        
        Returns:
            List of ratio dictionaries with all metrics
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            query = """
                SELECT
                    symbol, period_type, year, quarter,
                    roe, roa, roic, net_profit_margin,
                    eps, bvps, pe, pb,
                    market_cap, outstanding_share,
                    financial_leverage, owners_equity_charter_capital,
                    debt_equity, fixed_asset_to_equity,
                    ps, p_cash_flow, ev_ebitda,
                    current_ratio, quick_ratio, cash_ratio, interest_coverage,
                    asset_turnover, inventory_turnover,
                    gross_profit_margin, ebit_margin,
                    nim,
                    fetched_at
                FROM ratio_wide
                WHERE symbol = ?
            """
            params = [symbol.upper()]
            
            if period_type:
                query += " AND period_type = ?"
                params.append(period_type)
            if year:
                query += " AND year = ?"
                params.append(year)
            if quarter:
                query += " AND quarter = ?"
                params.append(quarter)
            
            query += " ORDER BY year DESC, quarter DESC LIMIT ?"
            params.append(limit)
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                results.append({
                    'symbol': row[0],
                    'period_type': row[1],
                    'year': row[2],
                    'quarter': row[3],
                    # Profitability (core)
                    'roe': row[4],
                    'roa': row[5],
                    'roic': row[6],
                    'net_profit_margin': row[7],
                    # Per Share (core)
                    'eps': row[8],
                    'bvps': row[9],
                    # Valuation (core)
                    'pe': row[10],
                    'pb': row[11],
                    # Market (core)
                    'market_cap': row[12],
                    'outstanding_shares': row[13],
                    # Capital structure (core)
                    'financial_leverage': row[14],
                    'equity_to_charter_capital': row[15],
                    # Extended (capital structure & valuation)
                    'debt_equity': row[16],
                    'fixed_asset_to_equity': row[17],
                    'ps': row[18],
                    'p_cashflow': row[19],
                    'ev_ebitda': row[20],
                    # Extended (liquidity)
                    'current_ratio': row[21],
                    'quick_ratio': row[22],
                    'cash_ratio': row[23],
                    'interest_coverage': row[24],
                    # Extended (efficiency)
                    'asset_turnover': row[25],
                    'inventory_turnover': row[26],
                    # Extended (profitability)
                    'gross_profit_margin': row[27],
                    'operating_profit_margin': row[28],
                    # Banking
                    'nim': row[29],
                    'updated_at': row[30]
                })
            
            return results
            
        except Exception as e:
            logger.error(f"SQLite get_stock_ratios failed for {symbol}: {e}")
            return self._get_ratios_from_financial_statements(symbol, period_type, limit)
    
    def _get_ratios_from_financial_statements(self, symbol: str, period_type: str = None, limit: int = 10) -> List[Dict]:
        """Fallback: Get ratios from old financial_statements JSON blob"""
        try:
            statements = self.get_financial_statement(symbol, 'ratio', period_type or 'quarter')
            if not statements:
                return []
            
            # Convert JSON blob to normalized format (limited fields)
            results = []
            for stmt in statements[:limit]:
                data = stmt.get('data', {})
                results.append({
                    'symbol': symbol.upper(),
                    'period_type': period_type or 'quarter',
                    'year': stmt.get('year'),
                    'quarter': stmt.get('quarter'),
                    'roe': data.get("('Chỉ tiêu khả năng sinh lợi', 'ROE (%)')"),
                    'roa': data.get("('Chỉ tiêu khả năng sinh lợi', 'ROA (%)')"),
                    'roic': data.get("('Chỉ tiêu khả năng sinh lợi', 'ROIC (%)')"),
                    'pe': data.get("('Chỉ tiêu định giá', 'P/E')"),
                    'pb': data.get("('Chỉ tiêu định giá', 'P/B')"),
                    'eps': data.get("('Chỉ tiêu định giá', 'EPS (VND)')"),
                    'bvps': data.get("('Chỉ tiêu định giá', 'BVPS (VND)')"),
                    'updated_at': stmt.get('updated_at')
                })
            return results
        except Exception as e:
            logger.error(f"Fallback get_ratios failed: {e}")
            return []
    
    def get_latest_ratio(self, symbol: str) -> Optional[Dict]:
        """Get the latest ratio data for a symbol (from either new or old table)"""
        ratios = self.get_stock_ratios(symbol, limit=1)
        return ratios[0] if ratios else None
