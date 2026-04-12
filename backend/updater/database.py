import sqlite3
import pandas as pd
import logging
import os
from datetime import datetime
from typing import List, Dict, Optional, Union

# ============================================================================
# SCHEMA DEFINITIONS
# ============================================================================

CREATE_TABLES_SQL = {
    'stocks': '''
        CREATE TABLE IF NOT EXISTS stocks (
            ticker TEXT PRIMARY KEY,
            organ_name TEXT,
            en_organ_name TEXT,
            organ_short_name TEXT,
            en_organ_short_name TEXT,
            com_type_code TEXT,
            status TEXT DEFAULT 'listed',
            listed_date TEXT,
            delisted_date TEXT,
            company_id TEXT,
            tax_code TEXT,
            isin TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''',
    'exchanges': '''
        CREATE TABLE IF NOT EXISTS exchanges (
            exchange TEXT PRIMARY KEY,
            exchange_name TEXT,
            exchange_code TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''',
    'indices': '''
        CREATE TABLE IF NOT EXISTS indices (
            index_code TEXT PRIMARY KEY,
            index_name TEXT,
            description TEXT,
            group_name TEXT,
            index_id INTEGER,
            sector_id REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''',
    'industries': '''
        CREATE TABLE IF NOT EXISTS industries (
            icb_code TEXT PRIMARY KEY,
            icb_name TEXT,
            en_icb_name TEXT,
            level INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''',
    'stock_exchange': '''
        CREATE TABLE IF NOT EXISTS stock_exchange (
            ticker TEXT,
            exchange TEXT,
            id INTEGER,
            type TEXT,
            PRIMARY KEY (ticker, exchange),
            FOREIGN KEY (ticker) REFERENCES stocks(ticker),
            FOREIGN KEY (exchange) REFERENCES exchanges(exchange)
        )
    ''',
    'stock_industry': '''
        CREATE TABLE IF NOT EXISTS stock_industry (
            ticker TEXT,
            icb_code TEXT,
            icb_name2 TEXT,
            en_icb_name2 TEXT,
            icb_name3 TEXT,
            en_icb_name3 TEXT,
            icb_name4 TEXT,
            en_icb_name4 TEXT,
            icb_code1 TEXT,
            icb_code2 TEXT,
            icb_code3 TEXT,
            icb_code4 TEXT,
            PRIMARY KEY (ticker, icb_code),
            FOREIGN KEY (ticker) REFERENCES stocks(ticker),
            FOREIGN KEY (icb_code) REFERENCES industries(icb_code)
        )
    ''',
    'update_log': '''
        CREATE TABLE IF NOT EXISTS update_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT,
            records_updated INTEGER,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT
        )
    ''',
    'company_overview': '''
        CREATE TABLE IF NOT EXISTS company_overview (
            symbol TEXT PRIMARY KEY,
            id TEXT,
            issue_share INTEGER,
            history TEXT,
            company_profile TEXT,
            icb_name3 TEXT,
            icb_name2 TEXT,
            icb_name4 TEXT,
            financial_ratio_issue_share INTEGER,
            charter_capital INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'shareholders': '''
        CREATE TABLE IF NOT EXISTS shareholders (
            id TEXT PRIMARY KEY,
            symbol TEXT,
            share_holder TEXT,
            quantity INTEGER,
            share_own_percent REAL,
            update_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'events': '''
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            symbol TEXT,
            event_title TEXT,
            en_event_title TEXT,
            public_date TEXT,
            issue_date TEXT,
            source_url TEXT,
            event_list_code TEXT,
            ratio REAL,
            value REAL,
            record_date TEXT,
            exright_date TEXT,
            event_list_name TEXT,
            en_event_list_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'news': '''
        CREATE TABLE IF NOT EXISTS news (
            id TEXT PRIMARY KEY,
            symbol TEXT,
            news_title TEXT,
            news_sub_title TEXT,
            friendly_sub_title TEXT,
            news_image_url TEXT,
            news_source_link TEXT,
            public_date INTEGER,
            news_id TEXT,
            news_short_content TEXT,
            news_full_content TEXT,
            close_price INTEGER,
            ref_price INTEGER,
            floor INTEGER,
            ceiling INTEGER,
            price_change_pct REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'financial_reports': '''
        CREATE TABLE IF NOT EXISTS financial_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            report_type TEXT NOT NULL,
            period TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER,
            data_json TEXT NOT NULL,
            source TEXT DEFAULT 'VCI',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, report_type, period, year, quarter),
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'balance_sheet': '''
        CREATE TABLE IF NOT EXISTS balance_sheet (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            period TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER,
            asset_current REAL,
            cash_and_equivalents REAL,
            short_term_investments REAL,
            accounts_receivable REAL,
            inventory REAL,
            current_assets_other REAL,
            asset_non_current REAL,
            long_term_receivables REAL,
            fixed_assets REAL,
            long_term_investments REAL,
            non_current_assets_other REAL,
            total_assets REAL,
            liabilities_total REAL,
            liabilities_current REAL,
            liabilities_non_current REAL,
            equity_total REAL,
            share_capital REAL,
            retained_earnings REAL,
            equity_other REAL,
            total_equity_and_liabilities REAL,
            data_json TEXT,
            source TEXT DEFAULT 'VCI',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, period, year, quarter),
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'income_statement': '''
        CREATE TABLE IF NOT EXISTS income_statement (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            period TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER,
            revenue REAL,
            revenue_growth REAL,
            net_profit_parent_company REAL,
            profit_growth REAL,
            net_revenue REAL,
            cost_of_goods_sold REAL,
            gross_profit REAL,
            financial_income REAL,
            financial_expense REAL,
            net_financial_income REAL,
            operating_expenses REAL,
            operating_profit REAL,
            other_income REAL,
            profit_before_tax REAL,
            corporate_income_tax REAL,
            deferred_income_tax REAL,
            net_profit REAL,
            minority_interest REAL,
            net_profit_parent_company_post REAL,
            eps REAL,
            data_json TEXT,
            source TEXT DEFAULT 'VCI',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, period, year, quarter),
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'cash_flow_statement': '''
        CREATE TABLE IF NOT EXISTS cash_flow_statement (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            period TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER,
            profit_before_tax REAL,
            depreciation_fixed_assets REAL,
            provision_credit_loss_real_estate REAL,
            profit_loss_from_disposal_fixed_assets REAL,
            profit_loss_investment_activities REAL,
            interest_income REAL,
            interest_and_dividend_income REAL,
            net_cash_flow_from_operating_activities_before_working_capital REAL,
            increase_decrease_receivables REAL,
            increase_decrease_inventory REAL,
            increase_decrease_payables REAL,
            increase_decrease_prepaid_expenses REAL,
            interest_expense_paid REAL,
            corporate_income_tax_paid REAL,
            other_cash_from_operating_activities REAL,
            other_cash_paid_for_operating_activities REAL,
            net_cash_from_operating_activities REAL,
            purchase_purchase_fixed_assets REAL,
            proceeds_from_disposal_fixed_assets REAL,
            loans_other_collections REAL,
            investments_other_companies REAL,
            proceeds_from_sale_investments_other_companies REAL,
            dividends_and_profits_received REAL,
            net_cash_from_investing_activities REAL,
            increase_share_capital_contribution_equity REAL,
            payment_for_capital_contribution_buyback_shares REAL,
            proceeds_from_borrowings REAL,
            repayments_of_borrowings REAL,
            lease_principal_payments REAL,
            dividends_paid REAL,
            other_cash_from_financing_activities REAL,
            net_cash_from_financing_activities REAL,
            net_cash_flow_period REAL,
            cash_and_cash_equivalents_beginning REAL,
            cash_and_cash_equivalents_ending REAL,
            data_json TEXT,
            source TEXT DEFAULT 'VCI',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, period, year, quarter),
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    ''',
    'financial_ratios': '''
        CREATE TABLE IF NOT EXISTS financial_ratios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            period TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER,
            price_to_book REAL,
            market_cap_billions REAL,
            shares_outstanding_millions REAL,
            price_to_earnings REAL,
            price_to_sales REAL,
            price_to_cash_flow REAL,
            eps_vnd REAL,
            bvps_vnd REAL,
            ev_to_ebitda REAL,
            debt_to_equity REAL,
            debt_to_equity_adjusted REAL,
            fixed_assets_to_equity REAL,
            equity_to_charter_capital REAL,
            asset_turnover REAL,
            fixed_asset_turnover REAL,
            days_sales_outstanding REAL,
            days_inventory_outstanding REAL,
            days_payable_outstanding REAL,
            cash_conversion_cycle REAL,
            inventory_turnover REAL,
            ebit_margin REAL,
            gross_margin REAL,
            net_profit_margin REAL,
            roe REAL,
            roic REAL,
            roa REAL,
            ebitda_billions REAL,
            ebit_billions REAL,
            dividend_payout_ratio REAL,
            current_ratio REAL,
            quick_ratio REAL,
            cash_ratio REAL,
            interest_coverage_ratio REAL,
            financial_leverage REAL,
            beta REAL,
            ev_to_ebit REAL,
            data_json TEXT,
            source TEXT DEFAULT 'VCI',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, period, year, quarter),
            FOREIGN KEY (symbol) REFERENCES stocks(ticker)
        )
    '''
}

CREATE_INDEXES_SQL = [
    'CREATE INDEX IF NOT EXISTS idx_stocks_status ON stocks(status)',
    'CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)',
    'CREATE INDEX IF NOT EXISTS idx_stock_exchange_ticker ON stock_exchange(ticker)',
    'CREATE INDEX IF NOT EXISTS idx_stock_exchange_exchange ON stock_exchange(exchange)',
    'CREATE INDEX IF NOT EXISTS idx_balance_sheet_symbol ON balance_sheet(symbol)',
    'CREATE INDEX IF NOT EXISTS idx_income_statement_symbol ON income_statement(symbol)',
    'CREATE INDEX IF NOT EXISTS idx_cash_flow_symbol ON cash_flow_statement(symbol)',
    'CREATE INDEX IF NOT EXISTS idx_ratios_symbol ON financial_ratios(symbol)'
]

DEFAULT_EXCHANGES = [
    ('HOSE', 'Sở Giao dịch Chứng khoán TP.HCM', 'HOSE'),
    ('HSX', 'Sở Giao dịch Chứng khoán TP.HCM', 'HSX'),
    ('HNX', 'Sở Giao dịch Chứng khoán Hà Nội', 'HNX'),
    ('UPCOM', 'Sàn giao dịch UPCOM', 'UPCOM')
]

DEFAULT_INDICES = [
    ('VN30', 'VN30', '30 cổ phiếu lớn nhất HOSE', 'HOSE Indices', 5, None),
    ('VN100', 'VN100', '100 cổ phiếu lớn nhất HOSE', 'HOSE Indices', 8, None)
]

# ============================================================================
# UTILS
# ============================================================================

def get_default_db_path() -> str:
    """Return the resolved database path."""
    env_path = os.environ.get("VIETNAM_STOCK_DB_PATH") or os.environ.get("STOCKS_DB_PATH")
    if env_path:
        return env_path

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "stocks_optimized.db")

# ============================================================================
# DATABASE CLASS
# ============================================================================

class StockDatabase:
    """Manager for the Vietnamese Stock Database (SQLite)."""
    
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or get_default_db_path()
        self.conn = None
        self.connect()
        self.init_database()
        
    def connect(self):
        try:
            self.conn = sqlite3.connect(self.db_path, timeout=30)
            self.conn.row_factory = sqlite3.Row
            try:
                self.conn.execute("PRAGMA journal_mode=WAL")
                self.conn.execute("PRAGMA synchronous=NORMAL")
                self.conn.execute("PRAGMA temp_store=MEMORY")
            except Exception:
                pass
        except Exception as e:
            logging.error(f"DB Connection Error: {e}")
            raise
    
    def init_database(self):
        try:
            for table_name, sql in CREATE_TABLES_SQL.items():
                self.conn.execute(sql)
            for index_sql in CREATE_INDEXES_SQL:
                self.conn.execute(index_sql)
            
            # Insert defaults
            for exchange in DEFAULT_EXCHANGES:
                self.conn.execute('INSERT OR IGNORE INTO exchanges (exchange, exchange_name, exchange_code) VALUES (?, ?, ?)', exchange)
            for idx in DEFAULT_INDICES:
                self.conn.execute('INSERT OR IGNORE INTO indices (index_code, index_name, description, group_name, index_id, sector_id) VALUES (?, ?, ?, ?, ?, ?)', idx)
            
            self.conn.commit()
        except Exception as e:
            logging.error(f"DB Init Error: {e}")
            self.conn.rollback()
            raise
    
    def log_update(self, table_name: str, records_count: int, status: str = 'success'):
        try:
            self.conn.execute('INSERT INTO update_log (table_name, records_updated, status) VALUES (?, ?, ?)', (table_name, records_count, status))
            self.conn.commit()
        except Exception:
            pass

    def close(self):
        if self.conn:
            self.conn.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def get_listed_stocks(self) -> pd.DataFrame:
        """Returns all listed stocks."""
        return pd.read_sql_query("SELECT ticker FROM stocks WHERE status = 'listed'", self.conn)

    def get_stocks_by_index(self, index_code: str) -> pd.DataFrame:
        """Returns stocks in a specific index."""
        query = "SELECT ticker FROM stock_index WHERE index_code = ?"
        return pd.read_sql_query(query, self.conn, params=(index_code,))

    def update_stocks_table(self, df: pd.DataFrame) -> int:
        """Upsert stock metadata into stocks table."""
        if df.empty: return 0
        count = 0
        for _, row in df.iterrows():
            self.conn.execute('''
                INSERT OR REPLACE INTO stocks (ticker, organ_name, organ_short_name, com_type_code, status, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (row['ticker'], row.get('organ_name'), row.get('organ_short_name'), row.get('com_type_code'), 'listed'))
            count += 1
        self.conn.commit()
        return count
