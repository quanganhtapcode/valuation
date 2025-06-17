import pandas as pd
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging
from datetime import datetime, timedelta
from vnstock import Vnstock
from vnstock.explorer.vci import Company
from valuation_models import ValuationModels

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

class StockDataProvider:
    def __init__(self):
        self.sources = ["VCI"]
        self.vnstock = Vnstock()
        self._all_symbols = None
        self._industry_mapping = None
        logger.info("StockDataProvider initialized with VCI source only (symbols will be loaded on first request)")

    def _load_industry_mapping(self):
        if self._industry_mapping is not None:
            return self._industry_mapping
        try:
            df = pd.read_csv('top10_industries.csv')
            self._industry_mapping = dict(zip(df['symbol'].str.upper(), df['industry']))
            logger.info(f"Successfully loaded industry mapping for {len(self._industry_mapping)} symbols")
            return self._industry_mapping
        except Exception as e:
            logger.warning(f"Failed to load industry mapping from top10_industries.csv: {e}")
            self._industry_mapping = {}
            return self._industry_mapping

    def _get_industry_for_symbol(self, symbol: str) -> str:
        mapping = self._load_industry_mapping()
        return mapping.get(symbol.upper(), "Unknown")

    def _get_all_symbols(self):
        if self._all_symbols is not None:
            return self._all_symbols
        logger.info("Loading symbols list for the first time...")
        try:
            stock = self.vnstock.stock(symbol="ACB", source="VCI")
            symbols_df = stock.listing.all_symbols()
            self._all_symbols = symbols_df["symbol"].str.upper().values
            logger.info(f"Successfully loaded {len(self._all_symbols)} symbols from VCI")
            return self._all_symbols
        except Exception as e:
            logger.warning(f"Failed to get symbols list from VCI: {e}")
            self._all_symbols = []
            return self._all_symbols

    def validate_symbol(self, symbol: str) -> bool:
        symbols = self._get_all_symbols()
        if symbols is None or len(symbols) == 0:
            logger.warning(f"Cannot validate symbol {symbol} - symbols list unavailable")
            return True
        return symbol.upper() in symbols

    def get_stock_data(self, symbol: str, period: str = "year") -> dict:
        symbol = symbol.upper()
        if not self.validate_symbol(symbol):
            raise ValueError(f"Symbol {symbol} is not valid.")
        logger.info(f"Attempting to get comprehensive data from VCI for {symbol}")
        vci_data = self._get_vci_data(symbol)
        if vci_data and vci_data.get('success'):
            vci_data.update({
                "symbol": symbol,
                "name": symbol,
                "exchange": "HOSE",
                "sector": self._get_industry_for_symbol(symbol),
                "data_period": period,
                "price_change": np.nan
            })
            try:
                stock = self.vnstock.stock(symbol=symbol, source="VCI")
                current_price = self._get_market_price_vci(stock, symbol)
                if pd.notna(current_price):
                    vci_data["current_price"] = current_price
            except Exception as e:
                logger.debug(f"Could not get current price from VCI: {e}")
            if pd.notna(vci_data.get("current_price")) and pd.notna(vci_data.get("shares_outstanding")):
                vci_data["market_cap"] = vci_data["current_price"] * vci_data["shares_outstanding"]
            return vci_data
        logger.warning(f"VCI comprehensive data failed, trying basic VCI fallback for {symbol}")
        try:
            stock = self.vnstock.stock(symbol=symbol, source="VCI")
            company = self._get_company_overview(stock, symbol)
            financials = self._get_financial_statements(stock, period)
            market = self._get_price_data(stock, company["shares_outstanding"], symbol)
            return {
                **company,
                **financials,
                **market,
                "data_source": "VCI",
                "data_period": period,
                "success": True
            }
        except Exception as exc:
            logger.error(f"All VCI methods failed for {symbol}: {exc}")
            raise RuntimeError(f"All VCI data sources failed for {symbol}")

    def _get_company_overview(self, stock, symbol: str) -> dict:
        try:
            symbols_df = stock.listing.symbols_by_exchange()
            industries_df = stock.listing.symbols_by_industries()
            company_info = symbols_df[symbols_df['symbol'] == symbol] if not symbols_df.empty else pd.DataFrame()
            industry_info = industries_df[industries_df['symbol'] == symbol] if not industries_df.empty else pd.DataFrame()
            name = symbol
            exchange = "HOSE"
            sector = self._get_industry_for_symbol(symbol)
            shares = np.nan
            if not company_info.empty:
                name_fields = ["organ_short_name", "organ_name", "short_name", "company_name"]
                for f in name_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]) and str(company_info[f].iloc[0]).strip():
                        name = str(company_info[f].iloc[0])
                        break
                exchange_fields = ["exchange", "comGroupCode", "type"]
                for f in exchange_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]):
                        exchange = str(company_info[f].iloc[0])
                        break
                share_fields = ["listed_share", "issue_share", "outstanding_share", "sharesOutstanding", "totalShares"]
                for f in share_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]):
                        shares = float(company_info[f].iloc[0])
                        break
            if not industry_info.empty:
                sector_fields = ["icb_name2", "icb_name3", "icb_name4", "industry", "industryName"]
                for f in sector_fields:
                    if f in industry_info.columns and pd.notna(industry_info[f].iloc[0]) and str(industry_info[f].iloc[0]).strip():
                        sector = str(industry_info[f].iloc[0])
                        break
            if pd.isna(shares) or name == symbol:
                try:
                    overview = stock.company.overview()
                    if overview is not None and not overview.empty:
                        row = overview.iloc[0]
                        if pd.isna(shares):
                            share_fields = ["issue_share", "listed_share", "outstanding_share", "sharesOutstanding", "totalShares"]
                            for f in share_fields:
                                if f in row and pd.notna(row[f]):
                                    shares = float(row[f])
                                    break
                        if name == symbol:
                            name_fields = ["organ_name", "short_name", "company_name", "shortName"]
                            for f in name_fields:
                                if f in row and pd.notna(row[f]) and str(row[f]).strip():
                                    name = str(row[f])
                                    break
                except Exception as e:
                    logger.debug(f"Company overview fallback failed: {e}")
            return {
                "symbol": symbol,
                "name": name,
                "exchange": exchange,
                "sector": sector,
                "shares_outstanding": shares
            }
        except Exception as e:
            logger.warning(f"Company overview failed for {symbol}: {e}")
            return {
                "symbol": symbol,
                "name": symbol,
                "exchange": "HOSE",
                "sector": self._get_industry_for_symbol(symbol),
                "shares_outstanding": np.nan
            }

    def _get_financial_statements(self, stock, period: str) -> dict:
        is_quarter = (period == "quarter")
        freq = "quarter" if is_quarter else "year"
        try:
            income = stock.finance.income_statement(period=freq, lang="en", dropna=True)
            balance = stock.finance.balance_sheet(period=freq, lang="en", dropna=True)
            cashfl = stock.finance.cash_flow(period=freq, lang="en", dropna=True)
            if income.empty and balance.empty:
                income = stock.finance.income_statement(period=freq, lang="vn", dropna=True)
                balance = stock.finance.balance_sheet(period=freq, lang="vn", dropna=True)
                cashfl = stock.finance.cash_flow(period=freq, lang="vn", dropna=True)
            return self._extract_financial_metrics(income, balance, cashfl, is_quarter)
        except Exception as e:
            logger.warning(f"Financial statements failed: {e}")
            return self._get_empty_financials(is_quarter)

    def _get_empty_financials(self, is_quarter: bool) -> dict:
        return {
            "revenue_ttm": np.nan,
            "net_income_ttm": np.nan,
            "ebit": np.nan,
            "ebitda": np.nan,
            "total_assets": np.nan,
            "total_debt": np.nan,
            "total_liabilities": np.nan,
            "cash": np.nan,
            "depreciation": np.nan,
            "fcfe": np.nan,
            "capex": np.nan,
            "is_quarterly_data": is_quarter
        }

    def _extract_financial_metrics(self, income, balance, cashfl, is_quarter):
        def _pick(df, candidates):
            if df.empty:
                return np.nan
            row = df.iloc[0]
            for c in candidates:
                if c in row and pd.notna(row[c]):
                    val = row[c]
                    if isinstance(val, str):
                        try:
                            val = float(val.replace(',', ''))
                        except:
                            continue
                    return float(val)
            return np.nan

        def _sum_last_4_quarters(df, candidates):
            if df.empty or len(df) < 4:
                return np.nan
            total = 0
            for i in range(min(4, len(df))):
                row = df.iloc[i]
                for c in candidates:
                    if c in row and pd.notna(row[c]):
                        val = row[c]
                        if isinstance(val, str):
                            try:
                                val = float(val.replace(',', ''))
                            except:
                                continue
                        total += float(val)
                        break
            return total if total != 0 else np.nan

        def _calculate_ebitda(income_df, cashfl_df):
            if income_df.empty:
                return np.nan
            gross_profit = _pick(income_df, ["Gross Profit", "Gross profit", "gross_profit", "grossProfit"])
            selling_expenses = _pick(income_df, ["Selling Expenses", "Selling expenses", "selling_expenses", "sellingExpenses"])
            admin_expenses = _pick(income_df, ["General & Admin Expenses", "General & admin expenses", "admin_expenses", "adminExpenses", "general_admin_expenses"])
            depreciation = _pick(cashfl_df, ["Depreciation and Amortisation", "Depreciation", "depreciation", "depreciationAndAmortisation"])
            components = [gross_profit, selling_expenses, admin_expenses, depreciation]
            if any(pd.notna(comp) for comp in components):
                total = sum(comp for comp in components if pd.notna(comp))
                return total if total != 0 else np.nan
            return _pick(income_df, ["EBITDA", "ebitda"])

        if is_quarter:
            net_income_ttm = _sum_last_4_quarters(income, ["Net Profit For the Year", "Net income", "net_income", "netIncome", "profit"])
            revenue_ttm = _sum_last_4_quarters(income, ["Revenue (Bn. VND)", "Revenue", "revenue", "netRevenue", "totalRevenue"])
            ebit_ttm = _sum_last_4_quarters(income, ["Lợi nhuận từ hoạt động kinh doanh", "Operating income", "EBIT", "Operating profit", "operationProfit"])
            depreciation_ttm = _sum_last_4_quarters(cashfl, ["Depreciation and Amortisation", "Depreciation", "depreciation"])
            fcfe_ttm = _sum_last_4_quarters(cashfl, ["Lưu chuyển tiền thuần từ hoạt động kinh doanh", "Operating cash flow", "Cash from operations"])
            capex_ttm = _sum_last_4_quarters(cashfl, ["Chi để mua sắm tài sản cố định", "Capital expenditure", "Capex", "capex"])
            ebitda_ttm = np.nan
            if not income.empty and len(income) >= 4:
                total_gross_profit = _sum_last_4_quarters(income, ["Lợi nhuận gộp", "Gross profit", "gross_profit", "grossProfit"])
                total_selling_exp = _sum_last_4_quarters(income, ["Chi phí bán hàng", "Selling expenses", "selling_expenses", "sellingExpenses"])
                total_admin_exp = _sum_last_4_quarters(income, ["Chi phí quản lý doanh nghiệp", "General & admin expenses", "admin_expenses", "adminExpenses"])
                total_depreciation = _sum_last_4_quarters(cashfl, ["Khấu hao tài sản cố định", "Depreciation", "depreciation"])
                components = [total_gross_profit, total_selling_exp, total_admin_exp, total_depreciation]
                if any(pd.notna(comp) for comp in components):
                    ebitda_ttm = sum(comp for comp in components if pd.notna(comp))
                else:
                    ebitda_ttm = _sum_last_4_quarters(income, ["EBITDA", "ebitda"])
            total_assets = _pick(balance, ["TỔNG CỘNG TÀI SẢN", "Total assets", "totalAsset", "totalAssets"])
            total_liabilities = _pick(balance, ["TỔNG CỘNG NỢ PHẢI TRẢ", "Total liabilities", "totalLiabilities", "totalDebt"])
            cash = _pick(balance, ["Tiền và tương đương tiền", "Cash", "cash", "cashAndEquivalents"])
            return {
                "revenue_ttm": revenue_ttm if pd.notna(revenue_ttm) else np.nan,
                "net_income_ttm": net_income_ttm if pd.notna(net_income_ttm) else np.nan,
                "ebit": ebit_ttm if pd.notna(ebit_ttm) else np.nan,
                "ebitda": ebitda_ttm if pd.notna(ebitda_ttm) else np.nan,
                "total_assets": total_assets,
                "total_debt": total_liabilities,
                "total_liabilities": total_liabilities,
                "cash": cash,
                "depreciation": depreciation_ttm if pd.notna(depreciation_ttm) else np.nan,
                "fcfe": fcfe_ttm if pd.notna(fcfe_ttm) else np.nan,
                "capex": capex_ttm if pd.notna(capex_ttm) else np.nan,
                "is_quarterly_data": is_quarter
            }
        else:
            net_income = _pick(income, ["Lợi nhuận sau thuế", "Net income", "net_income", "netIncome", "profit"])
            revenue = _pick(income, ["Doanh thu thuần", "Revenue", "revenue", "netRevenue", "totalRevenue"])
            total_assets = _pick(balance, ["TỔNG CỘNG TÀI SẢN", "Total assets", "totalAsset", "totalAssets"])
            total_liabilities = _pick(balance, ["TỔNG CỘNG NỢ PHẢI TRẢ", "Total liabilities", "totalLiabilities", "totalDebt"])
            cash = _pick(balance, ["Tiền và tương đương tiền", "Cash", "cash", "cashAndEquivalents"])
            ebit = _pick(income, ["Lợi nhuận từ hoạt động kinh doanh", "Operating income", "EBIT", "Operating profit", "operationProfit"])
            depreciation = _pick(cashfl, ["Khấu hao tài sản cố định", "Depreciation", "depreciation"])
            fcfe = _pick(cashfl, ["Lưu chuyển tiền thuần từ hoạt động kinh doanh", "Operating cash flow", "Cash from operations"])
            capex = _pick(cashfl, ["Chi để mua sắm tài sản cố định", "Capital expenditure", "Capex", "capex"])
            ebitda = _calculate_ebitda(income, cashfl)
            return {
                "revenue_ttm": revenue if pd.notna(revenue) else np.nan,
                "net_income_ttm": net_income if pd.notna(net_income) else np.nan,
                "ebit": ebit if pd.notna(ebit) else np.nan,
                "ebitda": ebitda if pd.notna(ebitda) else np.nan,
                "total_assets": total_assets,
                "total_debt": total_liabilities,
                "total_liabilities": total_liabilities,
                "cash": cash,
                "depreciation": depreciation if pd.notna(depreciation) else np.nan,
                "fcfe": fcfe if pd.notna(fcfe) else np.nan,
                "capex": capex if pd.notna(capex) else np.nan,
                "is_quarterly_data": is_quarter
            }

    def _get_price_data(self, stock, shares_outstanding, symbol) -> dict:
        current_price = self._get_market_price_vci(stock, symbol)
        eps = book_value = np.nan
        try:
            ratios = stock.company.ratio_summary()
            if not ratios.empty:
                r = ratios.iloc[0]
                eps_fields = ["EPS (VND)", "earningsPerShare", "earnings_per_share"]
                for field in eps_fields:
                    if field in r and pd.notna(r[field]):
                        eps = float(r[field])
                        break
                bv_fields = ["BVPS (VND)", "bookValue", "book_value_per_share"]
                for field in bv_fields:
                    if field in r and pd.notna(r[field]):
                        book_value = float(r[field])
                        break
        except Exception as e:
            logger.debug(f"Ratio summary failed: {e}")
        market_cap = (
            current_price * shares_outstanding
            if pd.notna(current_price) and pd.notna(shares_outstanding)
            else np.nan
        )
        pe = (
            current_price / eps
            if pd.notna(current_price) and pd.notna(eps) and eps > 0
            else np.nan
        )
        pb = (
            current_price / book_value
            if pd.notna(current_price) and pd.notna(book_value) and book_value > 0
            else np.nan
        )
        return {
            "current_price": current_price,
            "market_cap": market_cap,
            "pe_ratio": pe,
            "pb_ratio": pb
        }

    def _get_vci_data(self, symbol: str) -> dict:
        try:
            company = Company(symbol)
            ratio_data = company.ratio_summary().T
            if ratio_data.empty:
                return {}
            data = ratio_data.iloc[:, 0]
            def safe_get(key, default=np.nan):
                try:
                    if key in data.index and pd.notna(data[key]):
                        return float(data[key])
                    return default
                except:
                    return default
            financial_data = {
                'revenue_ttm': safe_get('revenue', 0),
                'net_income_ttm': safe_get('net_profit', 0),
                'revenue_growth': safe_get('revenue_growth', 0) * 100,
                'net_profit_margin': safe_get('net_profit_margin', 0) * 100,
                'gross_margin': safe_get('gross_margin', 0) * 100,
                'roe': safe_get('roe', 0) * 100,
                'roa': safe_get('roa', 0) * 100,
                'roic': safe_get('roic', 0) * 100,
                'pe_ratio': safe_get('pe'),
                'pb_ratio': safe_get('pb'),
                'ps_ratio': safe_get('ps'),
                'pcf_ratio': safe_get('pcf'),
                'ev_ebitda': safe_get('ev_per_ebitda'),
                'eps': safe_get('eps'),
                'eps_ttm': safe_get('eps_ttm'),
                'bvps': safe_get('bvps'),
                'debt_to_equity': safe_get('de', 0),
                'current_ratio': safe_get('current_ratio'),
                'quick_ratio': safe_get('quick_ratio'),
                'cash_ratio': safe_get('cash_ratio'),
                'enterprise_value': safe_get('ev'),
                'shares_outstanding': safe_get('issue_share'),
                'charter_capital': safe_get('charter_capital'),
                'ebitda': safe_get('ebitda', 0),
                'ebit': safe_get('ebit', 0),
                'ebit_margin': safe_get('ebit_margin', 0) * 100,
                'dividend_per_share': safe_get('dividend', 0),
                'data_source': 'VCI',
                'year_report': safe_get('year_report'),
                'update_date': safe_get('update_date'),
                'success': True
            }
            shares = safe_get('issue_share', np.nan)
            equity_value = shares * safe_get('bvps', np.nan) if pd.notna(shares) and pd.notna(safe_get('bvps', np.nan)) else np.nan
            ae_ratio = safe_get('ae', np.nan)
            if pd.notna(ae_ratio) and pd.notna(equity_value) and ae_ratio > 0:
                financial_data['total_assets'] = ae_ratio * equity_value
                de_ratio = safe_get('de', np.nan)
                if pd.notna(de_ratio) and pd.notna(equity_value):
                    financial_data['total_debt'] = de_ratio * equity_value
                    financial_data['total_liabilities'] = financial_data['total_debt']
            else:
                financial_data['total_assets'] = np.nan
                financial_data['total_debt'] = np.nan
                financial_data['total_liabilities'] = np.nan
            try:
                stock = self.vnstock.stock(symbol=symbol, source='VCI')
                ratio_year = stock.finance.ratio(period='year', lang='en', dropna=True)
                ratio_quarter = stock.finance.ratio(period='quarter', lang='en', dropna=True)
                enhanced_ratios = {}
                if not ratio_year.empty:
                    logger.info(f"Successfully retrieved year ratio data for {symbol}, shape: {ratio_year.shape}")
                    latest_year_row = ratio_year.sort_values(('Meta', 'yearReport'), ascending=False).head(1)
                    eps_columns = [
                        ('Chỉ tiêu định giá', 'EPS (VND)'),
                        ('Valuation Metrics', 'EPS (VND)'),
                        ('Metrics', 'EPS')
                    ]
                    bvps_columns = [
                        ('Chỉ tiêu định giá', 'BVPS (VND)'),
                        ('Valuation Metrics', 'BVPS (VND)'),
                        ('Metrics', 'BVPS')
                    ]
                    latest_year_eps = None
                    for col in eps_columns:
                        if col in latest_year_row.columns:
                            latest_year_eps = latest_year_row[col].values[0]
                            break
                    latest_year_bvps = None
                    for col in bvps_columns:
                        if col in latest_year_row.columns:
                            latest_year_bvps = latest_year_row[col].values[0]
                            break
                    if pd.notna(latest_year_eps):
                        enhanced_ratios['EPS (VND)'] = latest_year_eps
                        logger.info(f"Found year EPS: {latest_year_eps}")
                    if pd.notna(latest_year_bvps):
                        enhanced_ratios['BVPS (VND)'] = latest_year_bvps
                        logger.info(f"Found year BVPS: {latest_year_bvps}")
                if not ratio_quarter.empty:
                    logger.info(f"Successfully retrieved quarter ratio data for {symbol}, shape: {ratio_quarter.shape}")
                    try:
                        ratio_quarter[('Meta', 'yearReport')] = pd.to_numeric(ratio_quarter[('Meta', 'yearReport')], errors='coerce').fillna(0).astype(int)
                        ratio_quarter[('Meta', 'lengthReport')] = pd.to_numeric(ratio_quarter[('Meta', 'lengthReport')], errors='coerce').fillna(0).astype(int)
                    except Exception as e:
                        logger.warning(f"Failed to convert year/quarter columns for {symbol}: {e}")
                        return financial_data
                    latest_quarter_row = ratio_quarter.sort_values([('Meta', 'yearReport'), ('Meta', 'lengthReport')], ascending=[False, False]).head(1)
                    quarter_metrics = [
                        ('Chỉ tiêu định giá', 'Market Capital (Bn. VND)'),
                        ('Chỉ tiêu định giá', 'EV/EBITDA'),
                        ('Chỉ tiêu khả năng sinh lợi', 'EBITDA (Bn. VND)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'ROE (%)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'ROA (%)'),
                        ('Chỉ tiêu cơ cấu nguồn vốn', 'Debt/Equity'),
                        ('Chỉ tiêu định giá', 'P/E'),
                        ('Chỉ tiêu định giá', 'P/B'),
                        ('Chỉ tiêu định giá', 'P/S'),
                        ('Chỉ tiêu hiệu quả hoạt động', 'Asset Turnover'),
                        ('Chỉ tiêu hiệu quả hoạt động', 'Inventory Turnover'),
                        ('Chỉ tiêu hiệu quả hoạt động', 'Fixed Asset Turnover'),
                        ('Chỉ tiêu thanh khoản', 'Current Ratio'),
                        ('Chỉ tiêu thanh khoản', 'Quick Ratio'),
                        ('Chỉ tiêu thanh khoản', 'Cash Ratio'),
                        ('Chỉ tiêu thanh khoản', 'Interest Coverage'),
                        ('Chỉ tiêu khả năng sinh lợi', 'EBIT Margin (%)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'Gross Profit Margin (%)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'Net Profit Margin (%)')
                    ]
                    for metric in quarter_metrics:
                        if metric in latest_quarter_row.columns:
                            value = latest_quarter_row[metric].values[0]
                            if pd.notna(value):
                                # Convert margin metrics to percentage
                                if metric[1] in ['EBIT Margin (%)', 'Gross Profit Margin (%)', 'Net Profit Margin (%)']:
                                    enhanced_ratios[metric[1]] = float(value) * 100
                                else:
                                    enhanced_ratios[metric[1]] = float(value)
                                logger.info(f"Found {metric[1]}: {enhanced_ratios[metric[1]]}")
                def safe_get_additional(col_name, default=np.nan):
                    try:
                        if col_name in enhanced_ratios and pd.notna(enhanced_ratios[col_name]):
                            return float(enhanced_ratios[col_name])
                        return default
                    except:
                        return default
                frontend_mapping = {
                    'Market Capital (Bn. VND)': 'market_cap',
                    'EV/EBITDA': 'ev_ebitda',
                    'EBITDA (Bn. VND)': 'ebitda',
                    'ROE (%)': 'roe',
                    'ROA (%)': 'roa',
                    'Debt/Equity': 'debt_to_equity',
                    'P/E': 'pe_ratio',
                    'P/B': 'pb_ratio',
                    'P/S': 'ps_ratio',
                    'Asset Turnover': 'asset_turnover',
                    'Inventory Turnover': 'inventory_turnover',
                    'Fixed Asset Turnover': 'fixed_asset_turnover',
                    'Current Ratio': 'current_ratio',
                    'Quick Ratio': 'quick_ratio',
                    'Cash Ratio': 'cash_ratio',
                    'Interest Coverage': 'interest_coverage',
                    'EBIT Margin (%)': 'ebit_margin',
                    'Gross Profit Margin (%)': 'gross_profit_margin',
                    'Net Profit Margin (%)': 'net_profit_margin'
                }
                additional_metrics = {
                    'asset_turnover': safe_get_additional('Asset Turnover'),
                    'inventory_turnover': safe_get_additional('Inventory Turnover'),
                    'fixed_asset_turnover': safe_get_additional('Fixed Asset Turnover'),
                    'current_ratio': safe_get_additional('Current Ratio'),
                    'quick_ratio': safe_get_additional('Quick Ratio'),
                    'cash_ratio': safe_get_additional('Cash Ratio'),
                    'interest_coverage': safe_get_additional('Interest Coverage'),
                    'financial_leverage': safe_get_additional('Financial Leverage'),
                    'eps_from_ratio': safe_get_additional('EPS (VND)'),
                    'bvps_from_ratio': safe_get_additional('BVPS (VND)'),
                    'roe_from_ratio': safe_get_additional('ROE (%)'),
                    'roa_from_ratio': safe_get_additional('ROA (%)'),
                    'pe_ratio_from_ratio': safe_get_additional('P/E'),
                    'pb_ratio_from_ratio': safe_get_additional('P/B'),
                    'ps_ratio_from_ratio': safe_get_additional('P/S'),
                    'ev_ebitda_from_ratio': safe_get_additional('EV/EBITDA'),
                    'debt_to_equity_from_ratio': safe_get_additional('Debt/Equity'),
                    'market_cap_from_ratio': safe_get_additional('Market Capital (Bn. VND)'),
                    'gross_profit_margin': safe_get_additional('Gross Profit Margin (%)'),
                    'net_profit_margin': safe_get_additional('Net Profit Margin (%)'),
                    'ebit_margin': safe_get_additional('EBIT Margin (%)')
                }
                # Update financial_data with additional ratios
                for key, value in additional_metrics.items():
                    if pd.notna(value):
                        financial_data[key] = value
                # Force EPS and BVPS to use YEAR data (override any quarter data)
                if pd.notna(financial_data.get('eps_from_ratio')):
                    financial_data['eps'] = financial_data['eps_from_ratio']
                    financial_data['earnings_per_share'] = financial_data['eps_from_ratio']
                    logger.info(f"FORCED EPS to year data: {financial_data['eps']}")
                if pd.notna(financial_data.get('bvps_from_ratio')):
                    financial_data['bvps'] = financial_data['bvps_from_ratio']
                    financial_data['book_value_per_share'] = financial_data['bvps_from_ratio']
                    logger.info(f"FORCED BVPS to year data: {financial_data['bvps']}")
                if pd.notna(financial_data.get('financial_leverage')):
                    financial_data['equity_multiplier'] = financial_data['financial_leverage']
                    logger.info(f"Set equity_multiplier from financial_leverage: {financial_data['equity_multiplier']}")
                if pd.notna(financial_data.get('ev_ebitda')):
                    financial_data['ev_ebitda_from_ratio'] = financial_data['ev_ebitda']
                    logger.info(f"Set ev_ebitda_from_ratio: {financial_data['ev_ebitda']}")
                # Convert percentage ratios to proper format
                if pd.notna(financial_data.get('roe_from_ratio')):
                    financial_data['roe'] = financial_data['roe_from_ratio'] * 100
                if pd.notna(financial_data.get('roa_from_ratio')):
                    financial_data['roa'] = financial_data['roa_from_ratio'] * 100
                # Log margin values correctly
                if pd.notna(financial_data.get('gross_profit_margin')):
                    logger.info(f"Set gross_profit_margin: {financial_data['gross_profit_margin']}%")
                if pd.notna(financial_data.get('net_profit_margin')):
                    logger.info(f"Set net_profit_margin: {financial_data['net_profit_margin']}%")
                if pd.notna(financial_data.get('ebit_margin')):
                    logger.info(f"Set ebit_margin: {financial_data['ebit_margin']}%")
                logger.info(f"Successfully extracted VCI data for {symbol}")
                return financial_data
            except Exception as e:
                logger.error(f"Could not get ratio data for {symbol}: {e}")
                return financial_data
        except Exception as e:
            logger.warning(f"VCI data extraction failed for {symbol}: {e}")
            return {}

    def _get_market_price_vci(self, stock, symbol: str) -> float:
        try:
            price_board_df = stock.trading.price_board([symbol])
            if not price_board_df.empty:
                logger.debug("✓ VCI price board data retrieved successfully")
                logger.debug(f"Available columns: {list(price_board_df.columns)}")
                price_fields = [
                    ('match', 'match_price'),
                    ('listing', 'ref_price'),
                    ('bid_ask', 'bid_1_price'),
                    ('match', 'close_price'),
                    ('match', 'last_price')
                ]
                for field in price_fields:
                    if field in price_board_df.columns:
                        price_val = price_board_df[field].iloc[0]
                        if pd.notna(price_val) and price_val > 0:
                            logger.info(f"✓ Found market price using {field}: {price_val:,.0f} VND")
                            return float(price_val)
                logger.debug("⚠️ No valid price found in prioritized multi-index fields")
            else:
                logger.debug("❌ VCI price board returned empty DataFrame")
        except Exception as e:
            logger.debug(f"❌ VCI price_board failed: {e}")
        try:
            from vnstock.explorer.vci import Trading
            trading = Trading(symbol)
            price_board_df = trading.price_board([symbol])
            if not price_board_df.empty:
                logger.debug("✓ Trading class price board retrieved successfully")
                price_fields = [
                    ('match', 'match_price'),
                    ('listing', 'ref_price'),
                    ('bid_ask', 'bid_1_price'),
                    ('match', 'close_price'),
                    ('match', 'last_price')
                ]
                for field in price_fields:
                    if field in price_board_df.columns:
                        price_val = price_board_df[field].iloc[0]
                        if pd.notna(price_val) and price_val > 0:
                            logger.info(f"✓ Found market price using Trading class {field}: {price_val:,.0f} VND")
                            return float(price_val)
                logger.debug("⚠️ No valid price found in Trading class")
            else:
                logger.debug("❌ Trading class price board returned empty")
        except Exception as e:
            logger.debug(f"❌ Trading class fallback failed: {e}")
        logger.warning(f"Could not retrieve market price for {symbol}")
        return np.nan

