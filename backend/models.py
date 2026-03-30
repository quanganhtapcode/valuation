import numpy as np
import pandas as pd
from vnstock import Vnstock

class ValuationModels:
    """
    Comprehensive financial valuation models for Vietnamese stocks
    Implements 4 models: FCFE, FCFF, Justified P/E, and Justified P/B
    """
    def __init__(self, stock_data=None, stock_symbol=None, income_df=None, balance_df=None, cash_flow_df=None):
        """Initialize with stock data and optional pre-fetched DataFrames"""
        self.stock_data = stock_data or {}
        self.stock_symbol = stock_symbol
        self.vnstock_instance = Vnstock()
        self.stock = None
        if stock_symbol:
            self.stock = self.vnstock_instance.stock(symbol=stock_symbol, source='VCI')
        
        # Cache for financial data
        self._income_data_cache = {'income_year': income_df} if income_df is not None else {}
        self._balance_data_cache = {'balance_year': balance_df} if balance_df is not None else {}
        self._cash_flow_data_cache = {'cash_flow_year': cash_flow_df} if cash_flow_df is not None else {}
        
        self._shares_outstanding_cache = self.stock_data.get('shares_outstanding')
        self._sector_peers_cache = None  # Cache for sector peers to avoid loading JSON files twice

    def calculate_all_models(self, assumptions, known_sector=None):
        """Calculate all 4 valuation models with given assumptions"""
        if not self.stock_symbol and not self.stock_data:
            return {'error': 'No stock data or symbol available'}
        
        results = {}
        
        # Calculate FCFE
        try:
            fcfe_result = self.calculate_fcfe(assumptions)
            results['fcfe'] = fcfe_result
        except Exception as e:
            results['fcfe'] = 0
            
        # Calculate FCFF
        try:
            fcff_result = self.calculate_fcff(assumptions)
            results['fcff'] = fcff_result
        except Exception as e:
            results['fcff'] = 0
            
        # Calculate Justified P/E
        try:
            pe_result = self.calculate_justified_pe(assumptions, known_sector=known_sector)
            results['justified_pe'] = pe_result
        except Exception as e:
            results['justified_pe'] = 0
            
        # Calculate Justified P/B
        try:
            pb_result = self.calculate_justified_pb(assumptions, known_sector=known_sector)
            results['justified_pb'] = pb_result
        except Exception as e:
            results['justified_pb'] = 0

        # Calculate Graham Number
        try:
            graham_result = self.calculate_graham(assumptions, known_sector=known_sector)
            results['graham'] = graham_result
        except Exception as e:
            results['graham'] = 0

        # Calculate Comparable P/S
        try:
            ps_result = self.calculate_justified_ps(assumptions, known_sector=known_sector)
            results['justified_ps'] = ps_result
        except Exception as e:
            results['justified_ps'] = 0

        results['weighted_average'] = 0
        results['summary'] = {}

        # Determine sector if not provided
        if not known_sector and self.stock_data and 'sector' in self.stock_data:
            known_sector = self.stock_data.get('sector')
            
        is_bank = False
        if known_sector and ('Ngân hàng' in known_sector or 'Bank' in known_sector):
             is_bank = True

        # Calculate weighted average of valid models
        # Non-banks: DCF 40% (FCFE+FCFF), Comparables 40% (PE+PB), Graham 10%, PS 10%
        default_weights = {
            'fcfe': 0.20, 'fcff': 0.20,
            'justified_pe': 0.20, 'justified_pb': 0.20,
            'graham': 0.10, 'justified_ps': 0.10,
        }

        # Override weights for Banks: only P/E and P/B
        if is_bank:
            default_weights = {
                'fcfe': 0, 'fcff': 0,
                'justified_pe': 0.5, 'justified_pb': 0.5,
                'graham': 0, 'justified_ps': 0,
            }
            # Add flag to results
            results['is_bank'] = True

        model_weights = assumptions.get('model_weights', default_weights)
        
        # If user didn't provide specific weights (using defaults), ensure bank logic is applied
        if is_bank and model_weights.get('fcfe') == 0.20 and model_weights.get('fcff') == 0.20:
             model_weights = default_weights
        
        # Helper to extract numeric value from result
        def get_model_value(res):
            if isinstance(res, dict):
                return float(res.get('shareValue', 0))
            try:
                return float(res) if res is not None else 0
            except:
                return 0

        valid_models = {}
        for k, v in results.items():
            if k in model_weights:
                val = get_model_value(v)
                if val > 0:
                     valid_models[k] = val

        if valid_models:
            total_weight = sum(model_weights[k] for k in valid_models.keys())
            if total_weight > 0:
                results['weighted_average'] = float(sum(
                    valid_models[k] * model_weights[k] for k in valid_models.keys()
                ) / total_weight)
                
                # Add summary statistics
                values = list(valid_models.values())
                results['summary'] = {
                    'average': float(np.mean(values)),
                    'min': float(min(values)),
                    'max': float(max(values)),
                    'models_used': len(values),
                    'total_models': 4
                }

        # Sensitivity Analysis (FCFF)
        try:
            base_wacc = assumptions.get('wacc', 0.10)
            base_growth = assumptions.get('terminal_growth', 0.02)
            
            # Ranges: +/- 1% with 0.5% steps
            wacc_range = [base_wacc - 0.01, base_wacc - 0.005, base_wacc, base_wacc + 0.005, base_wacc + 0.01]
            growth_range = [base_growth - 0.01, base_growth - 0.005, base_growth, base_growth + 0.005, base_growth + 0.01]
            
            sensitivity_matrix = {
                'row_headers': [float(round(w * 100, 1)) for w in wacc_range],
                'col_headers': [float(round(g * 100, 1)) for g in growth_range],
                'values': []
            }
            
            for w in wacc_range:
                row_values = []
                for g in growth_range:
                    # Create temp assumptions
                    temp_assumptions = assumptions.copy()
                    temp_assumptions['wacc'] = float(w)
                    temp_assumptions['terminal_growth'] = float(g)
                    
                    # Calculate FCFF with temp assumptions
                    val_result = self.calculate_fcff(temp_assumptions, logging_enabled=False)
                    val = get_model_value(val_result)
                    row_values.append(int(val)) # Store integer value
                sensitivity_matrix['values'].append(row_values)
                
            results['sensitivity_analysis'] = sensitivity_matrix
            
        except Exception as e:
            # print(f"Sensitivity analysis error: {e}")
            results['sensitivity_analysis'] = None

        # Add sector peers data for Excel export
        try:
            peer_data = self.get_sector_peers(num_peers=10)
            results['sector_peers'] = peer_data
        except Exception as e:
            results['sector_peers'] = None

        return results

    # ===================================================
    # HELPER FUNCTIONS
    # ===================================================
    
    def get_sector_peers(self, num_peers=10, known_sector=None):
        """
        Find top stocks in the same sector by market cap
        Reads from pre-generated sector_peers.json for fast lookup
        Returns dict with median P/E, median P/B, and list of peer symbols
        """
        # Return cached result if available
        if self._sector_peers_cache is not None:
            return self._sector_peers_cache
        
        import os
        import json
        
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        current_symbol = self.stock_symbol.upper() if self.stock_symbol else None
        
        if not current_symbol:
            return {'median_pe': None, 'median_pb': None, 'peers': [], 'error': 'No symbol specified'}
        
        # First, query the sector for current stock
        current_sector = known_sector
        
        # If not provided, try from frontend/ticker_data.json (Source of Truth)
        if not current_sector:
            ticker_data_file = os.path.join(base_path, 'frontend', 'ticker_data.json')
            if os.path.exists(ticker_data_file):
                try:
                    with open(ticker_data_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        tickers = []
                        if isinstance(data, dict) and 'tickers' in data:
                            tickers = data['tickers']
                        elif isinstance(data, list):
                            tickers = data
                            
                        # Find current symbol
                        for t in tickers:
                            if t.get('symbol') == current_symbol:
                                current_sector = t.get('sector') or t.get('industry')
                                break
                except Exception as e:
                    print(f"⚠️ Error reading ticker_data.json: {e}")
                    
        # Fallback to local stock file if still not found
        if not current_sector:
            stocks_folder = os.path.join(base_path, 'stocks')
            current_stock_file = os.path.join(stocks_folder, f'{current_symbol}.json')
            if os.path.exists(current_stock_file):
                try:
                    with open(current_stock_file, 'r', encoding='utf-8') as f:
                        current_data = json.load(f)
                        current_sector = current_data.get('sector')
                except:
                    pass
        
        if not current_sector:
            return {'median_pe': None, 'median_pb': None, 'peers': [], 'error': 'Could not determine sector'}
        
        # Read from pre-generated sector_peers.json (FAST)
        sector_peers_file = os.path.join(base_path, 'sector_peers.json')
        
        if os.path.exists(sector_peers_file):
            with open(sector_peers_file, 'r', encoding='utf-8') as f:
                all_sectors = json.load(f)
            
            # Sector name mapping (ICB level 3 → ICB level 2)
            # VCI API sometimes returns different names than local JSON files
            sector_mapping = {
                # Thực phẩm
                'Sản xuất thực phẩm': 'Thực phẩm và đồ uống',
                'Đồ uống': 'Thực phẩm và đồ uống',
                'Thuốc lá': 'Thực phẩm và đồ uống',
                # Ngân hàng & Tài chính  
                'Ngân hàng thương mại': 'Ngân hàng',
                'Chứng khoán': 'Dịch vụ tài chính',
                'Tài chính tiêu dùng': 'Dịch vụ tài chính',
                'Đầu tư tài chính': 'Dịch vụ tài chính',
                # Bất động sản
                'Phát triển Bất động sản': 'Bất động sản',
                'Dịch vụ Bất động sản': 'Bất động sản',
                # Xây dựng
                'Xây dựng': 'Xây dựng và Vật liệu',
                'Vật liệu xây dựng': 'Xây dựng và Vật liệu',
                # Công nghiệp
                'Vận tải': 'Hàng & Dịch vụ Công nghiệp',
                'Logistics': 'Hàng & Dịch vụ Công nghiệp',
                'Dịch vụ công nghiệp': 'Hàng & Dịch vụ Công nghiệp',
                # Hóa chất
                'Nhựa & Bao bì': 'Hóa chất',
                'Phân bón & Hóa chất nông nghiệp': 'Hóa chất',
                # Y tế
                'Dược phẩm': 'Y tế',
                'Thiết bị y tế': 'Y tế',
                # Điện
                'Sản xuất điện': 'Điện, nước & xăng dầu khí đốt',
                'Điện': 'Điện, nước & xăng dầu khí đốt',
                # Bán lẻ
                'Bán lẻ thực phẩm': 'Bán lẻ',
                'Bán lẻ chuyên biệt': 'Bán lẻ',
                # Công nghệ
                'Phần mềm': 'Công nghệ Thông tin',
                'Dịch vụ CNTT': 'Công nghệ Thông tin',
                # Khác
                'Khai thác': 'Tài nguyên Cơ bản',
                'Thép': 'Tài nguyên Cơ bản',
                'Kim loại': 'Tài nguyên Cơ bản',
            }
            
            # Try to find matching sector
            matched_sector = current_sector
            if current_sector not in all_sectors:
                # Try mapping
                matched_sector = sector_mapping.get(current_sector)
                if matched_sector:
                    print(f"📋 Sector mapped: '{current_sector}' → '{matched_sector}'")
                else:
                    # Try partial match
                    for sector_key in all_sectors.keys():
                        if current_sector in sector_key or sector_key in current_sector:
                            matched_sector = sector_key
                            print(f"📋 Sector partial match: '{current_sector}' → '{matched_sector}'")
                            break
            
            if matched_sector and matched_sector in all_sectors:
                sector_data = all_sectors[matched_sector]
                
                # Get peers (excluding current stock) - return FULL details
                all_peers = sector_data.get('peers', [])
                peers_full = [p for p in all_peers if p.get('symbol') != current_symbol][:num_peers]
                peer_symbols = [p['symbol'] for p in peers_full]
                
                result = {
                    'median_pe': sector_data.get('median_pe'),
                    'median_pb': sector_data.get('median_pb'),
                    'peers': peer_symbols,  # Keep for backward compatibility
                    'peers_detail': peers_full,  # NEW: Full peer details for Excel export
                    'sector': current_sector,
                    'peer_count': len(peer_symbols),
                    'total_in_sector': sector_data.get('total_in_sector', len(all_peers))
                }
                
                # Log
                print(f"\n{'='*60}")
                print(f"📊 SECTOR COMPARABLE (from cache): {current_symbol}")
                print(f"{'='*60}")
                print(f"Sector: {current_sector}")
                print(f"Peers: {', '.join(peer_symbols[:5])}{'...' if len(peer_symbols) > 5 else ''}")
                print(f"Median P/E: {result['median_pe']:.2f}" if result['median_pe'] else "Median P/E: N/A")
                print(f"Median P/B: {result['median_pb']:.2f}" if result['median_pb'] else "Median P/B: N/A")
                print(f"{'='*60}\n")
                
                # Cache and return
                self._sector_peers_cache = result
                return result
        
        # Fallback: sector_peers.json not found, use market defaults
        print(f"⚠️ sector_peers.json not found, using market defaults")
        result = {
            'median_pe': 15.0,  # Market average
            'median_pb': 1.5,   # Market average
            'peers': [],
            'sector': current_sector,
            'peer_count': 0,
            'error': 'sector_peers.json not found'
        }
        self._sector_peers_cache = result
        return result
    
    def get_cached_income_data(self, period='year'):
        """Get income statement data with caching to avoid repeated API calls"""
        cache_key = f"income_{period}"
        if cache_key not in self._income_data_cache:
            if self.stock:
                self._income_data_cache[cache_key] = self.stock.finance.income_statement(period=period, dropna=False)
            else:
                self._income_data_cache[cache_key] = pd.DataFrame()
        return self._income_data_cache[cache_key]
    
    def get_cached_cash_flow_data(self, period='year'):
        """Get cash flow data with caching to avoid repeated API calls"""
        cache_key = f"cash_flow_{period}"
        if cache_key not in self._cash_flow_data_cache:
            if self.stock:
                self._cash_flow_data_cache[cache_key] = self.stock.finance.cash_flow(period=period, dropna=False)
            else:
                self._cash_flow_data_cache[cache_key] = pd.DataFrame()
        return self._cash_flow_data_cache[cache_key]
    
    def get_cached_balance_data(self, period='year'):
        """Get balance sheet data with caching to avoid repeated API calls"""
        cache_key = f"balance_{period}"
        if cache_key not in self._balance_data_cache:
            if self.stock:
                self._balance_data_cache[cache_key] = self.stock.finance.balance_sheet(period=period, dropna=False)
            else:
                self._balance_data_cache[cache_key] = pd.DataFrame()
        return self._balance_data_cache[cache_key]
    
    def check_data_frequency(self, data, expected_frequency):
        """Check if data is yearly or quarterly, sort, and filter latest quarters if needed."""
        time_cols = [col for col in data.columns if any(kw in col.lower() for kw in ['year', 'quarter', 'date', 'time'])]
        quarter_col = [col for col in data.columns if 'lengthReport' in col or 'quarter' in col.lower()]
        
        if not time_cols and not quarter_col:
            return expected_frequency, data
        
        # Handle quarterly data with yearReport and lengthReport
        if 'yearReport' in data.columns and 'lengthReport' in data.columns:
            data = data.copy()
            data['yearReport'] = data['yearReport'].astype(float)
            data['lengthReport'] = data['lengthReport'].astype(float)
            data = data.sort_values(['yearReport', 'lengthReport'], ascending=[False, False]).reset_index(drop=True)
            
            if expected_frequency == 'quarter':
                latest_quarters = data.head(4)
                quarter_labels = [f"{int(row['yearReport'])}Q{int(row['lengthReport'])}" for _, row in latest_quarters.iterrows()]
                if len(latest_quarters) < 4:
                    pass
                return 'quarter', latest_quarters
            else:
                latest_year = data[data['lengthReport'] == 4].head(1) if not data[data['lengthReport'] == 4].empty else data.head(1)
                if not latest_year.empty:
                    pass
                return 'year', latest_year
        
        # Handle DB snake_case format: integer 'year' and 'quarter' columns
        if 'year' in data.columns and 'quarter' in data.columns:
            try:
                data = data.copy()
                data['_yr'] = pd.to_numeric(data['year'], errors='coerce')
                data['_qt'] = pd.to_numeric(data['quarter'], errors='coerce').fillna(4)
                data = data.sort_values(['_yr', '_qt'], ascending=[False, False]).reset_index(drop=True)
                data = data.drop(columns=['_yr', '_qt'])
                if expected_frequency == 'quarter':
                    return 'quarter', data.head(4)
                else:
                    full_year = data[data['quarter'] == 4].head(1)
                    return 'year', full_year if not full_year.empty else data.head(1)
            except Exception:
                pass

        # Handle other datetime columns
        time_col = time_cols[0] if time_cols else None
        if time_col:
            try:
                data[time_col] = pd.to_datetime(data[time_col], errors='coerce')
                if data[time_col].notna().any():
                    data = data.sort_values(time_col, ascending=False).reset_index(drop=True)
                    if expected_frequency == 'quarter':
                        latest_quarters = data.head(4)
                        return 'quarter', latest_quarters
                    else:
                        latest_year = data.head(1)
                        return 'year', latest_year
            except Exception as e:
                pass
        
        return expected_frequency, data.head(1)

    def find_financial_value(self, data, column_names, is_quarterly=False):
        """Find and return value for given column names, following original logic."""
        total = 0
        matched_columns = []
        
        if data.empty:
            return 0
        
        for target_col in column_names:
            found = False
            target_clean = target_col.lower().strip()
            
            for data_col in data.columns:
                # Normalize data_col: remove units like (Bn. VND) and case fold
                data_col_clean = str(data_col).split('(')[0].strip().lower()
                
                # Check for match (clean match OR exact match)
                if target_clean == data_col_clean or target_clean == str(data_col).lower().strip():
                    values = data[data_col]
                    if values.notna().any():
                        valid_values = values.dropna()
                        if not valid_values.empty:
                            if is_quarterly:
                                current_sum = float(valid_values.sum())
                            else:
                                current_sum = float(valid_values.iloc[0])
                            
                            # For fixed_capital, sum all matching columns
                            if 'fixed' in target_col.lower() or 'capital' in target_col.lower():
                                total += current_sum
                                matched_columns.append(f"'{data_col}' ({current_sum:,.0f})")
                            else:
                                total = current_sum
                                matched_columns.append(f"'{data_col}' ({current_sum:,.0f})")
                                found = True
                                break
            if found and 'fixed' not in target_col.lower():
                break
        
        if matched_columns:
            pass
        
        return total

    def get_shares_outstanding(self):
        """Get shares outstanding from stock data with caching"""
        if self._shares_outstanding_cache is not None:
            return self._shares_outstanding_cache
            
        if not self.stock:
            result = self.stock_data.get('shares_outstanding', 1_000_000_000)
            self._shares_outstanding_cache = result
            return result
            
        try:
            price_board = self.stock.trading.price_board([self.stock_symbol])
            shares_outstanding = 1_000_000_000  # Default
            for col in price_board.columns:
                if 'listed_share' in str(col).lower():
                    shares_outstanding = price_board[col].iloc[0]
                    break
            self._shares_outstanding_cache = shares_outstanding
            return shares_outstanding
        except:
            result = self.stock_data.get('shares_outstanding', 1_000_000_000)
            self._shares_outstanding_cache = result
            return result
      # ===================================================
    # VALUATION MODELS
    # ===================================================
    
    def calculate_fcfe(self, assumptions, logging_enabled=True):
        """
        Calculate FCFE (Free Cash Flow to Equity) Valuation - CORRECTED
        Returns: value per share in VND
        """
        try:
            
            # Get assumptions
            short_term_growth = assumptions.get('short_term_growth', 
                                               assumptions.get('revenue_growth', 0.05))
            terminal_growth = assumptions.get('terminal_growth', 0.02)
            # FCFE must use Cost of Equity, NOT WACC
            cost_of_equity = assumptions.get('cost_of_equity', 0.12)
            
            tax_rate = assumptions.get('tax_rate', 0.20)
            forecast_years = assumptions.get('forecast_years', 5)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            
            shares_outstanding = self.get_shares_outstanding()
            
            # Use stock data if available, otherwise use provided data
            if self.stock:
                # Fetch financial data with caching
                income_data = self.get_cached_income_data(period=data_frequency)
                cash_flow_data = self.get_cached_cash_flow_data(period=data_frequency)
                
                # Process data frequency
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                _, processed_cash_flow = self.check_data_frequency(cash_flow_data.copy(), data_frequency)
                is_quarterly = actual_freq == 'quarter'
                
                
                # Net Income (VCI name OR DB snake_case)
                net_income = self.find_financial_value(processed_income, [
                    'Net Profit For the Year', 'net_profit_parent_company', 'net_profit'], is_quarterly)

                # Non-Cash Charges (Depreciation)
                non_cash_charges = self.find_financial_value(processed_cash_flow, [
                    'Depreciation and Amortisation', 'depreciation_fixed_assets'], is_quarterly)

                # Working Capital Investment
                receivables_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in receivables', 'increase_decrease_receivables'], is_quarterly)
                inventories_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in inventories', 'increase_decrease_inventory'], is_quarterly)
                payables_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in payables', 'increase_decrease_payables'], is_quarterly)
                working_capital_investment = receivables_change + inventories_change - payables_change

                # Fixed Capital Investment
                fixed_capital_investment = self.find_financial_value(processed_cash_flow,
                    ['Purchase of fixed assets', 'Proceeds from disposal of fixed assets',
                     'purchase_purchase_fixed_assets', 'proceeds_from_disposal_fixed_assets'],
                    is_quarterly)

                # Net Borrowing
                proceeds_borrowings = self.find_financial_value(processed_cash_flow, [
                    'Proceeds from borrowings', 'proceeds_from_borrowings'], is_quarterly)
                repayment_borrowings = self.find_financial_value(processed_cash_flow, [
                    'Repayment of borrowings', 'repayments_of_borrowings'], is_quarterly)
                net_borrowing = proceeds_borrowings + repayment_borrowings

                # FCFE CALCULATION
                fcfe = net_income + non_cash_charges + net_borrowing - working_capital_investment + fixed_capital_investment
                
            else:
                # Use provided stock data
                net_income = self.stock_data.get('net_income_ttm', 0)
                depreciation = self.stock_data.get('depreciation', 0)
                capex = abs(self.stock_data.get('capex', 0))
                net_borrowing = self.stock_data.get('net_borrowing', 0)
                working_capital_change = self.stock_data.get('working_capital_change', 0)
                
                fcfe = net_income + depreciation + net_borrowing - working_capital_change - capex
                
            
            # Project and discount using Cost of Equity
            future_fcfes = [fcfe * ((1 + short_term_growth) ** year) for year in range(1, forecast_years + 1)]
            
            # Terminal Value calculation
            # If cost_of_equity <= terminal_growth, use a safe multiplier or cap
            if cost_of_equity <= terminal_growth:
                 # Fallback: assume constant multiple or force a spread
                 adj_cost_of_equity = max(cost_of_equity, terminal_growth + 0.02)
                 terminal_value = future_fcfes[-1] * (1 + terminal_growth) / (adj_cost_of_equity - terminal_growth)
            else:
                terminal_value = future_fcfes[-1] * (1 + terminal_growth) / (cost_of_equity - terminal_growth)

            pv_fcfes = [fcfe_val / ((1 + cost_of_equity) ** year) for year, fcfe_val in enumerate(future_fcfes, 1)]
            pv_terminal = terminal_value / ((1 + cost_of_equity) ** forecast_years)
            
            total_equity_value = sum(pv_fcfes) + pv_terminal
            
            if shares_outstanding > 0:
                per_share_fcfe = total_equity_value / shares_outstanding
            else:
                per_share_fcfe = 0
            
            # Return detailed result for Excel export
            # Prepare detailed result for Excel export
            detailed_result = {
                'shareValue': float(per_share_fcfe),
                'baseFCFE': float(fcfe),
                'projectedCashFlows': [float(x) for x in future_fcfes],
                'presentValues': [float(x) for x in pv_fcfes],
                'terminalValue': float(terminal_value),
                'pvTerminal': float(pv_terminal),
                'totalEquityValue': float(total_equity_value),
                'sharesOutstanding': float(shares_outstanding),
                'inputs': {
                    'netIncome': float(net_income if self.stock else self.stock_data.get('net_income_ttm', 0)),
                    'depreciation': float(non_cash_charges if self.stock else self.stock_data.get('depreciation', 0)),
                    'netBorrowing': float(net_borrowing),
                    'workingCapitalInvestment': float(working_capital_investment if self.stock else self.stock_data.get('working_capital_change', 0)),
                    'fixedCapitalInvestment': float(fixed_capital_investment if self.stock else -abs(self.stock_data.get('capex', 0))),
                    # Detailed breakdown for Excel
                    'receivablesChange': float(receivables_change) if self.stock else 0,
                    'inventoriesChange': float(inventories_change) if self.stock else 0,
                    'payablesChange': float(payables_change) if self.stock else 0,
                    'proceedsBorrowings': float(proceeds_borrowings) if self.stock else 0,
                    'repaymentBorrowings': float(repayment_borrowings) if self.stock else 0,
                },
                'assumptions': {
                    'costOfEquity': float(cost_of_equity),
                    'shortTermGrowth': float(short_term_growth),
                    'terminalGrowth': float(terminal_growth),
                    'forecastYears': int(forecast_years)
                }
            }

            # LOG CALCULATION DETAILS
            if logging_enabled:
                try:
                    print(f"\n{'='*60}")
                    print(f"🧮 FCFE CALCULATION LOG: {self.stock_symbol or 'Custom Data'}")
                    print(f"{'='*60}")
                    inp = detailed_result['inputs']
                    print(f" (+) Net Income:                {inp['netIncome']:20,.0f}")
                    print(f" (+) Depreciation:              {inp['depreciation']:20,.0f}")
                    print(f" (+) Net Borrowing:             {inp['netBorrowing']:20,.0f}")
                    print(f" (-) Working Capital Inv:       {inp['workingCapitalInvestment']:20,.0f}")
                    print(f" (+) Fixed Capital Inv (CapEx): {inp['fixedCapitalInvestment']:20,.0f} (Note: Negative means outflow)")
                    print(f"{'-'*60}")
                    print(f" (=) Base FCFE:                 {detailed_result['baseFCFE']:20,.0f}")
                    print(f"Shares Outstanding:             {detailed_result['sharesOutstanding']:20,.0f}")
                    print(f"Fair Value per Share:           {detailed_result['shareValue']:20,.0f} VND")
                    print(f"{'='*60}")
                    # Debug: Show detailed breakdown fields
                    print(f"[DEBUG] Detailed inputs in response:")
                    print(f"  receivablesChange: {inp.get('receivablesChange', 'NOT SET')}")
                    print(f"  inventoriesChange: {inp.get('inventoriesChange', 'NOT SET')}")
                    print(f"  payablesChange: {inp.get('payablesChange', 'NOT SET')}")
                    print(f"  proceedsBorrowings: {inp.get('proceedsBorrowings', 'NOT SET')}")
                    print(f"  repaymentBorrowings: {inp.get('repaymentBorrowings', 'NOT SET')}")
                    print(f"{'='*60}\n")
                except Exception as e:
                    print(f"Error logging FCFE: {e}")

            return detailed_result

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'shareValue': 0, 'error': str(e)}
    
    def calculate_fcff(self, assumptions, logging_enabled=True):
        """
        Calculate FCFF (Free Cash Flow to Firm) Valuation - CORRECTED
        Returns: value per share in VND
        """
        try:
            
            # Get assumptions
            short_term_growth = assumptions.get('short_term_growth', 0.05)
            terminal_growth = assumptions.get('terminal_growth', 0.02)
            wacc = assumptions.get('wacc', 0.10)
            tax_rate = assumptions.get('tax_rate', 0.20)
            forecast_years = assumptions.get('forecast_years', 5)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            shares_outstanding = self.get_shares_outstanding()
            
            # Initialize Debt and Cash
            total_debt = 0
            cash = 0

            # Use stock data if available, otherwise use provided data
            if self.stock:
                # Fetch financial data with caching
                income_data = self.get_cached_income_data(period=data_frequency)
                cash_flow_data = self.get_cached_cash_flow_data(period=data_frequency)
                balance_data = self.get_cached_balance_data(period=data_frequency)

                # Process data frequency
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                _, processed_cash_flow = self.check_data_frequency(cash_flow_data.copy(), data_frequency)
                _, processed_balance = self.check_data_frequency(balance_data.copy(), data_frequency)
                
                is_quarterly = actual_freq == 'quarter'
                
                
                # Net Income (VCI name OR DB snake_case)
                net_income = self.find_financial_value(processed_income, [
                    'Net Profit For the Year', 'net_profit_parent_company', 'net_profit'], is_quarterly)

                # Non-Cash Charges (Depreciation)
                non_cash_charges = self.find_financial_value(processed_cash_flow, [
                    'Depreciation and Amortisation', 'depreciation_fixed_assets'], is_quarterly)

                # Interest Expense After Tax (FCFF specific)
                interest_expense = self.find_financial_value(processed_income, [
                    'Interest Expenses', 'financial_expense'], is_quarterly)
                # Ensure positive interest expense for adding back
                interest_after_tax = abs(interest_expense) * (1 - tax_rate)

                # Working Capital Investment
                receivables_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in receivables', 'increase_decrease_receivables'], is_quarterly)
                inventories_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in inventories', 'increase_decrease_inventory'], is_quarterly)
                payables_change = self.find_financial_value(processed_cash_flow, [
                    'Increase/Decrease in payables', 'increase_decrease_payables'], is_quarterly)
                working_capital_investment = receivables_change + inventories_change - payables_change

                # Fixed Capital Investment
                fixed_capital_investment = self.find_financial_value(processed_cash_flow,
                    ['Purchase of fixed assets', 'Proceeds from disposal of fixed assets',
                     'purchase_purchase_fixed_assets', 'proceeds_from_disposal_fixed_assets'],
                    is_quarterly)
                
                # Extract Debt and Cash for Equity Value Calculation
                # Short-term debt
                short_term_debt = self.find_financial_value(processed_balance, [
                    'Short-term borrowings', 'Vay và nợ thuê tài chính ngắn hạn', 'Short-term debt', 'Vay ngắn hạn',
                    'Vay ngắn hạn và nợ thuê tài chính ngắn hạn', 'Short-term borrowings and financial lease liabilities'
                ], False)
                # Long-term debt
                long_term_debt = self.find_financial_value(processed_balance, [
                    'Long-term borrowings', 'Vay và nợ thuê tài chính dài hạn', 'Long-term debt', 'Vay dài hạn',
                    'Vay dài hạn và nợ thuê tài chính dài hạn', 'Long-term borrowings and financial lease liabilities'
                ], False)
                total_debt = short_term_debt + long_term_debt

                # Cash
                cash = self.find_financial_value(processed_balance, [
                    'Cash and cash equivalents', 'Tiền và các khoản tương đương tiền', 'Cash', 'Tiền',
                    'cash_and_equivalents'
                ], False)


                # FCFF CALCULATION
                fcff = net_income + non_cash_charges + interest_after_tax - working_capital_investment + fixed_capital_investment
                
            else:
                # Use provided stock data
                net_income = self.stock_data.get('net_income_ttm', 0)
                depreciation = self.stock_data.get('depreciation', 0)
                interest_expense = self.stock_data.get('interest_expense', 0)
                interest_after_tax = interest_expense * (1 - tax_rate)
                capex = abs(self.stock_data.get('capex', 0))
                working_capital_change = self.stock_data.get('working_capital_change', 0)
                
                total_debt = self.stock_data.get('total_debt', 0)
                cash = self.stock_data.get('cash', 0)

                fcff = net_income + depreciation + interest_after_tax - working_capital_change - capex
                
            
            # Project and discount FCFF using WACC
            future_fcffs = [fcff * ((1 + short_term_growth) ** year) for year in range(1, forecast_years + 1)]
            
            if wacc <= terminal_growth:
                adj_wacc = max(wacc, terminal_growth + 0.02)
                terminal_value_fcff = future_fcffs[-1] * (1 + terminal_growth) / (adj_wacc - terminal_growth)
            else:
                terminal_value_fcff = future_fcffs[-1] * (1 + terminal_growth) / (wacc - terminal_growth)

            pv_fcffs = [fcff_val / ((1 + wacc) ** year) for year, fcff_val in enumerate(future_fcffs, 1)]
            pv_terminal_fcff = terminal_value_fcff / ((1 + wacc) ** forecast_years)
            
            # This is ENTERPRISE VALUE (Firm Value)
            enterprise_value = sum(pv_fcffs) + pv_terminal_fcff
            
            # Calculate EQUITY VALUE
            # Equity Value = Enterprise Value - Total Debt + Cash
            equity_value = enterprise_value - total_debt + cash
            
            if shares_outstanding > 0:
                per_share_fcff = equity_value / shares_outstanding
            else:
                per_share_fcff = 0
            
            # Return detailed result for Excel export
            # Prepare detailed result for Excel export
            detailed_result = {
                'shareValue': float(per_share_fcff),
                'baseFCFF': float(fcff),
                'projectedCashFlows': [float(x) for x in future_fcffs],
                'presentValues': [float(x) for x in pv_fcffs],
                'terminalValue': float(terminal_value_fcff),
                'pvTerminal': float(pv_terminal_fcff),
                'enterpriseValue': float(enterprise_value),
                'totalDebt': float(total_debt),
                'cash': float(cash),
                'equityValue': float(equity_value),
                'sharesOutstanding': float(shares_outstanding),
                'inputs': {
                    'netIncome': float(net_income if self.stock else self.stock_data.get('net_income_ttm', 0)),
                    'depreciation': float(non_cash_charges if self.stock else self.stock_data.get('depreciation', 0)),
                    'interestExpense': float(interest_expense if self.stock else self.stock_data.get('interest_expense', 0)),
                    'interestAfterTax': float(interest_after_tax),
                    'workingCapitalInvestment': float(working_capital_investment if self.stock else self.stock_data.get('working_capital_change', 0)),
                    'fixedCapitalInvestment': float(fixed_capital_investment if self.stock else -abs(self.stock_data.get('capex', 0))),
                    # Detailed breakdown for Excel
                    'receivablesChange': float(receivables_change) if self.stock else 0,
                    'inventoriesChange': float(inventories_change) if self.stock else 0,
                    'payablesChange': float(payables_change) if self.stock else 0,
                    'shortTermDebt': float(short_term_debt) if self.stock else 0,
                    'longTermDebt': float(long_term_debt) if self.stock else 0,
                },
                'assumptions': {
                    'wacc': float(wacc),
                    'shortTermGrowth': float(short_term_growth),
                    'terminalGrowth': float(terminal_growth),
                    'forecastYears': int(forecast_years),
                    'taxRate': float(tax_rate)
                }
            }

            # LOG CALCULATION DETAILS
            if logging_enabled:
                try:
                    print(f"\n{'='*60}")
                    print(f"🏢 FCFF CALCULATION LOG: {self.stock_symbol or 'Custom Data'}")
                    print(f"{'='*60}")
                    inp = detailed_result['inputs']
                    print(f" (+) Net Income:                {inp['netIncome']:20,.0f}")
                    print(f" (+) Interest (After Tax):      {inp['interestAfterTax']:20,.0f} (Exp: {inp['interestExpense']:,.0f})")
                    print(f" (+) Depreciation:              {inp['depreciation']:20,.0f}")
                    print(f" (-) Working Capital Inv:       {inp['workingCapitalInvestment']:20,.0f}")
                    print(f" (+) Fixed Capital Inv (CapEx): {inp['fixedCapitalInvestment']:20,.0f}")
                    print(f"{'-'*60}")
                    print(f" (=) Base FCFF:                 {detailed_result['baseFCFF']:20,.0f}")
                    print(f"Enterprise Value:               {detailed_result['enterpriseValue']:20,.0f}")
                    print(f" (-) Total Debt:                {detailed_result['totalDebt']:20,.0f}")
                    print(f" (+) Cash:                      {detailed_result['cash']:20,.0f}")
                    print(f"Equity Value:                   {detailed_result['equityValue']:20,.0f}")
                    print(f"Fair Value per Share:           {detailed_result['shareValue']:20,.0f} VND")
                    print(f"{'='*60}\n")
                except Exception as e:
                    print(f"Error logging FCFF: {e}")

            return detailed_result

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'shareValue': 0, 'error': str(e)}
    
    def calculate_graham(self, assumptions, known_sector=None):
        """
        Graham Number Valuation
        Formula: sqrt(22.5 × EPS × BVPS)
        22.5 = 15 (max P/E) × 1.5 (max P/B) per Graham's rule
        Returns: value per share in VND
        """
        try:
            data_frequency = assumptions.get('data_frequency', 'year')
            shares_outstanding = self.get_shares_outstanding()

            # Get EPS
            eps = 0
            if self.stock_data:
                eps = self.stock_data.get('eps', 0) or self.stock_data.get('eps_ttm', 0) or self.stock_data.get('earnings_per_share', 0)
            if eps == 0 and self.stock:
                income_data = self.get_cached_income_data(period=data_frequency)
                _, proc = self.check_data_frequency(income_data.copy(), data_frequency)
                net_income = self.find_financial_value(proc, ['Net Profit For the Year', 'net_profit_parent_company', 'net_profit'], proc.shape[0] > 1)
                eps = net_income / shares_outstanding if shares_outstanding > 0 else 0

            # Get BVPS
            bvps = 0
            if self.stock_data:
                bvps = self.stock_data.get('bvps', 0) or self.stock_data.get('book_value_per_share', 0)
            if bvps == 0 and self.stock:
                balance_data = self.get_cached_balance_data(period=data_frequency)
                _, proc_b = self.check_data_frequency(balance_data.copy(), data_frequency)
                equity_cols = ['Total Equity', 'Total shareholders equity', 'Vốn chủ sở hữu', 'Tổng vốn chủ sở hữu']
                total_equity = self.find_financial_value(proc_b, equity_cols, False)
                if total_equity == 0:
                    ta = self.find_financial_value(proc_b, ['Total Assets', 'TOTAL ASSETS'], False)
                    tl = self.find_financial_value(proc_b, ['Total Liabilities', 'TOTAL LIABILITIES'], False)
                    total_equity = ta - tl if ta > 0 else 0
                bvps = total_equity / shares_outstanding if shares_outstanding > 0 else 0

            if eps <= 0 or bvps <= 0:
                print(f"⚠️ Graham: EPS={eps:.2f} or BVPS={bvps:.2f} is non-positive, cannot calculate")
                return 0

            graham_value = (22.5 * eps * bvps) ** 0.5
            print(f"📐 Graham: √(22.5 × {eps:,.0f} × {bvps:,.0f}) = {graham_value:,.0f} VND")
            return float(graham_value)

        except Exception as e:
            print(f"❌ Graham error: {e}")
            return 0

    def calculate_justified_ps(self, assumptions, known_sector=None):
        """
        Comparable P/S Valuation (Price-to-Sales)
        Formula: Sector Median P/S × Revenue per Share
        Returns: value per share in VND
        """
        try:
            data_frequency = assumptions.get('data_frequency', 'year')
            shares_outstanding = self.get_shares_outstanding()

            # Get revenue per share
            revenue_per_share = 0
            if self.stock_data:
                revenue = self.stock_data.get('revenue_ttm', 0) or self.stock_data.get('revenue', 0)
                if revenue > 0 and shares_outstanding > 0:
                    revenue_per_share = revenue / shares_outstanding

            if revenue_per_share == 0 and self.stock:
                income_data = self.get_cached_income_data(period=data_frequency)
                _, proc = self.check_data_frequency(income_data.copy(), data_frequency)
                is_quarterly = proc.shape[0] > 1
                revenue = self.find_financial_value(proc, [
                    'Net Revenue', 'Revenue', 'Net revenue', 'Net sales',
                    'net_revenue', 'revenue', 'sales'
                ], is_quarterly)
                if revenue > 0 and shares_outstanding > 0:
                    revenue_per_share = revenue / shares_outstanding

            if revenue_per_share <= 0:
                print(f"⚠️ P/S: Revenue per share is {revenue_per_share:.2f}, cannot calculate")
                return 0

            # Get sector median P/S
            peer_data = self.get_sector_peers(num_peers=10, known_sector=known_sector)
            median_ps = peer_data.get('median_ps')

            # Fallback to market average if no peer data
            if median_ps is None or median_ps <= 0:
                print(f"⚠️ P/S: No sector median P/S found, using market average of 1.5x")
                median_ps = 1.5

            ps_value = median_ps * revenue_per_share
            print(f"💰 P/S: RevPS={revenue_per_share:,.0f} × Median PS={median_ps:.2f} = {ps_value:,.0f} VND")
            return float(ps_value)

        except Exception as e:
            print(f"❌ P/S error: {e}")
            return 0

    def calculate_dividend_discount(self, assumptions):
        """
        Calculate Dividend Discount Model
        Not currently used but kept for future implementation
        """
        try:
            data = self.stock_data

            # Get assumptions
            growth_rate = assumptions.get('revenue_growth', 0.08)
            terminal_growth = assumptions.get('terminal_growth', 0.03)
            required_return = assumptions.get('required_return_equity', 0.12)

            # Get financial data
            eps = data.get('earnings_per_share', 0)
            dividend_payout_ratio = 0.3  # Assume 30% payout

            # Calculate dividend per share
            dividend_per_share = eps * dividend_payout_ratio

            # Apply Gordon Growth Model
            if required_return <= terminal_growth:
                return 0

            value_per_share = dividend_per_share * (1 + terminal_growth) / (required_return - terminal_growth)

            return value_per_share

        except Exception as e:
            return 0

    def calculate_justified_pe(self, assumptions, known_sector=None):
        """
        Calculate Comparable P/E Valuation
        Method: Find median P/E of top 10 stocks in same sector (by market cap)
        Fair Value = Median P/E × EPS
        Returns: value per share in VND
        """
        try:
            data_frequency = assumptions.get('data_frequency', 'year')
            shares_outstanding = self.get_shares_outstanding()
            
            # Get current EPS - prioritize EPS from ratio API or stock_data
            current_eps = 0
            
            # First try to get EPS from stock_data (pre-calculated from ratio API)
            if self.stock_data:
                current_eps = self.stock_data.get('eps', 0) or self.stock_data.get('eps_ttm', 0) or self.stock_data.get('earnings_per_share', 0)
            
            # If no EPS from stock_data, try vnstock ratio
            if current_eps == 0 and self.stock:
                try:
                    ratio_data = self.stock.finance.ratio(period=data_frequency, lang='en', dropna=True)
                    if not ratio_data.empty:
                        # Look for EPS column (could be named differently)
                        eps_columns = [col for col in ratio_data.columns if 'earn_per_share' in str(col).lower() or 'eps' in str(col).lower()]
                        if eps_columns:
                            latest_eps = ratio_data[eps_columns[0]].dropna().iloc[0] if not ratio_data[eps_columns[0]].dropna().empty else 0
                            current_eps = float(latest_eps) if pd.notna(latest_eps) else 0
                except Exception as e:
                    print(f"⚠️ Failed to get EPS from ratio: {e}")
            
            # Final fallback: calculate from net_income / shares
            if current_eps == 0 and self.stock:
                income_data = self.get_cached_income_data(period=data_frequency)
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                is_quarterly = actual_freq == 'quarter'
                net_income = self.find_financial_value(processed_income, ['Net Profit For the Year'], is_quarterly)
                current_eps = net_income / shares_outstanding if shares_outstanding > 0 else 0
                print(f"⚠️ Using calculated EPS: {net_income:,.0f} / {shares_outstanding:,.0f} = {current_eps:,.2f}")
            elif current_eps == 0:
                net_income = self.stock_data.get('net_income_ttm', 0)
                current_eps = net_income / shares_outstanding if shares_outstanding > 0 else 0
            
            if current_eps <= 0:
                print(f"⚠️ P/E Valuation: EPS is {current_eps:.2f} (<=0), cannot calculate")
                return 0
            
            # Get sector peers and median P/E
            peer_data = self.get_sector_peers(num_peers=10, known_sector=known_sector)
            median_pe = peer_data.get('median_pe')
            
            if median_pe is None or median_pe <= 0:
                # Fallback to market average P/E (15x)
                print(f"⚠️ No sector peers found, using market average P/E of 15x")
                median_pe = 15.0
            
            # Fair Value = Median P/E × EPS
            per_share_pe = median_pe * current_eps
            
            print(f"📈 P/E Valuation: EPS={current_eps:,.0f} × Median PE={median_pe:.2f} = {per_share_pe:,.0f} VND")
            
            return per_share_pe

        except Exception as e:
            print(f"❌ P/E Valuation error: {e}")
            return 0

    def calculate_justified_pb(self, assumptions, known_sector=None):
        """
        Calculate Comparable P/B Valuation
        Method: Find median P/B of top 10 stocks in same sector (by market cap)
        Fair Value = Median P/B × BVPS
        Returns: value per share in VND
        """
        try:
            data_frequency = assumptions.get('data_frequency', 'year')
            shares_outstanding = self.get_shares_outstanding()
            
            # Get Book Value per Share - prioritize BVPS from stock_data or ratio API
            bvps = 0
            
            # First try to get BVPS from stock_data (pre-calculated from ratio API)
            if self.stock_data:
                bvps = self.stock_data.get('bvps', 0) or self.stock_data.get('book_value_per_share', 0)
            
            # If no BVPS from stock_data, try vnstock ratio
            if bvps == 0 and self.stock:
                try:
                    ratio_data = self.stock.finance.ratio(period=data_frequency, lang='en', dropna=True)
                    if not ratio_data.empty:
                        # Look for BVPS column
                        bvps_columns = [col for col in ratio_data.columns if 'book_value_per_share' in str(col).lower() or 'bvps' in str(col).lower()]
                        if bvps_columns:
                            latest_bvps = ratio_data[bvps_columns[0]].dropna().iloc[0] if not ratio_data[bvps_columns[0]].dropna().empty else 0
                            bvps = float(latest_bvps) if pd.notna(latest_bvps) else 0
                except Exception as e:
                    print(f"⚠️ Failed to get BVPS from ratio: {e}")
            
            # Final fallback: calculate from equity / shares
            if bvps == 0 and self.stock:
                balance_sheet = self.get_cached_balance_data(period=data_frequency)
                _, processed_balance = self.check_data_frequency(balance_sheet.copy(), data_frequency)
                
                # Try multiple equity column names
                equity_names = [
                    'Total Equity', 'Shareholders Equity', 'Total shareholders equity', 
                    'Total Shareholders Equity', 'Equity', 'Total equity',
                    'Vốn chủ sở hữu', 'Tổng vốn chủ sở hữu'
                ]
                
                total_equity = 0
                for col in processed_balance.columns:
                    col_lower = str(col).lower()
                    for equity_name in equity_names:
                        if equity_name.lower() in col_lower:
                            values = processed_balance[col]
                            if values.notna().any():
                                valid_values = values.dropna()
                                if not valid_values.empty:
                                    total_equity = float(valid_values.iloc[0])
                                    break
                    if total_equity > 0:
                        break
                
                # Fallback: assets - liabilities
                if total_equity == 0:
                    total_assets = self.find_financial_value(processed_balance, ['Total Assets', 'TOTAL ASSETS'], False)
                    total_liabilities = self.find_financial_value(processed_balance, ['Total Liabilities', 'TOTAL LIABILITIES'], False)
                    if total_assets > 0:
                        total_equity = total_assets - total_liabilities
                
                bvps = total_equity / shares_outstanding if shares_outstanding > 0 else 0
                print(f"⚠️ Using calculated BVPS: {total_equity:,.0f} / {shares_outstanding:,.0f} = {bvps:,.2f}")
            elif bvps == 0:
                total_equity = self.stock_data.get('total_equity', 0)
                bvps = total_equity / shares_outstanding if shares_outstanding > 0 else 0
            
            if bvps <= 0:
                print(f"⚠️ P/B Valuation: BVPS is {bvps:.2f} (<=0), cannot calculate")
                return 0
            
            # Get sector peers and median P/B (reuse cached data from P/E call)
            peer_data = self.get_sector_peers(num_peers=10, known_sector=known_sector)
            median_pb = peer_data.get('median_pb')
            
            if median_pb is None or median_pb <= 0:
                # Fallback to market average P/B (1.5x)
                print(f"⚠️ No sector peers found, using market average P/B of 1.5x")
                median_pb = 1.5
            
            # Fair Value = Median P/B × BVPS
            per_share_pb = median_pb * bvps
            
            print(f"📊 P/B Valuation: BVPS={bvps:,.0f} × Median PB={median_pb:.2f} = {per_share_pb:,.0f} VND")
            
            return per_share_pb

        except Exception as e:
            print(f"❌ P/B Valuation error: {e}")
            return 0
# Export the class
if __name__ == "__main__":
    # Testing
    mock_data = {
        'revenue_ttm': 2000000000000,    # 2T VND
        'net_income_ttm': 200000000000,  # 200B VND
        'ebit': 300000000000,            # 300B VND
        'ebitda': 400000000000,          # 400B VND
        'total_assets': 10000000000000,  # 10T VND
        'total_debt': 3000000000000,     # 3T VND
        'total_liabilities': 6000000000000, # 6T VND
        'cash': 1000000000000,           # 1T VND
        'depreciation': 100000000000,    # 100B VND
        'fcfe': 150000000000,            # 150B VND
        'capex': -200000000000,          # -200B VND
        'shares_outstanding': 1000000000,
    }

    default_assumptions = {
        'revenue_growth': 0.08,
        'terminal_growth': 0.03,
        'wacc': 0.10,
        'required_return_equity': 0.12,
        'tax_rate': 0.20,
        'projection_years': 5,
        'model_weights': {'dcf': 0.5, 'fcfe': 0.5}
    }

    models = ValuationModels(mock_data)
    results = models.calculate_all_models(default_assumptions)

    for model, value in results.items():
        pass
