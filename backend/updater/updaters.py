import os
import functools
import pandas as pd
import json
import logging
import time
import re
import sqlite3
import traceback
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Literal
from .database import StockDatabase

try:
    from vnstock import Vnstock
except ImportError:
    Vnstock = None

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# VCI compatibility shims: VCI Company API occasionally changes response
# format or hits quota errors. These shims wrap the two internal methods
# that fail loudly so Finance (which uses a DIFFERENT endpoint for actual
# financial data) can still fetch balance_sheet / income_statement / etc.
#
# com_type_code values: 'CT' company  'CK' securities  'NH' bank  'BH' insurance
# ---------------------------------------------------------------------------
def _make_safe_wrapper(original_fn, fallback_value, label: str):
    """Return a wrapper that calls original_fn and falls back on any exception."""
    @functools.wraps(original_fn)
    def _wrapper(self):
        try:
            return original_fn(self)
        except Exception as exc:
            logger.debug(
                "VCI %s fallback for %s: %s",
                label, getattr(self, "symbol", "?"), exc,
            )
            return fallback_value
    return _wrapper


def _apply_vci_shims() -> None:
    """Apply compatibility shims to vnstock VCI internals once at startup."""
    try:
        from vnstock.explorer.vci import company as _vci_co_mod
        if not getattr(_vci_co_mod.Company._fetch_data, "_shim_applied", False):
            _vci_co_mod.Company._fetch_data = _make_safe_wrapper(
                _vci_co_mod.Company._fetch_data, {}, "Company._fetch_data"
            )
            _vci_co_mod.Company._fetch_data._shim_applied = True
    except Exception as exc:
        logger.warning("Could not shim VCI Company._fetch_data: %s", exc)

    try:
        from vnstock.explorer.vci import financial as _vci_fin_mod
        if not getattr(_vci_fin_mod.Finance._get_company_type, "_shim_applied", False):
            _vci_fin_mod.Finance._get_company_type = _make_safe_wrapper(
                _vci_fin_mod.Finance._get_company_type, "CT", "Finance._get_company_type"
            )
            _vci_fin_mod.Finance._get_company_type._shim_applied = True
    except Exception as exc:
        logger.warning("Could not shim VCI Finance._get_company_type: %s", exc)

    logger.debug("VCI compatibility shims applied.")


_apply_vci_shims()

# ============================================================================
# RATE LIMITER
# ============================================================================

class RateLimiter:
    def __init__(self, requests_per_minute: int = 30):
        self.limit = max(1, requests_per_minute)
        self.delay = max(1.2, 60.0 / self.limit)  # min 1.2s between calls
        self.count = 0
        self.last_reset = datetime.now()

    def check(self):
        now = datetime.now()
        if (now - self.last_reset).total_seconds() >= 60:
            self.count = 0
            self.last_reset = now

        if self.count >= self.limit - 1:
            wait = 60 - (now - self.last_reset).total_seconds()
            if wait > 0:
                logger.info(f"Rate limit reached, waiting {wait:.1f}s")
                time.sleep(wait)
            self.count = 0
            self.last_reset = datetime.now()

        time.sleep(self.delay)
        self.count += 1

# ============================================================================
# UPDATER BASE
# ============================================================================

# How many days since last update before we re-fetch a symbol's financials
SKIP_IF_UPDATED_WITHIN_DAYS = int(
    os.environ.get("SKIP_IF_UPDATED_WITHIN_DAYS", "3")
)


class BaseUpdater:
    def __init__(self, db_conn, requests_per_minute: int = 30):
        self.conn = db_conn
        self.limiter = RateLimiter(requests_per_minute)
        self.vnstock = Vnstock() if Vnstock else None

    def _was_recently_updated(self, symbol: str, table: str) -> bool:
        """Return True if *symbol* in *table* was updated within SKIP_IF_UPDATED_WITHIN_DAYS."""
        try:
            cutoff = (datetime.now() - timedelta(days=SKIP_IF_UPDATED_WITHIN_DAYS)).isoformat()
            row = self.conn.execute(
                f"SELECT updated_at FROM {table} WHERE symbol=? ORDER BY updated_at DESC LIMIT 1",
                (symbol,),
            ).fetchone()
            if row and row[0] and row[0] >= cutoff:
                return True
        except Exception:
            pass
        return False

