import warnings
warnings.filterwarnings("ignore", message="pkg_resources is deprecated as an API.*", category=UserWarning)

import pandas as pd
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging
import time
from datetime import datetime, timedelta
from vnstock import Vnstock
from vnstock.explorer.vci import Company
from valuation_models import ValuationModels
import json
import os

app = Flask(__name__)
CORS(app)

# Chart data cache - stores chart data to avoid repeated API calls
chart_cache = {}
CHART_CACHE_DURATION = 3600  # Cache for 1 hour (in seconds)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

class StockDataProvider:
    def __init__(self):
        self.sources = ["VCI"]
        self.vnstock = Vnstock()  # Keep for valuation calculations that still need it
        self._all_symbols = None
        self._industry_mapping = None
        self._stock_data_cache = None  # Cache for the stock data file
        self._industry_data_folder = 'industry_data'
        self._industry_data_cache = {}
        self._load_stock_data()
        self._load_csv_data()
        logger.info("StockDataProvider initialized with file-based data loading")

    def _load_stock_data(self):
        """Load all stock data from JSON file"""
        try:
            if os.path.exists(self._data_file):
                with open(self._data_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._stock_data_cache = data.get('stocks', {})
                    metadata = data.get('metadata', {})
                    logger.info(f"Loaded stock data for {metadata.get('total_symbols', 0)} symbols from {self._data_file}")
                    logger.info(f"Data last updated: {metadata.get('last_updated', 'Unknown')}")
                    
                    # Extract symbols list from cached data
                    self._all_symbols = list(self._stock_data_cache.keys())
                    
                    # Extract industry mapping from cached data
                    self._industry_mapping = {}
                    for symbol, data in self._stock_data_cache.items():
                        if 'sector' in data:
                            self._industry_mapping[symbol] = data['sector']
                    
                    return True
            else:
                logger.warning(f"Stock data file {self._data_file} not found. Run fetch_all_stock_data.py first!")
                self._stock_data_cache = {}
                return False
        except Exception as e:
            logger.error(f"Failed to load stock data from file: {e}")
            self._stock_data_cache = {}
            return False

    def _load_csv_data(self):
        """Load CSV data for symbol to industry mapping"""
        try:
            self.csv_df = pd.read_csv('top10_industries.csv')
            logger.info(f"Loaded CSV data with {len(self.csv_df)} rows")
        except Exception as e:
            logger.error(f"Failed to load CSV data: {e}")
            self.csv_df = pd.DataFrame()

    def _get_industry_json_filename(self, industry: str) -> str:
        """Get the JSON filename for a given industry"""
        # The filenames might have different encoding or special characters
        # Try to find exact match first, then fall back to listing directory
        exact_filename = f"stock_data_{industry}.json"
        
        # Check if exact filename exists
        exact_filepath = os.path.join(self._industry_data_folder, exact_filename)
        if os.path.exists(exact_filepath):
            return exact_filename
        
        # If not found, try to find by searching directory
        try:
            if os.path.exists(self._industry_data_folder):
                for filename in os.listdir(self._industry_data_folder):
                    if filename.startswith("stock_data_") and filename.endswith(".json"):
                        # Extract industry name from filename
                        industry_from_file = filename[11:-5]  # Remove "stock_data_" and ".json"
                        if industry_from_file == industry or industry_from_file.strip() == industry.strip():
                            return filename
        except Exception as e:
            logger.warning(f"Error searching for industry file: {e}")
        
        # Return the exact filename even if not found (for logging purposes)
        return exact_filename

    def _normalize_industry_name(self, industry: str) -> str:
        """Convert Vietnamese industry name to filename format"""
        # Mapping for common Vietnamese characters to ASCII
        vietnamese_map = {
            'á': 'a', 'à': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
            'ă': 'a', 'ắ': 'a', 'ằ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
            'â': 'a', 'ấ': 'a', 'ầ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
            'đ': 'd',
            'é': 'e', 'è': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
            'ê': 'e', 'ế': 'e', 'ề': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
            'í': 'i', 'ì': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
            'ó': 'o', 'ò': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
            'ô': 'o', 'ố': 'o', 'ồ': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
            'ơ': 'o', 'ớ': 'o', 'ờ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
            'ú': 'u', 'ù': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
            'ư': 'u', 'ứ': 'u', 'ừ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
            'ý': 'y', 'ỳ': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
        }
        
        # Convert to lowercase and replace diacritics
        normalized = industry.lower()
        for viet_char, ascii_char in vietnamese_map.items():
            normalized = normalized.replace(viet_char, ascii_char)
        
        # Replace spaces and special characters with underscores
        normalized = normalized.replace(' ', '_').replace('&', '').replace('-', '_')
        
        # Clean up multiple underscores
        while '__' in normalized:
            normalized = normalized.replace('__', '_')
        
        # Capitalize first letter of each word
        parts = normalized.split('_')
        normalized = '_'.join([part.capitalize() for part in parts if part])
        
        return normalized

    def _load_industry_data(self, industry: str) -> dict:
        """Load data for a specific industry from JSON file"""
        if industry in self._industry_data_cache:
            return self._industry_data_cache[industry]
        
        try:
            # Try different approaches to find the file
            found_filename = None
            
            # Method 1: Try normalized industry name
            normalized_industry = self._normalize_industry_name(industry)
            normalized_filename = f"stock_data_{normalized_industry}.json"
            normalized_filepath = os.path.join(self._industry_data_folder, normalized_filename)
            if os.path.exists(normalized_filepath):
                found_filename = normalized_filename
            else:
                # Method 2: Exact filename match
                exact_filename = f"stock_data_{industry}.json"
                exact_filepath = os.path.join(self._industry_data_folder, exact_filename)
                if os.path.exists(exact_filepath):
                    found_filename = exact_filename
                else:
                    # Method 3: Search through directory files
                    if os.path.exists(self._industry_data_folder):
                        for filename in os.listdir(self._industry_data_folder):
                            if filename.startswith("stock_data_") and filename.endswith(".json"):
                                # Extract industry name from filename
                                industry_from_file = filename[11:-5]  # Remove "stock_data_" and ".json"
                                # Try different matching approaches
                                if (industry_from_file == industry or 
                                    industry_from_file.strip() == industry.strip() or
                                    industry_from_file.replace(' ', '_') == industry.replace(' ', '_') or
                                    industry_from_file == normalized_industry):
                                    found_filename = filename
                                    break
            
            if found_filename:
                filepath = os.path.join(self._industry_data_folder, found_filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._industry_data_cache[industry] = data
                    logger.info(f"Loaded industry data for {industry} from {found_filename}")
                    return data
            else:
                logger.warning(f"Industry data file not found for: {industry}")
                return {}
                
        except Exception as e:
            logger.error(f"Failed to load industry data for {industry}: {e}")
            return {}

    def _get_symbol_from_industry_data(self, symbol: str, industry: str) -> dict:
        """Get symbol data from industry-specific JSON file"""
        industry_data = self._load_industry_data(industry)
        
        # Check if industry_data has the correct structure with 'stocks' key
        if 'stocks' in industry_data:
            stocks_data = industry_data['stocks']
            
            if symbol.upper() in stocks_data:
                return stocks_data[symbol.upper()]
            
            # Try with exact case
            if symbol in stocks_data:
                return stocks_data[symbol]
            
            # Try searching case-insensitive
            for key, value in stocks_data.items():
                if key.upper() == symbol.upper():
                    return value
        else:
            # Fallback to old structure (direct symbol keys)
            if symbol.upper() in industry_data:
                return industry_data[symbol.upper()]
            
            # Try with exact case
            if symbol in industry_data:
                return industry_data[symbol]
            
            # Try searching case-insensitive
            for key, value in industry_data.items():
                if key.upper() == symbol.upper():
                    return value
        
        return {}

    def _get_quarter_data_from_vnstock(self, symbol: str) -> dict:
        """Get latest quarter data from vnstock API"""
        try:
            stock = self.vnstock.stock(symbol=symbol, source="VCI")
            
            # Get financial statements
            quarter_data = {}
            
            # Get balance sheet
            try:
                balance_sheet = stock.finance.balance_sheet(period='quarter', lang='en', dropna=True)
                if balance_sheet.empty:
                    balance_sheet = stock.finance.balance_sheet(period='quarter', lang='vn', dropna=True)
                if not balance_sheet.empty:
                    # Sort to get latest quarter
                    if 'yearReport' in balance_sheet.columns and 'lengthReport' in balance_sheet.columns:
                        balance_sheet['yearReport'] = pd.to_numeric(balance_sheet['yearReport'], errors='coerce').fillna(0).astype(int)
                        balance_sheet['lengthReport'] = pd.to_numeric(balance_sheet['lengthReport'], errors='coerce').fillna(0).astype(int)
                        balance_sheet = balance_sheet.sort_values(['yearReport', 'lengthReport'], ascending=[False, False])
                    latest_bs = balance_sheet.iloc[0]
                    quarter_data['balance_sheet'] = latest_bs
            except Exception as e:
                logger.warning(f"Failed to get quarter balance sheet for {symbol}: {e}")
            
            # Get income statement
            try:
                income_statement = stock.finance.income_statement(period='quarter', lang='en', dropna=True)
                if income_statement.empty:
                    income_statement = stock.finance.income_statement(period='quarter', lang='vn', dropna=True)
                if not income_statement.empty:
                    # Sort to get latest quarter
                    if 'yearReport' in income_statement.columns and 'lengthReport' in income_statement.columns:
                        income_statement['yearReport'] = pd.to_numeric(income_statement['yearReport'], errors='coerce').fillna(0).astype(int)
                        income_statement['lengthReport'] = pd.to_numeric(income_statement['lengthReport'], errors='coerce').fillna(0).astype(int)
                        income_statement = income_statement.sort_values(['yearReport', 'lengthReport'], ascending=[False, False])
                    latest_is = income_statement.iloc[0]
                    quarter_data['income_statement'] = latest_is
            except Exception as e:
                logger.warning(f"Failed to get quarter income statement for {symbol}: {e}")
            
            # Get cash flow
            try:
                cash_flow = stock.finance.cash_flow(period='quarter', lang='en', dropna=True)
                if cash_flow.empty:
                    cash_flow = stock.finance.cash_flow(period='quarter', lang='vn', dropna=True)
                if not cash_flow.empty:
                    # Sort to get latest quarter
                    if 'yearReport' in cash_flow.columns and 'lengthReport' in cash_flow.columns:
                        cash_flow['yearReport'] = pd.to_numeric(cash_flow['yearReport'], errors='coerce').fillna(0).astype(int)
                        cash_flow['lengthReport'] = pd.to_numeric(cash_flow['lengthReport'], errors='coerce').fillna(0).astype(int)
                        cash_flow = cash_flow.sort_values(['yearReport', 'lengthReport'], ascending=[False, False])
                    latest_cf = cash_flow.iloc[0]
                    quarter_data['cash_flow'] = latest_cf
            except Exception as e:
                logger.warning(f"Failed to get quarter cash flow for {symbol}: {e}")
            
            # Get ratios
            try:
                ratio_quarter = stock.finance.ratio(period='quarter', lang='en', dropna=True)
                if ratio_quarter.empty:
                    ratio_quarter = stock.finance.ratio(period='quarter', lang='vn', dropna=True)
                if not ratio_quarter.empty:
                    # Sort to get latest quarter
                    if ('Meta', 'yearReport') in ratio_quarter.columns and ('Meta', 'lengthReport') in ratio_quarter.columns:
                        ratio_quarter[('Meta', 'yearReport')] = pd.to_numeric(ratio_quarter[('Meta', 'yearReport')], errors='coerce').fillna(0).astype(int)
                        ratio_quarter[('Meta', 'lengthReport')] = pd.to_numeric(ratio_quarter[('Meta', 'lengthReport')], errors='coerce').fillna(0).astype(int)
                        ratio_quarter = ratio_quarter.sort_values([('Meta', 'yearReport'), ('Meta', 'lengthReport')], ascending=[False, False])
                    latest_ratio = ratio_quarter.iloc[0]
                    quarter_data['ratios'] = latest_ratio
            except Exception as e:
                logger.warning(f"Failed to get quarter ratios for {symbol}: {e}")

            # Get company overview for shares outstanding
            try:
                overview = stock.company.overview()
                if not overview.empty:
                    quarter_data['overview'] = overview.iloc[0]
            except Exception as e:
                logger.warning(f"Failed to get company overview for {symbol}: {e}")
            
            return quarter_data
            
        except Exception as e:
            logger.error(f"Failed to get quarter data for {symbol}: {e}")
            return {}

    def _load_industry_mapping(self):
        """Load industry mapping from CSV data"""
        if self._industry_mapping is not None:
            return self._industry_mapping
        
        try:
            if hasattr(self, 'csv_df') and not self.csv_df.empty:
                self._industry_mapping = dict(zip(self.csv_df['ticker'].str.upper(), self.csv_df['industry']))
                logger.info(f"Loaded industry mapping from CSV for {len(self._industry_mapping)} symbols")
                return self._industry_mapping
            else:
                # Fallback to loading CSV if not already loaded
                df = pd.read_csv('top10_industries.csv')
                self._industry_mapping = dict(zip(df['ticker'].str.upper(), df['industry']))
                logger.info(f"Loaded industry mapping from CSV for {len(self._industry_mapping)} symbols")
                return self._industry_mapping
        except Exception as e:
            logger.warning(f"Failed to load industry mapping from CSV: {e}")
            self._industry_mapping = {}
            return self._industry_mapping

    def _get_industry_for_symbol(self, symbol: str) -> str:
        mapping = self._load_industry_mapping()
        return mapping.get(symbol.upper(), "Unknown")

    def _get_organ_name_for_symbol(self, symbol: str) -> str:
        # Try to get from cached data first
        if self._stock_data_cache and symbol.upper() in self._stock_data_cache:
            cached_data = self._stock_data_cache[symbol.upper()]
            if 'name' in cached_data and cached_data['name'] != symbol.upper():
                return cached_data['name']
        
        # Fallback to CSV
        try:
            df = pd.read_csv('top10_industries.csv')
            row = df[df['symbol'].str.upper() == symbol.upper()]
            if not row.empty and 'organ_name' in row.columns:
                return str(row.iloc[0]['organ_name'])
        except Exception as e:
            logger.warning(f"Failed to get organ_name for {symbol}: {e}")
        return symbol

    def _get_all_symbols(self, symbols_override=None):
        """Get all symbols - now from cached data or override list"""
        if symbols_override is not None:
            return [s.upper() for s in symbols_override]
        if self._all_symbols is not None:
            return self._all_symbols
        if self._stock_data_cache:
            self._all_symbols = list(self._stock_data_cache.keys())
            logger.info(f"Loaded {len(self._all_symbols)} symbols from cached data")
            return self._all_symbols
        # Fallback to live API if no cached data
        logger.warning("No cached data available, falling back to live API for symbols")
        try:
            stock = self.vnstock.stock(symbol="ACB", source="VCI")
            symbols_df = stock.listing.all_symbols()
            self._all_symbols = symbols_df["symbol"].str.upper().values
            logger.info(f"Loaded {len(self._all_symbols)} symbols from live API")
            return self._all_symbols
        except Exception as e:
            logger.warning(f"Failed to get symbols list from API: {e}")
            self._all_symbols = []
            return self._all_symbols

    def validate_symbol(self, symbol: str, symbols_override=None) -> bool:
        symbols = self._get_all_symbols(symbols_override)
        if symbols is None or len(symbols) == 0:
            logger.warning(f"Cannot validate symbol {symbol} - symbols list unavailable")
            return True
        return symbol.upper() in symbols

    def _get_company_info_from_csv(self, symbol: str) -> dict:
        """Get company info (organ_name, industry, exchange) from CSV for a symbol"""
        try:
            if hasattr(self, 'csv_df') and not self.csv_df.empty:
                df = self.csv_df
            else:
                df = pd.read_csv('top10_industries.csv')
            
            row = df[df['ticker'].str.upper() == symbol.upper()]
            if not row.empty:
                organ_name = str(row.iloc[0]['organ_name']) if 'organ_name' in row.columns else symbol.upper()
                industry = str(row.iloc[0]['industry']) if 'industry' in row.columns else "Unknown"
                exchange = str(row.iloc[0]['exchange']) if 'exchange' in row.columns else "Unknown"
                return {
                    'organ_name': organ_name,
                    'industry': industry,
                    'exchange': exchange
                }
        except Exception as e:
            logger.warning(f"Failed to get company info from CSV for {symbol}: {e}")
        return {
            'organ_name': symbol.upper(),
            'industry': "Unknown",
            'exchange': "Unknown"
        }

    def get_stock_data(self, symbol: str, period: str = "year", fetch_current_price: bool = False, symbols_override=None) -> dict:
        """Get stock data from CSV->Industry JSON files for annual data, or vnstock for quarter data"""
        symbol = symbol.upper()
        
        if not self.validate_symbol(symbol, symbols_override):
            raise ValueError(f"Symbol {symbol} is not valid.")
        
        # Get company info from CSV
        company_info = self._get_company_info_from_csv(symbol)
        industry = company_info['industry']
        
        if period == "quarter":
            # For quarter data, fetch latest from vnstock
            logger.info(f"Getting latest quarter data for {symbol} from vnstock")
            quarter_data = self._get_quarter_data_from_vnstock(symbol)
            
            if quarter_data:
                # Process quarter data into the expected format
                processed_data = self._process_quarter_data(quarter_data, symbol, company_info)
                
                # Fetch current price if requested
                if fetch_current_price:
                    current_price = self.get_current_price(symbol)
                    if current_price:
                        processed_data['current_price'] = current_price
                        processed_data['price_last_updated'] = datetime.now().isoformat()
                        
                        # Calculate market cap only if not already set from vnstock ratios
                        shares = processed_data.get('shares_outstanding')
                        if pd.notna(shares) and shares > 0 and not processed_data.get('market_cap'):
                            processed_data['market_cap'] = current_price * shares
                
                processed_data.update({
                    "symbol": symbol,
                    "name": company_info['organ_name'],
                    "sector": company_info['industry'],
                    "exchange": company_info['exchange'],
                    "data_period": period,
                    "success": True
                })
                
                return processed_data
            else:
                # Fallback to annual data if quarter data fails
                logger.warning(f"Failed to get quarter data for {symbol}, falling back to annual data")
                period = "year"
        
        # For annual data, get from industry JSON files
        if industry != "Unknown":
            logger.info(f"Getting annual data for {symbol} from industry file: {industry}")
            industry_symbol_data = self._get_symbol_from_industry_data(symbol, industry)
            
            if industry_symbol_data:
                # Fetch current price if requested
                if fetch_current_price:
                    current_price = self.get_current_price(symbol)
                    if current_price:
                        industry_symbol_data['current_price'] = current_price
                        industry_symbol_data['price_last_updated'] = datetime.now().isoformat()
                        
                        # Calculate market cap only if not already set from vnstock ratios
                        shares = industry_symbol_data.get('shares_outstanding')
                        if pd.notna(shares) and shares > 0 and not industry_symbol_data.get('market_cap'):
                            industry_symbol_data['market_cap'] = current_price * shares
                
                # Calculate missing ratios from available data
                industry_symbol_data = self.calculate_missing_ratios(industry_symbol_data)
                
                industry_symbol_data.update({
                    "symbol": symbol,
                    "name": company_info['organ_name'],
                    "sector": company_info['industry'],
                    "exchange": company_info['exchange'],
                    "data_period": period,
                    "success": True
                })
                
                return industry_symbol_data
        
        # Fallback to cached data if available
        if self._stock_data_cache and symbol in self._stock_data_cache:
            logger.info(f"Getting cached data for {symbol}")
            cached_data = self._stock_data_cache[symbol].copy()
            
            # Fetch current price if requested
            if fetch_current_price:
                current_price = self.get_current_price(symbol)
                if current_price:
                    cached_data['current_price'] = current_price
                    cached_data['price_last_updated'] = datetime.now().isoformat()
                    
                    # Calculate market cap only if not already set from vnstock ratios
                    shares = cached_data.get('shares_outstanding')
                    if pd.notna(shares) and shares > 0 and not cached_data.get('market_cap'):
                        cached_data['market_cap'] = current_price * shares
            
            # Calculate missing ratios from available data
            cached_data = self.calculate_missing_ratios(cached_data)
            
            cached_data.update({
                "symbol": symbol,
                "name": company_info['organ_name'],
                "sector": company_info['industry'],
                "exchange": company_info['exchange'],
                "data_period": period,
                "success": True
            })
            
            return cached_data
        
        # Final fallback to live API
        logger.warning(f"Symbol {symbol} not found in industry data or cache, falling back to live API")
        return self._get_live_stock_data(symbol, period)

    def _process_quarter_data(self, quarter_data: dict, symbol: str, company_info: dict) -> dict:
        """Process quarter data from vnstock into the expected format"""
        processed = {
            "symbol": symbol,
            "name": company_info['organ_name'],
            "sector": company_info['industry'],
            "exchange": company_info['exchange'],
            "data_source": "VCI_Quarter",
            "success": True
        }
        
        try:
            # From balance sheet - using exact column names from debug
            if 'balance_sheet' in quarter_data:
                bs = quarter_data['balance_sheet']
                
                # Total assets - exact match from debug output
                if 'TOTAL ASSETS (Bn. VND)' in bs.index:
                    processed['total_assets'] = float(bs['TOTAL ASSETS (Bn. VND)'])
                
                # Owner's equity - exact match from debug output  
                if "OWNER'S EQUITY(Bn.VND)" in bs.index:
                    processed['total_equity'] = float(bs["OWNER'S EQUITY(Bn.VND)"])
                
                # Total liabilities
                if 'TOTAL LIABILITIES (Bn. VND)' in bs.index:
                    processed['total_liabilities'] = float(bs['TOTAL LIABILITIES (Bn. VND)'])
                    processed['total_debt'] = processed['total_liabilities']  # Often used interchangeably
                elif 'total_assets' in processed and 'total_equity' in processed:
                    # Calculate total debt if we have both total assets and equity
                    processed['total_debt'] = processed['total_assets'] - processed['total_equity']
                    processed['total_liabilities'] = processed['total_debt']
                
                # Current assets
                if 'Current assets (Bn. VND)' in bs.index:
                    processed['current_assets'] = float(bs['Current assets (Bn. VND)'])
                elif 'CURRENT ASSETS (Bn. VND)' in bs.index:
                    processed['current_assets'] = float(bs['CURRENT ASSETS (Bn. VND)'])
                
                # Current liabilities  
                if 'Current liabilities (Bn. VND)' in bs.index:
                    processed['current_liabilities'] = float(bs['Current liabilities (Bn. VND)'])
                elif 'CURRENT LIABILITIES (Bn. VND)' in bs.index:
                    processed['current_liabilities'] = float(bs['CURRENT LIABILITIES (Bn. VND)'])
                
                # Cash and cash equivalents
                cash_fields = [
                    'Cash and cash equivalents (Bn. VND)',
                    'CASH AND CASH EQUIVALENTS (Bn. VND)', 
                    'Cash (Bn. VND)',
                    'CASH (Bn. VND)'
                ]
                for field in cash_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['cash'] = float(bs[field])
                        break
                
                # Short-term investments
                if 'Short-term investments (Bn. VND)' in bs.index:
                    processed['short_term_investments'] = float(bs['Short-term investments (Bn. VND)'])
                
                # Inventory
                inventory_fields = [
                    'Inventory (Bn. VND)',
                    'INVENTORY (Bn. VND)',
                    'Inventories (Bn. VND)',
                    'INVENTORIES (Bn. VND)'
                ]
                for field in inventory_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['inventory'] = float(bs[field])
                        break
                
                # Accounts receivable
                receivable_fields = [
                    'Accounts receivable (Bn. VND)',
                    'ACCOUNTS RECEIVABLE (Bn. VND)',
                    'Trade receivables (Bn. VND)',
                    'TRADE RECEIVABLES (Bn. VND)'
                ]
                for field in receivable_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['accounts_receivable'] = float(bs[field])
                        break
                
                # Fixed assets / Property, Plant & Equipment
                fixed_asset_fields = [
                    'Property, plant and equipment (Bn. VND)',
                    'PROPERTY, PLANT AND EQUIPMENT (Bn. VND)',
                    'Fixed assets (Bn. VND)',
                    'FIXED ASSETS (Bn. VND)',
                    'PPE (Bn. VND)'
                ]
                for field in fixed_asset_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['fixed_assets'] = float(bs[field])
                        processed['ppe'] = float(bs[field])  # Alias
                        break
                
                # Working capital calculation
                if 'current_assets' in processed and 'current_liabilities' in processed:
                    processed['working_capital'] = processed['current_assets'] - processed['current_liabilities']
            
            # From income statement - Enhanced extraction
            if 'income_statement' in quarter_data:
                is_data = quarter_data['income_statement']
                
                # Revenue and other income statement items - prioritize absolute values over percentages
                for key in is_data.index:
                    key_str = str(key).upper()
                    value = is_data[key]
                    
                    # Skip if value is not numeric or is NaN
                    if not pd.notna(value):
                        continue
                    try:
                        value = float(value)
                    except (ValueError, TypeError):
                        continue
                    
                    # Revenue - prioritize absolute revenue over YoY percentages
                    if ('REVENUE' in key_str or 'DOANH THU' in key_str) and 'YOY' not in key_str and '%' not in key_str and 'GROWTH' not in key_str:
                        processed['revenue'] = value
                        processed['revenue_ttm'] = value * 4  # Approximate TTM
                    elif ('NET SALES' in key_str or 'SALES' in key_str) and 'DEDUCTION' not in key_str and 'YOY' not in key_str and '%' not in key_str and 'revenue' not in processed:
                        # Use net sales as backup if no revenue found
                        processed['revenue'] = value
                        processed['revenue_ttm'] = value * 4  # Approximate TTM
                    
                    # Net Income/Profit
                    elif ('NET INCOME' in key_str or 'NET PROFIT' in key_str or 'LỢI NHUẬN RÒNG' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['net_income'] = value
                        processed['net_income_ttm'] = value * 4  # Approximate TTM
                    
                    # Gross Profit
                    elif ('GROSS PROFIT' in key_str or 'LÃI GỘP' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['gross_profit'] = value
                    
                    # Operating Income/EBIT
                    elif ('OPERATING INCOME' in key_str or 'OPERATING PROFIT' in key_str or 'EBIT' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebit'] = value
                        processed['operating_income'] = value  # Alias
                    
                    # EBITDA
                    elif 'EBITDA' in key_str and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebitda'] = value
                    
                    # EBITDA Margin (for reference)
                    elif 'EBITDA MARGIN' in key_str:
                        if pd.notna(value):
                            processed['ebitda_margin'] = float(value) * 100 if abs(float(value)) < 1 else float(value)
                    
                    # Interest Expense
                    elif 'INTEREST EXPENSE' in key_str or 'FINANCIAL EXPENSE' in key_str:
                        processed['interest_expense'] = value
                    
                    # Cost of Goods Sold
                    elif ('COST OF GOODS SOLD' in key_str or 'COGS' in key_str or 'GIÁ VỐN' in key_str) and '%' not in key_str:
                        processed['cost_of_goods_sold'] = value
                        processed['cogs'] = value  # Alias
                    
                    # Selling, General & Administrative expenses
                    elif ('SG&A' in key_str or 'SELLING' in key_str or 'ADMINISTRATIVE' in key_str) and 'EXPENSE' in key_str and '%' not in key_str:
                        if 'sga_expenses' not in processed:
                            processed['sga_expenses'] = value
                        else:
                            processed['sga_expenses'] += value
                    
                    # Depreciation and Amortization
                    elif ('DEPRECIATION' in key_str or 'AMORTIZATION' in key_str) and '%' not in key_str:
                        processed['depreciation'] = value
                        # Calculate EBITDA if we have EBIT and depreciation
                        if 'ebit' in processed and pd.notna(processed['ebit']):
                            processed['ebitda'] = processed['ebit'] + value
                    
                    # Try to calculate EBITDA from EBIT + Depreciation if available
                    elif 'EBITDA' in key_str and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebitda'] = value
                    
                    # Operating expenses (to help calculate operating income)
                    elif ('OPERATING EXPENSE' in key_str or 'OPERATING COST' in key_str) and '%' not in key_str:
                        processed['operating_expenses'] = value
                    
                    # Tax expense
                    elif ('TAX EXPENSE' in key_str or 'INCOME TAX' in key_str or 'CORPORATE TAX' in key_str) and '%' not in key_str:
                        processed['tax_expense'] = value
            
            # From ratios - using exact structure from debug
            if 'ratios' in quarter_data:
                ratios = quarter_data['ratios']
                
                # === PROFITABILITY RATIOS ===
                # ROE from exact path
                if ('Chỉ tiêu khả năng sinh lợi', 'ROE (%)') in ratios.index:
                    roe_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROE (%)')]
                    if pd.notna(roe_value):
                        # Convert to percentage if needed
                        processed['roe'] = float(roe_value) * 100 if abs(float(roe_value)) < 1 else float(roe_value)
                
                # ROA from exact path
                if ('Chỉ tiêu khả năng sinh lợi', 'ROA (%)') in ratios.index:
                    roa_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROA (%)')]
                    if pd.notna(roa_value):
                        # Convert to percentage if needed
                        processed['roa'] = float(roa_value) * 100 if abs(float(roa_value)) < 1 else float(roa_value)
                
                # ROIC
                if ('Chỉ tiêu khả năng sinh lợi', 'ROIC (%)') in ratios.index:
                    roic_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROIC (%)')]
                    if pd.notna(roic_value):
                        # Convert to percentage if needed
                        processed['roic'] = float(roic_value) * 100 if abs(float(roic_value)) < 1 else float(roic_value)
                
                # Net Profit Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Net Profit Margin (%)') in ratios.index:
                    npm_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Net Profit Margin (%)')]
                    if pd.notna(npm_value):
                        # Convert to percentage if needed
                        processed['net_margin'] = float(npm_value) * 100 if abs(float(npm_value)) < 1 else float(npm_value)
                        processed['net_profit_margin'] = processed['net_margin']  # Alias
                
                # Gross Profit Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Gross Profit Margin (%)') in ratios.index:
                    gpm_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Gross Profit Margin (%)')]
                    if pd.notna(gpm_value):
                        # Convert to percentage if needed
                        processed['gross_margin'] = float(gpm_value) * 100 if abs(float(gpm_value)) < 1 else float(gpm_value)
                        processed['gross_profit_margin'] = processed['gross_margin']  # Alias
                
                # EBIT Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'EBIT Margin (%)') in ratios.index:
                    ebit_margin_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'EBIT Margin (%)')]
                    if pd.notna(ebit_margin_value):
                        processed['ebit_margin'] = float(ebit_margin_value) * 100 if abs(float(ebit_margin_value)) < 1 else float(ebit_margin_value)
                
                # === VALUATION RATIOS ===
                # P/E ratio from exact path
                if ('Chỉ tiêu định giá', 'P/E') in ratios.index:
                    pe_value = ratios[('Chỉ tiêu định giá', 'P/E')]
                    if pd.notna(pe_value):
                        processed['pe_ratio'] = float(pe_value)
                
                # P/B ratio from exact path
                if ('Chỉ tiêu định giá', 'P/B') in ratios.index:
                    pb_value = ratios[('Chỉ tiêu định giá', 'P/B')]
                    if pd.notna(pb_value):
                        processed['pb_ratio'] = float(pb_value)
                
                # P/S ratio
                if ('Chỉ tiêu định giá', 'P/S') in ratios.index:
                    ps_value = ratios[('Chỉ tiêu định giá', 'P/S')]
                    if pd.notna(ps_value):
                        processed['ps_ratio'] = float(ps_value)
                
                # P/CF ratio
                if ('Chỉ tiêu định giá', 'P/CF') in ratios.index:
                    pcf_value = ratios[('Chỉ tiêu định giá', 'P/CF')]
                    if pd.notna(pcf_value):
                        processed['pcf_ratio'] = float(pcf_value)
                elif ('Chỉ tiêu định giá', 'P/Cash Flow') in ratios.index:
                    pcf_value = ratios[('Chỉ tiêu định giá', 'P/Cash Flow')]
                    if pd.notna(pcf_value):
                        processed['pcf_ratio'] = float(pcf_value)
                
                # EV/EBITDA
                if ('Chỉ tiêu định giá', 'EV/EBITDA') in ratios.index:
                    ev_ebitda_value = ratios[('Chỉ tiêu định giá', 'EV/EBITDA')]
                    if pd.notna(ev_ebitda_value):
                        processed['ev_ebitda'] = float(ev_ebitda_value)
                
                # EBITDA (absolute value)
                if ('Chỉ tiêu khả năng sinh lợi', 'EBITDA (Bn. VND)') in ratios.index:
                    ebitda_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'EBITDA (Bn. VND)')]
                    if pd.notna(ebitda_value):
                        processed['ebitda'] = float(ebitda_value)
                
                # Outstanding shares from exact path
                if ('Chỉ tiêu định giá', 'Outstanding Share (Mil. Shares)') in ratios.index:
                    shares_value = ratios[('Chỉ tiêu định giá', 'Outstanding Share (Mil. Shares)')]
                    if pd.notna(shares_value):
                        processed['shares_outstanding'] = float(shares_value) * 1000000  # Convert from millions
                elif ('Chỉ tiêu định giá', 'Outstanding Shares (Mil. Shares)') in ratios.index:
                    shares_value = ratios[('Chỉ tiêu định giá', 'Outstanding Shares (Mil. Shares)')]
                    if pd.notna(shares_value):
                        processed['shares_outstanding'] = float(shares_value) * 1000000  # Convert from millions
                
                # Market cap from exact path
                if ('Chỉ tiêu định giá', 'Market Capital (Bn. VND)') in ratios.index:
                    market_cap_value = ratios[('Chỉ tiêu định giá', 'Market Capital (Bn. VND)')]
                    if pd.notna(market_cap_value):
                        processed['market_cap'] = float(market_cap_value)
                
                # EPS from exact path
                if ('Chỉ tiêu định giá', 'EPS (VND)') in ratios.index:
                    eps_value = ratios[('Chỉ tiêu định giá', 'EPS (VND)')]
                    if pd.notna(eps_value):
                        processed['eps'] = float(eps_value)
                        processed['eps_ttm'] = float(eps_value)  # For quarter data, treat as TTM
                
                # BVPS (Book Value Per Share) from exact path
                if ('Chỉ tiêu định giá', 'BVPS (VND)') in ratios.index:
                    bvps_value = ratios[('Chỉ tiêu định giá', 'BVPS (VND)')]
                    if pd.notna(bvps_value):
                        processed['book_value_per_share'] = float(bvps_value)
                        processed['bvps'] = float(bvps_value)  # Alias
                
                # === LEVERAGE RATIOS ===
                # Debt/Equity ratio
                if ('Chỉ tiêu cơ cấu nguồn vốn', 'Debt/Equity') in ratios.index:
                    de_value = ratios[('Chỉ tiêu cơ cấu nguồn vốn', 'Debt/Equity')]
                    if pd.notna(de_value):
                        processed['debt_to_equity'] = float(de_value)
                
                # Financial Leverage (can be used as equity multiplier)
                if ('Chỉ tiêu thanh khoản', 'Financial Leverage') in ratios.index:
                    fl_value = ratios[('Chỉ tiêu thanh khoản', 'Financial Leverage')]
                    if pd.notna(fl_value):
                        processed['financial_leverage'] = float(fl_value)
                        processed['equity_multiplier'] = float(fl_value)
                
                # === LIQUIDITY RATIOS ===
                # Current Ratio
                if ('Chỉ tiêu thanh khoản', 'Current Ratio') in ratios.index:
                    cr_value = ratios[('Chỉ tiêu thanh khoản', 'Current Ratio')]
                    if pd.notna(cr_value):
                        processed['current_ratio'] = float(cr_value)
                
                # Quick Ratio
                if ('Chỉ tiêu thanh khoản', 'Quick Ratio') in ratios.index:
                    qr_value = ratios[('Chỉ tiêu thanh khoản', 'Quick Ratio')]
                    if pd.notna(qr_value):
                        processed['quick_ratio'] = float(qr_value)
                
                # Cash Ratio
                if ('Chỉ tiêu thanh khoản', 'Cash Ratio') in ratios.index:
                    cash_ratio_value = ratios[('Chỉ tiêu thanh khoản', 'Cash Ratio')]
                    if pd.notna(cash_ratio_value):
                        processed['cash_ratio'] = float(cash_ratio_value)
                
                # === ACTIVITY/TURNOVER RATIOS ===
                # Asset Turnover
                if ('Chỉ tiêu hoạt động', 'Asset Turnover') in ratios.index:
                    at_value = ratios[('Chỉ tiêu hoạt động', 'Asset Turnover')]
                    if pd.notna(at_value):
                        processed['asset_turnover'] = float(at_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Asset Turnover') in ratios.index:
                    at_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Asset Turnover')]
                    if pd.notna(at_value):
                        processed['asset_turnover'] = float(at_value)
                
                # Inventory Turnover
                if ('Chỉ tiêu hoạt động', 'Inventory Turnover') in ratios.index:
                    it_value = ratios[('Chỉ tiêu hoạt động', 'Inventory Turnover')]
                    if pd.notna(it_value):
                        processed['inventory_turnover'] = float(it_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Inventory Turnover') in ratios.index:
                    it_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Inventory Turnover')]
                    if pd.notna(it_value):
                        processed['inventory_turnover'] = float(it_value)
                
                # Receivables Turnover
                if ('Chỉ tiêu hoạt động', 'Receivables Turnover') in ratios.index:
                    rt_value = ratios[('Chỉ tiêu hoạt động', 'Receivables Turnover')]
                    if pd.notna(rt_value):
                        processed['receivables_turnover'] = float(rt_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Receivables Turnover') in ratios.index:
                    rt_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Receivables Turnover')]
                    if pd.notna(rt_value):
                        processed['receivables_turnover'] = float(rt_value)
                
                # Fixed Asset Turnover
                if ('Chỉ tiêu hoạt động', 'Fixed Asset Turnover') in ratios.index:
                    fat_value = ratios[('Chỉ tiêu hoạt động', 'Fixed Asset Turnover')]
                    if pd.notna(fat_value):
                        processed['fixed_asset_turnover'] = float(fat_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Fixed Asset Turnover') in ratios.index:
                    fat_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Fixed Asset Turnover')]
                    if pd.notna(fat_value):
                        processed['fixed_asset_turnover'] = float(fat_value)
                
                # Working Capital Turnover
                if ('Chỉ tiêu hoạt động', 'Working Capital Turnover') in ratios.index:
                    wct_value = ratios[('Chỉ tiêu hoạt động', 'Working Capital Turnover')]
                    if pd.notna(wct_value):
                        processed['working_capital_turnover'] = float(wct_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Working Capital Turnover') in ratios.index:
                    wct_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Working Capital Turnover')]
                    if pd.notna(wct_value):
                        processed['working_capital_turnover'] = float(wct_value)
                
                # === COVERAGE RATIOS ===
                # Interest Coverage Ratio
                if ('Chỉ tiêu thanh khoản', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu thanh khoản', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                elif ('Chỉ tiêu khả năng thanh toán', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu khả năng thanh toán', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                elif ('Chỉ tiêu thanh toán', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu thanh toán', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                
                # === DIVIDEND RATIOS ===
                # Dividend Yield
                if ('Chỉ tiêu định giá', 'Dividend Yield (%)') in ratios.index:
                    dy_value = ratios[('Chỉ tiêu định giá', 'Dividend Yield (%)')]
                    if pd.notna(dy_value):
                        processed['dividend_yield'] = float(dy_value) * 100 if abs(float(dy_value)) < 1 else float(dy_value)
                
                # Dividend per Share
                if ('Chỉ tiêu định giá', 'DPS (VND)') in ratios.index:
                    dps_value = ratios[('Chỉ tiêu định giá', 'DPS (VND)')]
                    if pd.notna(dps_value):
                        processed['dividend_per_share'] = float(dps_value)
                
                # Payout Ratio
                if ('Chỉ tiêu định giá', 'Payout Ratio (%)') in ratios.index:
                    pr_value = ratios[('Chỉ tiêu định giá', 'Payout Ratio (%)')]
                    if pd.notna(pr_value):
                        processed['payout_ratio'] = float(pr_value) * 100 if abs(float(pr_value)) < 1 else float(pr_value)
                
                # === ADDITIONAL METRICS ===
                # Revenue Growth (if available)
                if ('Chỉ tiêu tăng trưởng', 'Revenue Growth (%)') in ratios.index:
                    rg_value = ratios[('Chỉ tiêu tăng trưởng', 'Revenue Growth (%)')]
                    if pd.notna(rg_value):
                        processed['revenue_growth'] = float(rg_value) * 100 if abs(float(rg_value)) < 1 else float(rg_value)
                elif ('Chỉ tiêu tăng trưởng', 'Doanh thu tăng trưởng (%)') in ratios.index:
                    rg_value = ratios[('Chỉ tiêu tăng trưởng', 'Doanh thu tăng trưởng (%)')]
                    if pd.notna(rg_value):
                        processed['revenue_growth'] = float(rg_value) * 100 if abs(float(rg_value)) < 1 else float(rg_value)
                
                # Earnings Growth
                if ('Chỉ tiêu tăng trưởng', 'Earnings Growth (%)') in ratios.index:
                    eg_value = ratios[('Chỉ tiêu tăng trưởng', 'Earnings Growth (%)')]
                    if pd.notna(eg_value):
                        processed['earnings_growth'] = float(eg_value) * 100 if abs(float(eg_value)) < 1 else float(eg_value)
                
                # Net margin alternative names
                if 'net_margin' not in processed:
                    net_margin_fields = [
                        ('Chỉ tiêu khả năng sinh lợi', 'Net Margin (%)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'Biên lợi nhuận ròng (%)'),
                        ('Chỉ tiêu hiệu quả', 'Net Profit Margin (%)')
                    ]
                    for field in net_margin_fields:
                        if field in ratios.index:
                            nm_value = ratios[field]
                            if pd.notna(nm_value):
                                processed['net_margin'] = float(nm_value) * 100 if abs(float(nm_value)) < 1 else float(nm_value)
                                processed['net_profit_margin'] = processed['net_margin']
                                break
                
                # Operating margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Operating Margin (%)') in ratios.index:
                    om_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Operating Margin (%)')]
                    if pd.notna(om_value):
                        processed['operating_margin'] = float(om_value) * 100 if abs(float(om_value)) < 1 else float(om_value)
                
                # === ALTERNATIVE RATIO NAMES FOR BACKUP ===
                # Alternative PE ratio names
                if 'pe_ratio' not in processed:
                    pe_fields = [
                        ('Chỉ tiêu định giá', 'P/E Ratio'),
                        ('Chỉ tiêu định giá', 'PE'),
                        ('Định giá', 'P/E')
                    ]
                    for field in pe_fields:
                        if field in ratios.index:
                            pe_value = ratios[field]
                            if pd.notna(pe_value):
                                processed['pe_ratio'] = float(pe_value)
                                break
                
                # Alternative PB ratio names  
                if 'pb_ratio' not in processed:
                    pb_fields = [
                        ('Chỉ tiêu định giá', 'P/B Ratio'),
                        ('Chỉ tiêu định giá', 'PB'),
                        ('Định giá', 'P/B')
                    ]
                    for field in pb_fields:
                        if field in ratios.index:
                            pb_value = ratios[field]
                            if pd.notna(pb_value):
                                processed['pb_ratio'] = float(pb_value)
                                break
            
            # From cash flow statement - Enhanced extraction
            if 'cash_flow' in quarter_data:
                cf_data = quarter_data['cash_flow']
                
                for key in cf_data.index:
                    key_str = str(key).upper()
                    value = cf_data[key]
                    
                    # Skip if value is not numeric or is NaN
                    if not pd.notna(value):
                        continue
                    try:
                        value = float(value)
                    except (ValueError, TypeError):
                        continue
                    
                    # Operating Cash Flow - Enhanced detection
                    if ('OPERATING CASH FLOW' in key_str or 
                        'CASH FROM OPERATIONS' in key_str or 
                        'CASH FROM OPERATING ACTIVITIES' in key_str or
                        'NET CASH FROM OPERATING ACTIVITIES' in key_str or
                        'NET OPERATING CASH FLOW' in key_str or
                        'OPERATING ACTIVITIES' in key_str or
                        'OPERATING PROFIT BEFORE CHANGES' in key_str):
                        processed['operating_cash_flow'] = value
                        processed['cash_from_operations'] = value  # Alias
                    
                    # Capital Expenditures
                    elif ('CAPITAL EXPENDITURE' in key_str or 
                          'CAPEX' in key_str or
                          'PURCHASE OF PROPERTY' in key_str or
                          'INVESTMENTS IN FIXED ASSETS' in key_str or
                          'PURCHASE OF PPE' in key_str):
                        processed['capex'] = abs(value)  # Usually negative, make positive
                        processed['capital_expenditure'] = abs(value)  # Alias
                    
                    # Free Cash Flow (if directly available)
                    elif 'FREE CASH FLOW' in key_str:
                        processed['free_cash_flow'] = value
                        processed['fcf'] = value  # Alias
                    
                    # Cash from Investing Activities
                    elif ('CASH FROM INVESTING' in key_str or 
                          'NET CASH FROM INVESTING' in key_str or
                          'INVESTING CASH FLOW' in key_str):
                        processed['cash_from_investing'] = value
                    
                    # Cash from Financing Activities
                    elif ('CASH FROM FINANCING' in key_str or 
                          'NET CASH FROM FINANCING' in key_str or
                          'FINANCING CASH FLOW' in key_str):
                        processed['cash_from_financing'] = value
                    
                    # Dividends Paid
                    elif ('DIVIDEND' in key_str and 'PAID' in key_str) or 'CASH DIVIDEND' in key_str:
                        processed['dividends_paid'] = abs(value)  # Usually negative, make positive
                    
                    # Share Repurchases
                    elif ('SHARE REPURCHASE' in key_str or 
                          'STOCK REPURCHASE' in key_str or
                          'TREASURY STOCK' in key_str):
                        processed['share_repurchases'] = abs(value)
                    
                    # Debt Issued/Repaid
                    elif 'DEBT ISSUE' in key_str or 'BORROW' in key_str:
                        processed['debt_issued'] = value
                    elif 'DEBT REPAY' in key_str or 'DEBT PAYMENT' in key_str:
                        processed['debt_repaid'] = abs(value)
                
                # Calculate Free Cash Flow if not directly available
                if 'free_cash_flow' not in processed:
                    ocf = processed.get('operating_cash_flow')
                    capex = processed.get('capex', 0)
                    if pd.notna(ocf):
                        processed['free_cash_flow'] = ocf - capex
                        processed['fcf'] = processed['free_cash_flow']  # Alias
                
                # Calculate FCFE (Free Cash Flow to Equity)
                fcf = processed.get('free_cash_flow')
                debt_issued = processed.get('debt_issued', 0)
                debt_repaid = processed.get('debt_repaid', 0)
                if pd.notna(fcf):
                    net_debt_change = debt_issued - debt_repaid
                    processed['fcfe'] = fcf + net_debt_change
            
            # From company overview - get additional info if available
            if 'overview' in quarter_data:
                overview = quarter_data['overview']
                
                # Issue shares (alternative source for shares outstanding) - only if not already set from ratios
                # Skip this entirely if we have ratios data, as it's more reliable
                if 'issue_share' in overview.index and not processed.get('shares_outstanding'):
                    shares_value = overview['issue_share']
                    if pd.notna(shares_value):
                        # Check if the value seems reasonable (not in trillions)
                        shares_float = float(shares_value)
                        if shares_float > 1e12:  # If larger than 1 trillion, likely in wrong unit
                            shares_float = shares_float / 1000  # Convert from thousands to actual shares
                        processed['shares_outstanding'] = shares_float
                
                # Charter capital
                if 'charter_capital' in overview.index:
                    charter_capital = overview['charter_capital']
                    if pd.notna(charter_capital):
                        processed['charter_capital'] = float(charter_capital)
        
        except Exception as e:
            logger.warning(f"Error processing quarter data for {symbol}: {e}")
        
        # Post-processing: Validate and fix shares outstanding
        if 'shares_outstanding' in processed:
            shares = processed['shares_outstanding']
            # If shares outstanding seems too large (> 1 trillion), it's likely in wrong unit
            if shares > 1e12:
                processed['shares_outstanding'] = shares / 1000
        
        # Ensure we have all key financial ratios and metrics
        self._ensure_quarter_data_completeness(processed)
        
        # Calculate missing ratios from available data
        processed = self.calculate_missing_ratios(processed)
        
        return processed

    def _ensure_quarter_data_completeness(self, processed: dict):
        """Ensure quarter data has all necessary fields for consistency with annual data"""
        
        # Add earnings per share calculation if missing
        if 'eps' not in processed and 'net_income' in processed and 'shares_outstanding' in processed:
            if pd.notna(processed['net_income']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                # For quarterly EPS, multiply by 4 to annualize
                processed['eps'] = (processed['net_income'] * 4) / processed['shares_outstanding']
                processed['eps_ttm'] = processed['eps']
        
        # Add book value per share if missing
        if 'book_value_per_share' not in processed and 'bvps' not in processed:
            if 'total_equity' in processed and 'shares_outstanding' in processed:
                if pd.notna(processed['total_equity']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                    bvps = processed['total_equity'] / processed['shares_outstanding']
                    processed['book_value_per_share'] = bvps
                    processed['bvps'] = bvps
        
        # Add dividend yield if missing but we have other dividend data
        if 'dividend_yield' not in processed and 'dividend_per_share' in processed and 'current_price' in processed:
            if pd.notna(processed['dividend_per_share']) and pd.notna(processed['current_price']) and processed['current_price'] > 0:
                processed['dividend_yield'] = (processed['dividend_per_share'] / processed['current_price']) * 100
        
        # Add price-to-cash-flow ratio if missing
        if 'pcf_ratio' not in processed and 'operating_cash_flow' in processed and 'shares_outstanding' in processed and 'current_price' in processed:
            if all(pd.notna(processed[key]) for key in ['operating_cash_flow', 'shares_outstanding', 'current_price']):
                if processed['shares_outstanding'] > 0 and processed['operating_cash_flow'] != 0:
                    cash_flow_per_share = (processed['operating_cash_flow'] * 4) / processed['shares_outstanding']  # Annualize
                    if cash_flow_per_share > 0:
                        processed['pcf_ratio'] = processed['current_price'] / cash_flow_per_share
        
        # Alternative P/CF calculation using quarterly data without annualizing if we don't have current price
        elif 'pcf_ratio' not in processed and 'operating_cash_flow' in processed and 'shares_outstanding' in processed:
            if pd.notna(processed['operating_cash_flow']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                # Try to get current price from fetch if available
                current_price = processed.get('current_price')
                if current_price and pd.notna(current_price):
                    cash_flow_per_share = (processed['operating_cash_flow'] * 4) / processed['shares_outstanding']
                    if cash_flow_per_share > 0:
                        processed['pcf_ratio'] = current_price / cash_flow_per_share
        
        # Add interest coverage ratio if missing
        if 'interest_coverage' not in processed and 'ebit' in processed and 'interest_expense' in processed:
            if pd.notna(processed['ebit']) and pd.notna(processed['interest_expense']) and processed['interest_expense'] != 0:
                # Interest expense is usually negative, so we take absolute value for the calculation
                interest_expense_abs = abs(processed['interest_expense'])
                processed['interest_coverage'] = processed['ebit'] / interest_expense_abs
        
        # Add EBITDA if missing but we have EBIT and depreciation
        if 'ebitda' not in processed and 'ebit' in processed and 'depreciation' in processed:
            if pd.notna(processed['ebit']) and pd.notna(processed['depreciation']):
                processed['ebitda'] = processed['ebit'] + processed['depreciation']
        
        # If we still don't have EBITDA, try to estimate it from other data
        elif 'ebitda' not in processed and 'net_income' in processed and 'interest_expense' in processed and 'tax_expense' in processed and 'depreciation' in processed:
            # EBITDA = Net Income + Interest + Tax + Depreciation + Amortization
            components = [processed.get(key, 0) for key in ['net_income', 'tax_expense', 'depreciation']]
            interest_abs = abs(processed.get('interest_expense', 0))
            if all(pd.notna(x) for x in components) and pd.notna(interest_abs):
                processed['ebitda'] = sum(components) + interest_abs
        
        # Add enterprise value if missing
        if 'enterprise_value' not in processed and 'market_cap' in processed:
            market_cap = processed['market_cap']
            cash = processed.get('cash', 0)
            total_debt = processed.get('total_debt', 0)
            if pd.notna(market_cap):
                ev = market_cap + total_debt - cash
                processed['enterprise_value'] = ev
        
        # Add EV/EBITDA alternative calculation if missing
        if 'ev_ebitda' not in processed and 'enterprise_value' in processed and 'ebitda' in processed:
            if pd.notna(processed['enterprise_value']) and pd.notna(processed['ebitda']) and processed['ebitda'] > 0:
                processed['ev_ebitda'] = processed['enterprise_value'] / (processed['ebitda'] * 4)  # Annualize EBITDA
        
        # Add working capital if not calculated
        if 'working_capital' not in processed and 'current_assets' in processed and 'current_liabilities' in processed:
            if pd.notna(processed['current_assets']) and pd.notna(processed['current_liabilities']):
                processed['working_capital'] = processed['current_assets'] - processed['current_liabilities']
        
        # Add net debt if missing
        if 'net_debt' not in processed and 'total_debt' in processed and 'cash' in processed:
            if pd.notna(processed['total_debt']) and pd.notna(processed['cash']):
                processed['net_debt'] = processed['total_debt'] - processed['cash']
        
        # Ensure we have TTM versions of key metrics
        for base_metric in ['revenue', 'net_income', 'ebit', 'ebitda']:
            ttm_key = f"{base_metric}_ttm"
            if ttm_key not in processed and base_metric in processed:
                if pd.notna(processed[base_metric]):
                    processed[ttm_key] = processed[base_metric] * 4  # Annualize quarterly data
        
        # Add data quality indicators
        processed['data_quality'] = {
            'has_financials': any(key in processed for key in ['revenue', 'net_income', 'total_assets']),
            'has_real_price': 'current_price' in processed and pd.notna(processed.get('current_price')),
            'pe_reliable': 'pe_ratio' in processed and pd.notna(processed.get('pe_ratio')),
            'pb_reliable': 'pb_ratio' in processed and pd.notna(processed.get('pb_ratio')),
            'vci_data': True  # Quarter data always comes from VCI
        }

    def _get_live_stock_data(self, symbol: str, period: str = "year") -> dict:
        """Fallback method using live API - same as original implementation"""
        logger.info(f"Attempting to get live data from VCI for {symbol}")
        vci_data = self._get_vci_data(symbol, period)
        if vci_data and vci_data.get('success'):
            # Use company info from CSV if available
            company_info = self._get_company_info_from_csv(symbol)
            vci_data.update({
                "symbol": symbol,
                "name": company_info['organ_name'],
                "exchange": company_info['exchange'],
                "sector": company_info['industry'],
                "data_period": period,
                "price_change": np.nan
            })
            try:
                stock = self.vnstock.stock(symbol=symbol, source="VCI")
                current_price = self._get_market_price_vci(stock, symbol)
                if pd.notna(current_price):
                    vci_data["current_price"] = current_price
            except Exception as e:
                pass
            if pd.notna(vci_data.get("current_price")) and pd.notna(vci_data.get("shares_outstanding")):
                vci_data["market_cap"] = vci_data["current_price"] * vci_data["shares_outstanding"]
            return vci_data
        
        logger.warning(f"VCI comprehensive data failed, trying basic VCI fallback for {symbol}")
        try:
            stock = self.vnstock.stock(symbol=symbol, source="VCI")
            company = self._get_company_overview(stock, symbol)
            financials = self._get_financial_statements(stock, period)
            market = self._get_price_data(stock, company["shares_outstanding"], symbol)
            # Use organ_name from CSV if available
            organ_name = self._get_organ_name_for_symbol(symbol)
            company["name"] = organ_name
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

    def reload_data(self):
        """Reload stock data from file - useful for updating without restarting server"""
        logger.info("Reloading stock data from file...")
        success = self._load_stock_data()
        if success:
            logger.info("Stock data reloaded successfully")
        else:
            logger.error("Failed to reload stock data")
        return success

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
                    pass
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
            # Only pick EBITDA directly, do not calculate from components
            return _pick(income_df, ["EBITDA", "ebitda", "EBITDA (Bn. VND)"])

        if is_quarter:
            # Lấy giá trị quý gần nhất cho revenue và net income
            net_income_latest = _pick(income, ["Net Profit For the Year", "Net income", "net_income", "netIncome", "profit", "Attributable to parent company"])
            revenue_latest = _pick(income, ["Revenue (Bn. VND)", "Revenue", "revenue", "netRevenue", "totalRevenue"])
            # Các chỉ số rolling 4 quý (TTM) nếu cần
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
                "revenue_ttm": revenue_latest if pd.notna(revenue_latest) else np.nan,
                "net_income_ttm": net_income_latest if pd.notna(net_income_latest) else np.nan,
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
            net_income = _pick(income, ["Lợi nhuận sau thuế", "Net income", "net_income", "netIncome", "profit", "Net Profit For the Year", "Attributable to parent company"])
            revenue = _pick(income, ["Doanh thu thuần", "Revenue", "revenue", "netRevenue", "totalRevenue", "Revenue (Bn. VND)"])
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
            pass
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

    def _get_vci_data(self, symbol: str, period: str) -> dict:
        try:
            company = Company(symbol)
            ratio_data = company.ratio_summary().T # This fetches summary, possibly not period specific
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
                'revenue_ttm': safe_get('revenue', np.nan),
                'net_income_ttm': safe_get('net_profit', np.nan),
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
                'ebitda': safe_get('ebitda', np.nan),
                'ebit': safe_get('ebit', np.nan),
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
                if not stock or not hasattr(stock, 'finance') or stock.finance is None:
                    logger.warning(f"Stock or finance object not available for {symbol}. Cannot fetch ratios.")
                    return financial_data
                
                target_ratios = stock.finance.ratio(period=period, lang='en', dropna=True)
                if target_ratios.empty:
                    target_ratios = stock.finance.ratio(period=period, lang='vn', dropna=True)

                enhanced_ratios = {}
                if not target_ratios.empty:
                    logger.info(f"Successfully retrieved {period} ratio data for {symbol}, shape: {target_ratios.shape}")
                    try:
                        if ('Meta', 'yearReport') in target_ratios.columns and ('Meta', 'lengthReport') in target_ratios.columns:
                            # Ensure pd.to_numeric returns a Series for fillna to work as expected by linter
                            target_ratios[('Meta', 'yearReport')] = pd.Series(pd.to_numeric(target_ratios[('Meta', 'yearReport')], errors='coerce')).fillna(0).astype(int)
                            target_ratios[('Meta', 'lengthReport')] = pd.Series(pd.to_numeric(target_ratios[('Meta', 'lengthReport')], errors='coerce')).fillna(0).astype(int)
                            latest_row_ratios = target_ratios.sort_values([('Meta', 'yearReport'), ('Meta', 'lengthReport')], ascending=[False, False]).head(1)
                        elif 'yearReport' in target_ratios.columns and 'lengthReport' in target_ratios.columns:
                            # Ensure pd.to_numeric returns a Series for fillna to work as expected by linter
                            target_ratios['yearReport'] = pd.Series(pd.to_numeric(target_ratios['yearReport'], errors='coerce')).fillna(0).astype(int)
                            target_ratios['lengthReport'] = pd.Series(pd.to_numeric(target_ratios['lengthReport'], errors='coerce')).fillna(0).astype(int)
                            latest_row_ratios = target_ratios.sort_values(['yearReport', 'lengthReport'], ascending=[False, False]).head(1)
                        else:
                            latest_row_ratios = target_ratios.head(1)

                    except Exception as e:
                        logger.warning(f"Failed to convert year/quarter columns for {symbol} ({period} ratios): {e}")
                        latest_row_ratios = target_ratios.head(1)

                    eps_columns = [
                        ('Chỉ tiêu định giá', 'EPS (VND)'),
                        ('Valuation Metrics', 'EPS (VND)'),
                        ('Metrics', 'EPS'),
                        'EPS (VND)',
                        'EPS'
                    ]
                    bvps_columns = [
                        ('Chỉ tiêu định giá', 'BVPS (VND)'),
                        ('Valuation Metrics', 'BVPS (VND)'),
                        ('Metrics', 'BVPS'),
                        'BVPS (VND)',
                        'BVPS'
                    ]
                    
                    def safe_get_from_row(row_series, candidates):
                        if row_series.empty:
                            return np.nan
                        for col_candidate in candidates:
                            if col_candidate in row_series.index:
                                val = row_series[col_candidate]
                                if pd.notna(val):
                                    try:
                                        return float(val)
                                    except ValueError:
                                        continue
                        return np.nan

                    latest_eps = safe_get_from_row(latest_row_ratios.iloc[0], eps_columns) if not latest_row_ratios.empty else np.nan
                    latest_bvps = safe_get_from_row(latest_row_ratios.iloc[0], bvps_columns) if not latest_row_ratios.empty else np.nan

                    if pd.notna(latest_eps):
                        enhanced_ratios['EPS (VND)'] = latest_eps
                        logger.info(f"Found {period} EPS from ratios: {latest_eps}")
                        # Always override main EPS with period-specific value
                        financial_data['eps'] = latest_eps
                    if pd.notna(latest_bvps):
                        enhanced_ratios['BVPS (VND)'] = latest_bvps
                        logger.info(f"Found {period} BVPS from ratios: {latest_bvps}")

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
                        if metric in latest_row_ratios.columns:
                            value = latest_row_ratios[metric].values[0]
                            if pd.notna(value):
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
                # REMOVED: Force EPS and BVPS to use YEAR data (override any quarter data)
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
                # Override main fields with period-specific ratios if available
                if pd.notna(financial_data.get('eps_from_ratio')):
                    financial_data['eps'] = financial_data['eps_from_ratio']
                    logger.info(f"Override eps with {period} ratio data: {financial_data['eps']}")
                if pd.notna(financial_data.get('pe_ratio_from_ratio')):
                    financial_data['pe_ratio'] = financial_data['pe_ratio_from_ratio']
                    logger.info(f"Override pe_ratio with {period} ratio data: {financial_data['pe_ratio']}")
                if pd.notna(financial_data.get('pb_ratio_from_ratio')):
                    financial_data['pb_ratio'] = financial_data['pb_ratio_from_ratio']
                    logger.info(f"Override pb_ratio with {period} ratio data: {financial_data['pb_ratio']}")
                if pd.notna(financial_data.get('debt_to_equity_from_ratio')):
                    financial_data['debt_to_equity'] = financial_data['debt_to_equity_from_ratio']
                    logger.info(f"Override debt_to_equity with {period} ratio data: {financial_data['debt_to_equity']}")
                # Log margin values correctly
                if pd.notna(financial_data.get('gross_profit_margin')):
                    logger.info(f"Set gross_profit_margin: {financial_data['gross_profit_margin']}%")
                if pd.notna(financial_data.get('net_profit_margin')):
                    logger.info(f"Set net_profit_margin: {financial_data['net_profit_margin']}%")
                if pd.notna(financial_data.get('ebit_margin')):
                    logger.info(f"Set ebit_margin: {financial_data['ebit_margin']}%")
                # Override revenue, net income, and EBITDA with period-specific financial statement data
                try:
                    stock = self.vnstock.stock(symbol=symbol, source='VCI')
                    period_specific_data = self._get_financial_statements(stock, period)
                    
                    # Override key financial metrics with period-specific data if available
                    if pd.notna(period_specific_data.get('revenue_ttm')):
                        financial_data['revenue_ttm'] = period_specific_data['revenue_ttm']
                        logger.info(f"Override revenue_ttm with {period} data: {period_specific_data['revenue_ttm']}")
                    
                    if pd.notna(period_specific_data.get('net_income_ttm')):
                        financial_data['net_income_ttm'] = period_specific_data['net_income_ttm']
                        logger.info(f"Override net_income_ttm with {period} data: {period_specific_data['net_income_ttm']}")
                    
                    if pd.notna(period_specific_data.get('ebitda')):
                        financial_data['ebitda'] = period_specific_data['ebitda']
                        logger.info(f"Override ebitda with {period} data: {period_specific_data['ebitda']}")
                    
                    if pd.notna(period_specific_data.get('ebit')):
                        financial_data['ebit'] = period_specific_data['ebit']
                        logger.info(f"Override ebit with {period} data: {period_specific_data['ebit']}")
                        
                except Exception as e:
                    logger.warning(f"Could not get period-specific financial data for {symbol}: {e}")
                
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
        except Exception as e:
            pass
        try:
            from vnstock.explorer.vci import Trading
            trading = Trading(symbol)
            price_board_df = trading.price_board([symbol])
            if not price_board_df.empty:
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
        except Exception as e:
            pass
        logger.warning(f"Could not retrieve market price for {symbol}")
        return np.nan

    def get_current_price(self, symbol):
        """Get real-time current price for a symbol"""
        try:
            logger.info(f"Fetching current price for {symbol}")
            stock = self.vnstock.stock(symbol=symbol, source='VCI')
            current_price = self._get_market_price_vci(stock, symbol)
            
            if pd.notna(current_price) and current_price > 0:
                # Update the cached data with current price and timestamp
                if self._stock_data_cache and symbol in self._stock_data_cache:
                    self._stock_data_cache[symbol]['current_price'] = current_price
                    self._stock_data_cache[symbol]['price_last_updated'] = datetime.now().isoformat()
                    
                    # Calculate market cap if shares outstanding is available
                    shares = self._stock_data_cache[symbol].get('shares_outstanding')
                    if pd.notna(shares) and shares > 0:
                        self._stock_data_cache[symbol]['market_cap'] = current_price * shares
                
                return current_price
            else:
                logger.warning(f"Could not get valid current price for {symbol}")
                return None
                
        except Exception as e:
            logger.error(f"Error fetching current price for {symbol}: {e}")
            return None

    def calculate_missing_ratios(self, stock_data):
        """Calculate missing financial ratios from available data"""
        try:
            # Get required fields - try both TTM and regular versions
            revenue = stock_data.get('revenue_ttm') or stock_data.get('revenue', 0)
            net_income = stock_data.get('net_income_ttm') or stock_data.get('net_income', 0)
            ebit = stock_data.get('ebit', 0)
            ebitda = stock_data.get('ebitda', 0)
            gross_profit = stock_data.get('gross_profit', 0)
            total_assets = stock_data.get('total_assets', 0)
            total_equity = stock_data.get('total_equity', 0)
            total_debt = stock_data.get('total_debt', 0)
            inventory = stock_data.get('inventory', 0)
            fixed_assets = stock_data.get('fixed_assets') or stock_data.get('ppe', 0)
            cash = stock_data.get('cash') or stock_data.get('cash_and_equivalents', 0)
            current_assets = stock_data.get('current_assets', 0)
            current_liabilities = stock_data.get('current_liabilities', 0)
            accounts_receivable = stock_data.get('accounts_receivable', 0)
            interest_expense = stock_data.get('interest_expense', 0)
            shares_outstanding = stock_data.get('shares_outstanding', 0)
            current_price = stock_data.get('current_price', 0)
            
            # Calculate missing margins if not available
            if not stock_data.get('gross_margin') and revenue > 0 and gross_profit:
                stock_data['gross_margin'] = (gross_profit / revenue) * 100
                
            if not stock_data.get('ebit_margin') and revenue > 0 and ebit:
                stock_data['ebit_margin'] = (ebit / revenue) * 100
                
            if not stock_data.get('net_profit_margin') and revenue > 0 and net_income:
                stock_data['net_profit_margin'] = (net_income / revenue) * 100
                stock_data['net_margin'] = stock_data['net_profit_margin']  # Alias
            
            # Calculate missing profitability ratios
            if not stock_data.get('roa') and total_assets > 0 and net_income:
                stock_data['roa'] = (net_income / total_assets) * 100
                
            if not stock_data.get('roe') and total_equity > 0 and net_income:
                stock_data['roe'] = (net_income / total_equity) * 100
            
            # Calculate missing turnover ratios
            if not stock_data.get('asset_turnover') and total_assets > 0 and revenue > 0:
                stock_data['asset_turnover'] = revenue / total_assets
                
            if not stock_data.get('inventory_turnover') and inventory > 0 and revenue > 0:
                stock_data['inventory_turnover'] = revenue / inventory
                
            if not stock_data.get('fixed_asset_turnover') and fixed_assets > 0 and revenue > 0:
                stock_data['fixed_asset_turnover'] = revenue / fixed_assets
                
            if not stock_data.get('receivables_turnover') and accounts_receivable > 0 and revenue > 0:
                stock_data['receivables_turnover'] = revenue / accounts_receivable
            
            # Calculate missing liquidity ratios
            if not stock_data.get('current_ratio') and current_liabilities > 0 and current_assets > 0:
                stock_data['current_ratio'] = current_assets / current_liabilities
                
            if not stock_data.get('quick_ratio') and current_liabilities > 0:
                quick_assets = current_assets - inventory
                if quick_assets > 0:
                    stock_data['quick_ratio'] = quick_assets / current_liabilities
                    
            if not stock_data.get('cash_ratio') and current_liabilities > 0 and cash > 0:
                stock_data['cash_ratio'] = cash / current_liabilities
            
            # Calculate missing leverage ratios
            if not stock_data.get('debt_to_equity') and total_equity > 0 and total_debt:
                stock_data['debt_to_equity'] = total_debt / total_equity
                
            if not stock_data.get('equity_multiplier') and total_equity > 0 and total_assets > 0:
                stock_data['equity_multiplier'] = total_assets / total_equity
                stock_data['financial_leverage'] = stock_data['equity_multiplier']  # Alias
            
            # Calculate missing valuation ratios
            if shares_outstanding > 0:
                # EPS calculation
                if not stock_data.get('eps') and net_income:
                    stock_data['eps'] = net_income / shares_outstanding
                    stock_data['eps_ttm'] = stock_data['eps']
                
                # Book value per share
                if not stock_data.get('book_value_per_share') and not stock_data.get('bvps') and total_equity > 0:
                    bvps = total_equity / shares_outstanding
                    stock_data['book_value_per_share'] = bvps
                    stock_data['bvps'] = bvps
                
                # Market cap
                if not stock_data.get('market_cap') and current_price > 0:
                    stock_data['market_cap'] = current_price * shares_outstanding
                
                # P/E ratio
                if not stock_data.get('pe_ratio') and current_price > 0:
                    eps = stock_data.get('eps')
                    if eps and eps > 0:
                        stock_data['pe_ratio'] = current_price / eps
                
                # P/B ratio
                if not stock_data.get('pb_ratio') and current_price > 0:
                    bvps = stock_data.get('book_value_per_share') or stock_data.get('bvps')
                    if bvps and bvps > 0:
                        stock_data['pb_ratio'] = current_price / bvps
                
                # P/S ratio
                if not stock_data.get('ps_ratio') and current_price > 0 and revenue > 0:
                    sales_per_share = revenue / shares_outstanding
                    if sales_per_share > 0:
                        stock_data['ps_ratio'] = current_price / sales_per_share
            
            # Calculate interest coverage ratio
            if not stock_data.get('interest_coverage') and interest_expense != 0 and ebit > 0:
                # Interest expense is usually negative, take absolute value
                stock_data['interest_coverage'] = ebit / abs(interest_expense)
            
            # Calculate EBITDA if missing
            if not stock_data.get('ebitda'):
                depreciation = stock_data.get('depreciation', 0)
                if ebit > 0 and depreciation > 0:
                    stock_data['ebitda'] = ebit + depreciation
                elif net_income > 0:  # Alternative calculation from bottom up
                    tax_expense = stock_data.get('tax_expense', 0)
                    if interest_expense and depreciation:
                        # EBITDA = NI + Tax + Interest + D&A
                        stock_data['ebitda'] = net_income + tax_expense + abs(interest_expense) + depreciation
            
            # Calculate P/CF ratio if missing
            if not stock_data.get('pcf_ratio') and shares_outstanding > 0 and current_price > 0:
                operating_cash_flow = stock_data.get('operating_cash_flow')
                if operating_cash_flow and operating_cash_flow > 0:
                    cash_flow_per_share = operating_cash_flow / shares_outstanding
                    stock_data['pcf_ratio'] = current_price / cash_flow_per_share
            
            # Calculate enterprise value and EV ratios
            market_cap = stock_data.get('market_cap', 0)
            if not stock_data.get('enterprise_value') and market_cap > 0:
                ev = market_cap + total_debt - cash
                stock_data['enterprise_value'] = ev
                
                # EV/EBITDA
                if not stock_data.get('ev_ebitda') and ebitda > 0:
                    stock_data['ev_ebitda'] = ev / ebitda
            
            # Calculate working capital
            if not stock_data.get('working_capital') and current_assets and current_liabilities:
                stock_data['working_capital'] = current_assets - current_liabilities
                
            # Calculate working capital turnover
            if not stock_data.get('working_capital_turnover') and revenue > 0:
                wc = stock_data.get('working_capital')
                if wc and wc > 0:
                    stock_data['working_capital_turnover'] = revenue / wc
                
            return stock_data
            
        except Exception as e:
            logger.error(f"Error calculating missing ratios: {e}")
            return stock_data

provider = StockDataProvider()

@app.route("/api/stock/<symbol>")
def api_stock(symbol):
    try:
        period = request.args.get("period", "year")
        fetch_price = request.args.get("fetch_price", "false").lower() == "true"
        data = provider.get_stock_data(symbol, period, fetch_current_price=fetch_price)
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
        period = request.args.get("period", "year")  # Default to year (changed from quarter)
        fetch_price = request.args.get("fetch_price", "false").lower() == "true"  # Default to false (changed from true)
        data = provider.get_stock_data(symbol, period, fetch_current_price=fetch_price)
        # --- Lấy roe, roa theo dữ liệu quarter nếu có, fallback sang year nếu không ---
        if data.get("success") and period == "quarter":
            # Chỉ fallback roe, roa sang year nếu quarter không có
            yearly_data = provider.get_stock_data(symbol, "year")
            roe_quarter = data.get("roe", None)
            roa_quarter = data.get("roa", None)
            # Nếu quarter không có thì fallback sang year
            if roe_quarter is None or pd.isna(roe_quarter):
                roe_quarter = yearly_data.get("roe", None)
            if roa_quarter is None or pd.isna(roa_quarter):
                roa_quarter = yearly_data.get("roa", None)
            data["roe"] = roe_quarter
            data["roa"] = roa_quarter
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
            # Don't overwrite if book_value_per_share already exists from vnstock ratios
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

@app.route("/api/current-price/<symbol>")
def api_current_price(symbol):
    """Get real-time current price for a symbol"""
    try:
        current_price = provider.get_current_price(symbol.upper())
        if current_price:
            # Get shares outstanding for market cap calculation
            cached_data = provider._stock_data_cache.get(symbol.upper(), {})
            shares = cached_data.get('shares_outstanding')
            market_cap = current_price * shares if pd.notna(shares) and shares > 0 else None
            
            return jsonify({
                "symbol": symbol.upper(),
                "current_price": current_price,
                "market_cap": market_cap,
                "shares_outstanding": shares,
                "timestamp": datetime.now().isoformat(),
                "success": True
            })
        else:
            return jsonify({
                "symbol": symbol.upper(),
                "error": "Could not fetch current price",
                "success": False
            }), 404
    except Exception as exc:
        logger.error(f"API /current-price error {symbol}: {exc}")
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
    try:
        data_available = provider._stock_data_cache is not None and len(provider._stock_data_cache) > 0
        return jsonify({
            "status": "healthy", 
            "vnstock_available": True,
            "cached_data_available": data_available,
            "cached_symbols_count": len(provider._stock_data_cache) if provider._stock_data_cache else 0
        })
    except Exception as e:
        return jsonify({"status": "unhealthy", "error": str(e)}), 500

@app.route("/api/reload-data", methods=['POST'])
def reload_data():
    """Reload stock data from file without restarting server"""
    try:
        success = provider.reload_data()
        if success:
            return jsonify({
                "success": True, 
                "message": "Data reloaded successfully",
                "symbols_count": len(provider._stock_data_cache) if provider._stock_data_cache else 0
            })
        else:
            return jsonify({
                "success": False, 
                "message": "Failed to reload data"
            }), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/historical-chart-data/<symbol>")
def get_historical_chart_data(symbol):
    try:
        # Check cache first
        cache_key = symbol.upper()
        current_time = time.time()
        
        if cache_key in chart_cache:
            cached_data, cache_time = chart_cache[cache_key]
            if current_time - cache_time < CHART_CACHE_DURATION:
                logger.info(f"Returning cached chart data for {symbol}")
                return jsonify({
                    "success": True,
                    "symbol": symbol,
                    "data": cached_data,
                    "cached": True
                })
        
        logger.info(f"Fetching fresh historical chart data for {symbol}")
        # Lấy industry từ CSV
        company_info = provider._get_company_info_from_csv(symbol)
        industry = company_info.get('industry', '').strip()
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
        # --------- BEGIN NIM PREPARATION ---------
        # Fetch quarterly income statement & balance sheet for NIM calculation
        income_quarter = stock.finance.income_statement(period='quarter', lang='en', dropna=True)
        balance_quarter = stock.finance.balance_sheet(period='quarter', lang='en', dropna=True)
        if income_quarter.empty:
            income_quarter = stock.finance.income_statement(period='quarter', lang='vn', dropna=True)
        if balance_quarter.empty:
            balance_quarter = stock.finance.balance_sheet(period='quarter', lang='vn', dropna=True)
        # Ensure chronological order matches ratio_quarter ordering
        for _df in [income_quarter, balance_quarter]:
            if 'yearReport' in _df.columns and 'lengthReport' in _df.columns:
                _df['yearReport'] = _df['yearReport'].astype(int)
                _df['lengthReport'] = _df['lengthReport'].astype(int)
                _df.sort_values(['yearReport', 'lengthReport'], ascending=[True, True], inplace=True)
        def _pick_value(series, candidates):
            """Helper: pick first non-nan value matching any candidate label (case-insensitive substring search)."""
            for col in series.index:
                label = " ".join(col).strip().lower() if isinstance(col, tuple) else str(col).lower()
                for cand in candidates:
                    if cand.lower() in label:
                        val = series[col]
                        if pd.notna(val):
                            try:
                                return float(val)
                            except Exception:
                                continue
            # Return NaN instead of 0 so callers can differentiate between "not found" and a real zero value
            return np.nan
        # --------- END NIM PREPARATION ---------
        historical_data = {
            "years": [],
            "roe_data": [],
            "roa_data": [],
            "current_ratio_data": [],
            "quick_ratio_data": [],
            "cash_ratio_data": [],
            "pe_ratio_data": [],
            "pb_ratio_data": [],
            "nim_data": []
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
            pe_ratio = row.get(('Chỉ tiêu định giá', 'P/E'), np.nan)
            pb_ratio = row.get(('Chỉ tiêu định giá', 'P/B'), np.nan)
            roe_val = float(roe * 100) if pd.notna(roe) else 0
            roa_val = float(roa * 100) if pd.notna(roa) else 0
            current_ratio_val = float(current_ratio) if pd.notna(current_ratio) else 0
            quick_ratio_val = float(quick_ratio) if pd.notna(quick_ratio) else 0
            cash_ratio_val = float(cash_ratio) if pd.notna(cash_ratio) else 0
            pe_ratio_val = float(pe_ratio) if pd.notna(pe_ratio) else 0
            pb_ratio_val = float(pb_ratio) if pd.notna(pb_ratio) else 0
            # --------- NIM CALCULATION ---------
            nim_val = None
            if industry == "Ngân hàng":
                # Không tính các chỉ số thanh khoản cho ngành ngân hàng
                current_ratio_val = None
                quick_ratio_val = None
                cash_ratio_val = None
                nim_val = np.nan
                try:
                    mask_income = (income_quarter['yearReport'] == year) & (income_quarter['lengthReport'] == quarter)
                    if hasattr(mask_income, 'any') and mask_income.any():
                        idx_current = income_quarter[mask_income].index[0]
                        pos = income_quarter.index.get_loc(idx_current)
                        if pos >= 3:
                            idxs = income_quarter.index[pos-3:pos+1]
                            numerator = 0.0
                            for jdx in idxs:
                                inc_row = income_quarter.loc[jdx] if (isinstance(income_quarter, pd.DataFrame) and jdx in income_quarter.index) else None
                                if isinstance(inc_row, pd.Series) and not inc_row.empty:
                                    num_part = _pick_value(inc_row, [
                                        'Net Interest Income',
                                        'Net interest income',
                                        'Lãi thuần từ hoạt động cho vay',
                                        'Interest income - interest expense'
                                    ])
                                    numerator += 0 if pd.isna(num_part) else num_part
                            # denominator: average earning assets of the last 4 quarters
                            total_sbv = total_placements = total_trading = total_investment = total_loans = 0.0
                            count = 0
                            for jdx in idxs:
                                bal_row = balance_quarter.loc[jdx] if (isinstance(balance_quarter, pd.DataFrame) and jdx in balance_quarter.index) else None
                                if isinstance(bal_row, pd.Series) and not bal_row.empty:
                                    sbv = _pick_value(bal_row, [
                                        'Balances with the SBV',
                                        'Balance with SBV',
                                        'Tiền gửi tại NHNN'
                                    ])
                                    placements = _pick_value(bal_row, [
                                        'Placements with and loans to other credit institutions',
                                        'Due from other credit institutions',
                                        'Tiền gửi và cho vay TCTD khác'
                                    ])
                                    trading = _pick_value(bal_row, [
                                        'Trading securities, net',
                                        'Trading securities',
                                        'Chứng khoán kinh doanh'
                                    ])
                                    investment = _pick_value(bal_row, [
                                        'Investment securities',
                                        'Investment Securities',
                                        'Chứng khoán đầu tư'
                                    ])
                                    loans = _pick_value(bal_row, [
                                        'Loans and advances to customers, net',
                                        'Loans to customers',
                                        'Cho vay khách hàng'
                                    ])
                                    total_sbv += 0 if pd.isna(sbv) else sbv
                                    total_placements += 0 if pd.isna(placements) else placements
                                    total_trading += 0 if pd.isna(trading) else trading
                                    total_investment += 0 if pd.isna(investment) else investment
                                    total_loans += 0 if pd.isna(loans) else loans
                                    count += 1
                            if count > 0:
                                avg_sbv = total_sbv / count
                                avg_placements = total_placements / count
                                avg_trading = total_trading / count
                                avg_investment = total_investment / count
                                avg_loans = total_loans / count
                                denominator = avg_sbv + avg_placements + avg_trading + avg_investment + avg_loans
                            else:
                                denominator = 0.0
                            if denominator != 0:
                                nim_val = (numerator / denominator) * 100
                except Exception as e:
                    nim_val = np.nan
                nim_val = float(nim_val) if pd.notna(nim_val) else 0
            historical_data["years"].append(period_label)
            historical_data["roe_data"].append(roe_val)
            historical_data["roa_data"].append(roa_val)
            historical_data["current_ratio_data"].append(current_ratio_val)
            historical_data["quick_ratio_data"].append(quick_ratio_val)
            historical_data["cash_ratio_data"].append(cash_ratio_val)
            historical_data["pe_ratio_data"].append(pe_ratio_val)
            historical_data["pb_ratio_data"].append(pb_ratio_val)
            historical_data["nim_data"].append(nim_val)
        # Nếu là ngành ngân hàng, trả về các trường liquidity ratios là None hoặc rỗng
        if industry == "Ngân hàng":
            historical_data["current_ratio_data"] = None
            historical_data["quick_ratio_data"] = None
            historical_data["cash_ratio_data"] = None
        
        # Cache the data for future requests
        # Cache the result for future requests
        chart_cache[cache_key] = (historical_data, current_time)
        
        logger.info(f"Successfully retrieved {len(historical_data['years'])} periods of historical data for {symbol}")
        return jsonify({
            "success": True,
            "symbol": symbol,
            "data": historical_data,
            "cached": False
        })
    except Exception as e:
        logger.error(f"Error fetching historical chart data for {symbol}: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "data": {}
        })

@app.route("/api/cache-status")
def get_cache_status():
    """Get the current status of the chart data cache"""
    try:
        current_time = time.time()
        cache_info = {}
        
        for symbol, (data, cache_time) in chart_cache.items():
            age_seconds = current_time - cache_time
            cache_info[symbol] = {
                "cached_at": datetime.fromtimestamp(cache_time).strftime("%Y-%m-%d %H:%M:%S"),
                "age_seconds": int(age_seconds),
                "age_minutes": round(age_seconds / 60, 1),
                "expires_in_seconds": max(0, CHART_CACHE_DURATION - age_seconds),
                "data_points": len(data.get("years", [])) if data else 0
            }
        
        return jsonify({
            "success": True,
            "cache_duration_hours": CHART_CACHE_DURATION / 3600,
            "total_cached_symbols": len(chart_cache),
            "cache_details": cache_info
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

if __name__ == "__main__":
    logger.info("Vietnamese Stock Valuation Backend – running on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)