provider = StockDataProvider()

@app.route("/api/stock/<symbol>")
def api_stock(symbol):
    try:
        period = request.args.get("period", "year")
        data = provider.get_stock_data(symbol, period)
        def convert_nan_to_none(obj):
            if isinstance(obj, dict):
                return {k: convert_nan_to_none(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_nan_to_none(v) for v in obj]
            elif pd.isna(obj):
                return None
            else:
                return obj
        clean_data = convert_nan_to_none(data)
        return jsonify(clean_data)
    except Exception as exc:
        logger.error(f"API /stock error {symbol}: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500

@app.route("/api/app-data/<symbol>")
def api_app(symbol):
    try:
        period = request.args.get("period", "year")
        data = provider.get_stock_data(symbol, period)
        if period == "quarter":
            yearly_data = provider.get_stock_data(symbol, "year")
            if yearly_data.get("success"):
                display_fields = [
                    "revenue_ttm", "net_income_ttm", "ebitda", "roe", "roa",
                    "debt_to_equity", "eps", "earnings_per_share"
                ]
                for field in display_fields:
                    if field in yearly_data:
                        data[field] = yearly_data[field]
        if data.get("success"):
            shp = data.get("shares_outstanding", np.nan)
            total_assets = data.get("total_assets", np.nan)
            total_liabilities = data.get("total_debt", np.nan)
            net_income = data.get("net_income_ttm", np.nan)
            current_price = data.get("current_price", np.nan)
            equity = (
                total_assets - total_liabilities
                if pd.notna(total_assets) and pd.notna(total_liabilities)
                else np.nan
            )
            if pd.isna(data.get("earnings_per_share", np.nan)):
                data["earnings_per_share"] = (
                    net_income / shp
                    if pd.notna(net_income) and pd.notna(shp) and shp > 0
                    else data.get("eps", np.nan)
                )
            else:
                data["earnings_per_share"] = data.get("eps", np.nan)
            if pd.isna(data.get("book_value_per_share", np.nan)):
                data["book_value_per_share"] = (
                    equity / shp
                    if pd.notna(equity) and pd.notna(shp) and shp > 0
                    else data.get("bvps", np.nan)
                )
            else:
                data["book_value_per_share"] = data.get("bvps", np.nan)
            data["dividend_per_share"] = data.get("dividend_per_share", np.nan)
            if pd.isna(data.get("roe", np.nan)):
                data["roe"] = (
                    (net_income / equity) * 100
                    if pd.notna(net_income) and pd.notna(equity) and equity != 0
                    else np.nan
                )
            if pd.isna(data.get("roa", np.nan)):
                data["roa"] = (
                    (net_income / total_assets) * 100
                    if pd.notna(net_income) and pd.notna(total_assets) and total_assets != 0
                    else np.nan
                )
            if pd.isna(data.get("debt_to_equity", np.nan)):
                data["debt_to_equity"] = (
                    total_liabilities / equity
                    if pd.notna(total_liabilities) and pd.notna(equity) and equity != 0
                    else np.nan
                )
            if pd.isna(data.get("pe_ratio", np.nan)) and pd.notna(data.get("earnings_per_share")) and data["earnings_per_share"] > 0:
                data["pe_ratio"] = current_price / data["earnings_per_share"]
            if pd.isna(data.get("pb_ratio", np.nan)) and pd.notna(data.get("book_value_per_share")) and data["book_value_per_share"] > 0:
                data["pb_ratio"] = current_price / data["book_value_per_share"]
            # Format margin values as percentages with two decimal places
            margin_fields = ["ebit_margin", "gross_profit_margin", "net_profit_margin"]
            for field in margin_fields:
                if field in data and pd.notna(data[field]):
                    data[field] = round(float(data[field]), 2)
            data["data_quality"] = {
                "has_real_price": pd.notna(current_price),
                "has_financials": pd.notna(net_income),
                "pe_reliable": pd.notna(data.get("pe_ratio")),
                "pb_reliable": pd.notna(data.get("pb_ratio")),
                "vci_data": data.get("data_source") == "VCI"
            }
        def convert_nan_to_none(obj):
            if isinstance(obj, dict):
                return {k: convert_nan_to_none(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_nan_to_none(v) for v in obj]
            elif pd.isna(obj):
                return None
            else:
                return obj
        clean_data = convert_nan_to_none(data)
        return jsonify(clean_data)
    except Exception as exc:
        logger.error(f"API /app-data error {symbol}: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500

@app.route("/api/valuation/<symbol>", methods=['POST'])
def calculate_valuation(symbol):
    try:
        logger.info(f"Calculating valuation for {symbol}")
        request_data = request.get_json() or {}
        assumptions = {
            'short_term_growth': request_data.get('revenueGrowth', 5.0) / 100,
            'terminal_growth': request_data.get('terminalGrowth', 2.0) / 100,
            'wacc': request_data.get('wacc', 10.0) / 100,
            'cost_of_equity': request_data.get('requiredReturn', 12.0) / 100,
            'tax_rate': request_data.get('taxRate', 20.0) / 100,
            'forecast_years': request_data.get('projectionYears', 5),
            'roe': request_data.get('roe', 15.0) / 100,
            'payout_ratio': request_data.get('payoutRatio', 40.0) / 100,
            'data_frequency': 'year',
            'model_weights': {
                'fcfe': request_data.get('modelWeights', {}).get('fcfe', 25) / 100,
                'fcff': request_data.get('modelWeights', {}).get('fcff', 25) / 100,
                'justified_pe': request_data.get('modelWeights', {}).get('justified_pe', 25) / 100,
                'justified_pb': request_data.get('modelWeights', {}).get('justified_pb', 25) / 100
            }
        }
        logger.info(f"Using assumptions: {assumptions}")
        valuation_model = ValuationModels(stock_symbol=symbol.upper())
        results = valuation_model.calculate_all_models(assumptions)
        financial_data = {}
        try:
            vnstock_instance = valuation_model.vnstock_instance
            stock = vnstock_instance.stock(symbol=symbol.upper(), source='VCI')
            shares_outstanding = valuation_model.get_shares_outstanding()
            income_data = stock.finance.income_statement(period='year', dropna=False)
            balance_data = stock.finance.balance_sheet(period='year', dropna=False)
            if not income_data.empty and not balance_data.empty:
                net_income = valuation_model.find_financial_value(income_data, ['Net Profit For the Year'], False)
                equity = valuation_model.find_financial_value(balance_data, ['OWNER\'S EQUITY(Bn.VND)'], False)
                eps = net_income / shares_outstanding if shares_outstanding > 0 else 0
                bvps = equity / shares_outstanding if shares_outstanding > 0 else 0
                financial_data = {
                    'eps': float(eps),
                    'bvps': float(bvps),
                    'net_income': float(net_income),
                    'equity': float(equity),
                    'shares_outstanding': float(shares_outstanding)
                }
        except Exception as e:
            logger.warning(f"Could not get financial data for {symbol}: {e}")
            financial_data = {
                'eps': 0,
                'bvps': 0,
                'net_income': 0,
                'equity': 0,
                'shares_outstanding': 0
            }
        formatted_results = {
            'symbol': symbol.upper(),
            'valuations': {
                'fcfe': float(results.get('fcfe', 0)) if results.get('fcfe') else 0,
                'fcff': float(results.get('fcff', 0)) if results.get('fcff') else 0,
                'justified_pe': float(results.get('justified_pe', 0)) if results.get('justified_pe') else 0,
                'justified_pb': float(results.get('justified_pb', 0)) if results.get('justified_pb') else 0,
                'weighted_average': float(results.get('weighted_average', 0)) if results.get('weighted_average') else 0
            },
            'financial_data': financial_data,
            'summary': results.get('summary', {}),
            'assumptions_used': assumptions,
            'success': True,
            'timestamp': datetime.now().isoformat()
        }
        try:
            provider = StockDataProvider()
            stock_data = provider.get_stock_data(symbol.upper())
            if stock_data.get('success') and stock_data.get('current_price'):
                current_price = stock_data['current_price']
                avg_valuation = formatted_results['valuations']['weighted_average']
                if avg_valuation > 0:
                    upside_downside = ((avg_valuation - current_price) / current_price) * 100
                    formatted_results['market_comparison'] = {
                        'current_price': current_price,
                        'average_valuation': avg_valuation,
                        'upside_downside_pct': upside_downside,
                        'recommendation': 'BUY' if upside_downside > 10 else 'HOLD' if upside_downside > -10 else 'SELL'
                    }
        except Exception as e:
            logger.warning(f"Could not get market comparison for {symbol}: {e}")
        logger.info(f"Valuation calculation completed for {symbol}")
        return jsonify(formatted_results)
    except Exception as exc:
        logger.error(f"Valuation calculation error for {symbol}: {exc}")
        return jsonify({
            "success": False,
            "error": str(exc),
            "symbol": symbol.upper()
        }), 500

@app.route("/health")
def health():
    return jsonify({"status": "healthy", "vnstock_available": True})

@app.route("/api/historical-chart-data/<symbol>")
def get_historical_chart_data(symbol):
    try:
        logger.info(f"Fetching historical chart data for {symbol}")
        stock = provider.vnstock.stock(symbol=symbol, source='VCI')
        ratio_quarter = stock.finance.ratio(period='quarter', lang='en', dropna=True)
        if ratio_quarter.empty:
            return jsonify({
                "success": False,
                "error": "No historical data available",
                "data": {}
            })
        ratio_quarter[('Meta', 'yearReport')] = ratio_quarter[('Meta', 'yearReport')].astype(int)
        ratio_quarter[('Meta', 'lengthReport')] = ratio_quarter[('Meta', 'lengthReport')].astype(int)
        ratio_quarter = ratio_quarter.sort_values([('Meta', 'yearReport'), ('Meta', 'lengthReport')], ascending=[True, True])
        last_20_quarters = ratio_quarter.tail(20)
        historical_data = {
            "years": [],
            "roe_data": [],
            "roa_data": [],
            "current_ratio_data": [],
            "quick_ratio_data": [],
            "cash_ratio_data": []
        }
        for index, row in last_20_quarters.iterrows():
            year = row[('Meta', 'yearReport')]
            quarter = row[('Meta', 'lengthReport')]
            period_label = f"{year} Q{quarter}"
            roe = row.get(('Chỉ tiêu khả năng sinh lợi', 'ROE (%)'), np.nan)
            roa = row.get(('Chỉ tiêu khả năng sinh lợi', 'ROA (%)'), np.nan)
            current_ratio = row.get(('Chỉ tiêu thanh khoản', 'Current Ratio'), np.nan)
            quick_ratio = row.get(('Chỉ tiêu thanh khoản', 'Quick Ratio'), np.nan)
            cash_ratio = row.get(('Chỉ tiêu thanh khoản', 'Cash Ratio'), np.nan)
            roe_val = float(roe * 100) if pd.notna(roe) else 0
            roa_val = float(roa * 100) if pd.notna(roa) else 0
            current_ratio_val = float(current_ratio) if pd.notna(current_ratio) else 0
            quick_ratio_val = float(quick_ratio) if pd.notna(quick_ratio) else 0
            cash_ratio_val = float(cash_ratio) if pd.notna(cash_ratio) else 0
            historical_data["years"].append(period_label)
            historical_data["roe_data"].append(roe_val)
            historical_data["roa_data"].append(roa_val)
            historical_data["current_ratio_data"].append(current_ratio_val)
            historical_data["quick_ratio_data"].append(quick_ratio_val)
            historical_data["cash_ratio_data"].append(cash_ratio_val)
        logger.info(f"Successfully retrieved {len(historical_data['years'])} periods of historical data for {symbol}")
        return jsonify({
            "success": True,
            "symbol": symbol,
            "data": historical_data
        })
    except Exception as e:
        logger.error(f"Error fetching historical chart data for {symbol}: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "data": {}
        }), 500

if __name__ == "__main__":
    print("Vietnamese Stock Valuation Backend – running on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)