# ============================================================================
# FINANCIAL UPDATER
# ============================================================================

class FinancialUpdater(BaseUpdater):
    # ------------------------------------------------------------------
    # KBS source: maps item_id (stable English slug) → DB column name.
    # KBS returns wide-format DataFrames: rows = line items, cols = years.
    # ------------------------------------------------------------------
    BALANCE_SHEET_MAPPING_KBS = {
        'a.short_term_assets':                    'asset_current',
        'i.cash_and_cash_equivalents':            'cash_and_equivalents',
        'ii.short_term_financial_investments':    'short_term_investments',
        'iii.short_term_receivables':             'accounts_receivable',
        'iv.inventories':                         'inventory',
        'v.other_short_term_assets':              'current_assets_other',
        'b.long_term_assets':                     'asset_non_current',
        'i.long_term_receivables':               'long_term_receivables',
        'ii.fixed_assets':                        'fixed_assets',
        'v.long_term_financial_investments':      'long_term_investments',
        'vi.other_long_term_assets':              'non_current_assets_other',
        'total_assets':                           'total_assets',
        'a.liabilities':                          'liabilities_total',
        'i.short_term_liabilities':              'liabilities_current',
        'ii.long_term_liabilities':              'liabilities_non_current',
        'b.owners_equity':                        'equity_total',
        'n_1.owners_capital':                     'share_capital',
        'n_11.undistributed_earnings_after_tax':  'retained_earnings',
        'n_4.other_capital_of_owners':            'equity_other',
        'total_owners_equity_and_liabilities':   'total_equity_and_liabilities',
    }

    INCOME_STATEMENT_MAPPING_KBS = {
        # ── Standard / Corporate ─────────────────────────────────────────────
        'n_1.revenue':                                           'revenue',
        'n_3.net_revenue':                                       'net_revenue',
        'n_4.cost_of_goods_sold':                                'cost_of_goods_sold',
        'n_5.gross_profit':                                      'gross_profit',
        'n_6.financial_income':                                  'financial_income',
        'n_7.financial_expenses':                                'financial_expense',
        'n_11.operating_profit':                                 'operating_profit',
        'n_12.other_income':                                     'other_income',
        'n_15.profit_before_tax':                                'profit_before_tax',
        'n_16.current_corporate_income_tax_expenses':            'corporate_income_tax',
        'n_17.deferred_income_tax_expenses':                     'deferred_income_tax',
        'n_18.net_profit_after_tax':                             'net_profit',
        'minoritys_interest':                                    'minority_interest',
        'profit_after_tax_for_shareholders_of_parent_company':   'net_profit_parent_company',
        'n_19.earnings_per_share_vnd':                           'eps',
        # ── Banks (NH) ────────────────────────────────────────────────────────
        'n_1.interest_income_and_similar_income':                'revenue',
        'i.net_interest_income':                                 'net_revenue',
        'ix.operating_profit_before_provision_for_credit_losses': 'operating_profit',
        'viii.operating_expenses':                               'operating_expenses',
        'xi.profit_before_tax':                                  'profit_before_tax',
        'xii.corporate_income_tax':                              'corporate_income_tax',
        'n_8.deferred_income_tax_expenses':                      'deferred_income_tax',
        'xiii.net_profit_after_tax':                             'net_profit',
        'xiv.minority_interest':                                 'minority_interest',
        'xv.net_profit_atttributable_to_the_equity_holders_of_the_bank': 'net_profit_parent_company',
        'earning_per_share_vnd':                                 'eps',
        # ── Securities (CK) ──────────────────────────────────────────────────
        'revenue_from_securities_business_01_11':                'revenue',
        'net_sales':                                             'net_revenue',
        'gross_profit':                                          'gross_profit',
        'total_financial_income_41_44':                          'financial_income',
        'total_financial_expenses_51_54':                        'financial_expense',
        'operating_expenses_21_33':                              'operating_expenses',
        'ix.profit_before_tax':                                  'profit_before_tax',
        'corporate_income_tax':                                  'corporate_income_tax',
        'n_10.2.deferred_income_tax_expenses':                   'deferred_income_tax',
        'xi.net_profit_after_tax':                               'net_profit',
        'n_11.3.profit_after_tax_attribute_to_non_controling_interest': 'minority_interest',
        'n_11.1.profit_after_tax_for_shareholders_of_the_parents_company': 'net_profit_parent_company',
        'n_13.1.earning_per_share_vnd':                          'eps',
    }

    # Financial ratios — VCI source returns wide-format (rows=items, cols=periods)
    # just like KBS.  We cover both camelCase and slug variants since vnstock
    # has changed naming conventions across versions.
    RATIOS_MAPPING_VCI = {
        # Valuation
        'price_to_earning':               'price_to_earnings',
        'priceToEarning':                 'price_to_earnings',
        'price_to_earnings':              'price_to_earnings',
        'p/e':                            'price_to_earnings',
        'price_to_book':                  'price_to_book',
        'priceToBook':                    'price_to_book',
        'p/b':                            'price_to_book',
        'price_to_sales':                 'price_to_sales',
        'priceToSales':                   'price_to_sales',
        'p/s':                            'price_to_sales',
        'price_to_cash_flow':             'price_to_cash_flow',
        'priceToCashFlow':                'price_to_cash_flow',
        'ev_to_ebitda':                   'ev_to_ebitda',
        'evToEbitda':                     'ev_to_ebitda',
        # Per-share
        'eps':                            'eps_vnd',
        'earning_per_share':              'eps_vnd',
        'earningPerShare':                'eps_vnd',
        'book_value_per_share':           'bvps_vnd',
        'bookValuePerShare':              'bvps_vnd',
        'bvps':                           'bvps_vnd',
        # Market
        'market_cap':                     'market_cap_billions',
        'marketCap':                      'market_cap_billions',
        'shares_outstanding':             'shares_outstanding_millions',
        'sharesOutstanding':              'shares_outstanding_millions',
        # Profitability
        'roe':                            'roe',
        'roa':                            'roa',
        'roic':                           'roic',
        'gross_profit_margin':            'gross_margin',
        'grossProfitMargin':              'gross_margin',
        'gross_margin':                   'gross_margin',
        'net_profit_margin':              'net_profit_margin',
        'netProfitMargin':                'net_profit_margin',
        'ebit_margin':                    'ebit_margin',
        'ebitMargin':                     'ebit_margin',
        # Leverage / Capital
        'debt_to_equity':                 'debt_to_equity',
        'debtToEquity':                   'debt_to_equity',
        'financial_leverage':             'financial_leverage',
        'financialLeverage':              'financial_leverage',
        'equity_to_charter_capital':      'equity_to_charter_capital',
        'equityToCharterCapital':         'equity_to_charter_capital',
        'fixed_assets_to_equity':         'fixed_assets_to_equity',
        'fixedAssetsToEquity':            'fixed_assets_to_equity',
        # Liquidity
        'current_ratio':                  'current_ratio',
        'currentRatio':                   'current_ratio',
        'quick_ratio':                    'quick_ratio',
        'quickRatio':                     'quick_ratio',
        'cash_ratio':                     'cash_ratio',
        'cashRatio':                      'cash_ratio',
        'interest_coverage':              'interest_coverage_ratio',
        'interestCoverage':               'interest_coverage_ratio',
        'interest_coverage_ratio':        'interest_coverage_ratio',
        # Efficiency
        'asset_turnover':                 'asset_turnover',
        'assetTurnover':                  'asset_turnover',
        'inventory_turnover':             'inventory_turnover',
        'inventoryTurnover':              'inventory_turnover',
        'fixed_asset_turnover':           'fixed_asset_turnover',
        'fixedAssetTurnover':             'fixed_asset_turnover',
        # Other
        'dividend_payout_ratio':          'dividend_payout_ratio',
        'dividendPayoutRatio':            'dividend_payout_ratio',
        'beta':                           'beta',
    }

    CASH_FLOW_MAPPING_KBS = {
        'n_1.profit_before_tax':                                                      'profit_before_tax',
        'depreciation_of_fixed_assets_and_properties_investment':                     'depreciation_fixed_assets',
        'reversal_of_provisions_provisions':                                          'provision_credit_loss_real_estate',
        'loss_profits_from_disposal_of_fixed_asset':                                  'profit_loss_from_disposal_fixed_assets',
        'loss_profit_from_investment_activities':                                     'profit_loss_investment_activities',
        'interest_expense':                                                           'interest_income',
        'n_3.operating_profit_before_changes_in_working_capital':                    'net_cash_flow_from_operating_activities_before_working_capital',
        'increase_decrease_in_receivables':                                           'increase_decrease_receivables',
        'increase_decrease_in_inventories':                                           'increase_decrease_inventory',
        'increase_decrease_in_payables_other_than_interest_corporate_income_tax':     'increase_decrease_payables',
        'increase_decrease_in_prepaid_expenses':                                      'increase_decrease_prepaid_expenses',
        'interest_paid':                                                              'interest_expense_paid',
        'corporate_income_tax_paid':                                                  'corporate_income_tax_paid',
        'other_receipts_from_operating_activities':                                   'other_cash_from_operating_activities',
        'other_payments_for_operating_activities':                                    'other_cash_paid_for_operating_activities',
        'net_cash_flows_from_operating_activities':                                   'net_cash_from_operating_activities',
        'n_1.payment_for_fixed_assets_constructions_and_other_long_term_assets':     'purchase_purchase_fixed_assets',
        'n_2.receipts_from_disposal_of_fixed_assets_and_other_long_term_assets':     'proceeds_from_disposal_fixed_assets',
        'n_4.receipts_from_loan_repayments_sale_of_other_entities_debt_instruments': 'loans_other_collections',
        'n_5.payments_for_investment_in_other_entities':                             'investments_other_companies',
        'n_6.collections_on_investment_in_other_entities':                           'proceeds_from_sale_investments_other_companies',
        'n_7.dividends_interest_and_profit_received':                                'dividends_and_profits_received',
        'net_cash_flows_from_investing_activities':                                   'net_cash_from_investing_activities',
        'n_1.receipts_from_equity_issue_and_owners_capital_contribution':            'increase_share_capital_contribution_equity',
        'n_2.payment_for_share_repurchases':                                         'payment_for_capital_contribution_buyback_shares',
        'n_3.proceeds_from_borrowings':                                              'proceeds_from_borrowings',
        'n_4_principal_repayments':                                                  'repayments_of_borrowings',
        'n_5.repayment_of_financial_leases':                                         'lease_principal_payments',
        'n_6.dividends_paid_profits_distributed_to_owners':                          'dividends_paid',
        'net_cash_flows_from_financing_activities':                                   'net_cash_from_financing_activities',
        'net_cash_flows_during_the_period':                                           'net_cash_flow_period',
        'cash_and_cash_equivalents_at_beginning_of_the_period':                      'cash_and_cash_equivalents_beginning',
        'cash_and_cash_equivalents_at_end_of_the_period':                            'cash_and_cash_equivalents_ending',
    }

    def _parse_kbs_period_col(self, col: str):
        """Return (year, quarter) from a KBS period column name.

        Annual:    '2024'        → (2024, None)
        Quarterly: 'Q1 2024'    → (2024, 1)
                   '2024Q1'     → (2024, 1)
                   'Q1/2024'    → (2024, 1)
        """
        col = str(col).strip()
        if re.match(r'^\d{4}$', col):
            return int(col), None
        m = re.match(r'Q(\d)[/ ](\d{4})', col)
        if m:
            return int(m.group(2)), int(m.group(1))
        m = re.match(r'(\d{4})[/ ]?Q(\d)', col)
        if m:
            return int(m.group(1)), int(m.group(2))
        return None, None

    def _upsert_kbs_rows(self, df: pd.DataFrame, table: str, mapping: dict,
                         symbol: str, period: str) -> int:
        """Upsert KBS wide-format data (rows=items, cols=year/quarter periods)."""
        if df is None or df.empty:
            return 0
        # Index by item_id; drop duplicates to avoid ambiguous .loc lookups
        df_idx = df.drop_duplicates(subset='item_id').set_index('item_id')
        period_cols = [c for c in df_idx.columns if c not in ('item', 'unit')]
        count = 0
        now = datetime.now().isoformat()
        for col in period_cols:
            year, quarter = self._parse_kbs_period_col(col)
            if year is None:
                continue
            record = {}
            for item_id, db_col in mapping.items():
                if item_id in df_idx.index:
                    val = df_idx.loc[item_id, col]
                    record[db_col] = float(val) if pd.notna(val) else None
            if not record:
                continue
            self.conn.execute(
                f"DELETE FROM {table} WHERE symbol=? AND year=? AND (quarter IS ? OR quarter=?)",
                (symbol, year, quarter, quarter),
            )
            cols = ['symbol', 'period', 'year', 'quarter', 'source', 'updated_at'] + list(record.keys())
            vals = [symbol, period, year, quarter, 'KBS', now] + list(record.values())
            sql = (
                f"INSERT INTO {table} ({','.join(cols)}) "
                f"VALUES ({','.join(['?'] * len(vals))})"
            )
            self.conn.execute(sql, vals)
            count += 1
        return count

    def _upsert_vci_ratio_rows(self, df: pd.DataFrame, symbol: str, period: str) -> int:
        """Upsert VCI ratio DataFrame into financial_ratios.

        VCI ratio() returns wide-format (rows=items, cols=periods) identical to KBS,
        so we reuse _upsert_kbs_rows with our RATIOS_MAPPING_VCI.
        Falls back to long-format parsing if item_id column is absent.
        """
        if df is None or df.empty:
            return 0

        # Wide format: has item_id column (same as KBS balance_sheet etc.)
        if 'item_id' in df.columns:
            return self._upsert_kbs_rows(df, 'financial_ratios', self.RATIOS_MAPPING_VCI, symbol, period)

        # Long format: rows = periods, columns = metric names
        count = 0
        now = datetime.now().isoformat()
        for idx, row in df.iterrows():
            year, quarter = self._parse_kbs_period_col(str(idx))
            if year is None:
                continue
            record = {}
            for col in df.columns:
                db_col = self.RATIOS_MAPPING_VCI.get(str(col)) or self.RATIOS_MAPPING_VCI.get(str(col).lower())
                if db_col:
                    val = row[col]
                    record[db_col] = float(val) if pd.notna(val) else None
            if not record:
                continue
            self.conn.execute(
                "DELETE FROM financial_ratios WHERE symbol=? AND year=? AND (quarter IS ? OR quarter=?)",
                (symbol, year, quarter, quarter),
            )
            cols = ['symbol', 'period', 'year', 'quarter', 'source', 'updated_at'] + list(record.keys())
            vals = [symbol, period, year, quarter, 'VCI', now] + list(record.values())
            self.conn.execute(
                f"INSERT INTO financial_ratios ({','.join(cols)}) VALUES ({','.join(['?']*len(vals))})",
                vals,
            )
            count += 1
        return count

    def update_stock(self, symbol: str, period: str = 'year') -> dict:
        if not self.vnstock:
            logger.error("Vnstock library not available")
            return {}

        # Smart-skip: only skip if BOTH financial statements AND ratios are fresh.
        # Previously only checked balance_sheet, which meant financial_ratios were
        # never refreshed even when they were months out of date.
        if (self._was_recently_updated(symbol, 'balance_sheet') and
                self._was_recently_updated(symbol, 'financial_ratios')):
            logger.info(f"  ⊙ Skip {symbol} (balance_sheet + financial_ratios updated < {SKIP_IF_UPDATED_WITHIN_DAYS}d ago)")
            return {}

        logger.info(f"  → Fetching BCTC: {symbol} ({period})")
        results: dict = {}
        # KBS uses 'year' for annual; 'quarter' for quarterly (same as our default)
        kbs_period = 'year' if period in ('year', 'annual') else 'quarter'
        try:
            # Rate-limit BEFORE creating stock object (which may make an API call)
            self.limiter.check()
            stock = self.vnstock.stock(symbol=symbol, source='KBS')

            # 1. Balance Sheet
            bs_df = stock.finance.balance_sheet(period=kbs_period, display_mode='vi')
            if bs_df is not None and not bs_df.empty:
                n = self._upsert_kbs_rows(bs_df, 'balance_sheet', self.BALANCE_SHEET_MAPPING_KBS, symbol, period)
                results['balance_sheet'] = n
                logger.debug(f"    balance_sheet: {n} rows")

            # 2. Income Statement
            self.limiter.check()
            is_df = stock.finance.income_statement(period=kbs_period, display_mode='vi')
            if is_df is not None and not is_df.empty:
                n = self._upsert_kbs_rows(is_df, 'income_statement', self.INCOME_STATEMENT_MAPPING_KBS, symbol, period)
                results['income_statement'] = n
                logger.debug(f"    income_statement: {n} rows")

            # 3. Cash Flow Statement
            self.limiter.check()
            cf_df = stock.finance.cash_flow(period=kbs_period, display_mode='vi')
            if cf_df is not None and not cf_df.empty:
                n = self._upsert_kbs_rows(cf_df, 'cash_flow_statement', self.CASH_FLOW_MAPPING_KBS, symbol, period)
                results['cash_flow_statement'] = n
                logger.debug(f"    cash_flow: {n} rows")

            # 4. Financial Ratios (VCI source — different endpoint from KBS financials)
            try:
                self.limiter.check()
                ratio_stock = self.vnstock.stock(symbol=symbol, source='VCI')
                ratio_df = ratio_stock.finance.ratio(period=kbs_period, display_mode='en')
                if ratio_df is not None and not ratio_df.empty:
                    n = self._upsert_vci_ratio_rows(ratio_df, symbol, period)
                    results['financial_ratios'] = n
                    logger.debug(f"    financial_ratios: {n} rows")
            except Exception as ratio_exc:
                # Ratio fetch is best-effort — don't fail the whole stock update
                logger.warning(f"    financial_ratios fetch failed for {symbol}: {ratio_exc}")

            self.conn.commit()
            total = sum(results.values())
            if total:
                logger.info(f"  ✓ {symbol}: {total} rows written ({', '.join(f'{k}={v}' for k,v in results.items())})")
            else:
                logger.info(f"  ⊙ {symbol}: API returned no new rows (data up to date)")

        except Exception as exc:
            self.conn.rollback()
            logger.error(
                f"  ✗ Error updating {symbol}: {exc}\n{traceback.format_exc()}"
            )
        return results

# ============================================================================
# COMPANY UPDATER
# ============================================================================

class CompanyUpdater(BaseUpdater):
    @staticmethod
    def _to_int(value, default: int = 0) -> int:
        try:
            if value is None:
                return default
            return int(float(value))
        except Exception:
            return default

    @staticmethod
    def _to_float(value, default: float = 0.0) -> float:
        try:
            if value is None:
                return default
            return float(value)
        except Exception:
            return default

    def _upsert_shareholders(self, symbol: str, df: pd.DataFrame) -> int:
        if df is None or df.empty:
            return 0

        count = 0
        for _, row in df.iterrows():
            holder = str(row.get('share_holder') or '').strip()
            if not holder:
                continue

            update_date = str(row.get('update_date') or '').strip() or datetime.now().strftime('%Y-%m-%d')
            raw_id = str(row.get('id') or '').strip()
            rec_id = raw_id or f"{symbol}_sh_{holder}_{update_date}"

            self.conn.execute(
                '''
                INSERT OR REPLACE INTO shareholders
                    (id, symbol, share_holder, quantity, share_own_percent, update_date)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (
                    rec_id,
                    symbol,
                    holder,
                    self._to_int(row.get('quantity')),
                    self._to_float(row.get('share_own_percent')),
                    update_date,
                ),
            )
            count += 1

        return count

    def update_overview(self, symbol: str) -> int:
        if not self.vnstock:
            return 0
        self.limiter.check()
        try:
            stock = self.vnstock.stock(symbol=symbol, source='VCI')
            df = stock.company.overview()
            changed = 0

            if df is not None and not df.empty:
                row = df.iloc[0]
                self.conn.execute("DELETE FROM company_overview WHERE symbol=?", (symbol,))
                self.conn.execute(
                    '''INSERT INTO company_overview
                       (symbol, history, company_profile,
                        icb_name4, icb_name3, icb_name2,
                        issue_share, charter_capital, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                    (
                        symbol,
                        row.get('history'),
                        row.get('company_profile'),
                        row.get('icb_name4'),
                        row.get('icb_name3'),
                        row.get('icb_name2'),
                        self._to_int(row.get('issue_share')),
                        self._to_int(row.get('charter_capital')),
                    ),
                )
                changed += 1

            # Holders datasets are critical for the Holders tab accuracy.
            try:
                self.limiter.check()
                sh_df = stock.company.shareholders()
                changed += self._upsert_shareholders(symbol, sh_df)
            except Exception as sh_exc:
                logger.warning(f"shareholders update failed for {symbol}: {sh_exc}")

            self.conn.commit()
            return 1 if changed > 0 else 0
        except Exception as exc:
            self.conn.rollback()
            logger.error(f"Error updating company info for {symbol}: {exc}")
            return 0
