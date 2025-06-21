import numpy as np
import pandas as pd
from vnstock import Vnstock

class ValuationModels:
    """
    Comprehensive financial valuation models for Vietnamese stocks
    Implements 4 models: FCFE, FCFF, Justified P/E, and Justified P/B
    """
    def __init__(self, stock_data=None, stock_symbol=None):
        """Initialize with stock data from API"""
        self.stock_data = stock_data or {}
        self.stock_symbol = stock_symbol
        self.vnstock_instance = Vnstock()
        self.stock = None
        if stock_symbol:
            self.stock = self.vnstock_instance.stock(symbol=stock_symbol, source='VCI')

    def calculate_all_models(self, assumptions):
        """Calculate all 4 valuation models with given assumptions"""
        if not self.stock_symbol and not self.stock_data:
            return {'error': 'No stock data or symbol available'}

        print(f"DEBUG: Starting calculate_all_models for {self.stock_symbol}")
        
        results = {}
        
        # Calculate FCFE first
        print("DEBUG: Calling calculate_fcfe...")
        try:
            fcfe_result = self.calculate_fcfe(assumptions)
            results['fcfe'] = fcfe_result
            print(f"DEBUG: FCFE result: {fcfe_result}")
        except Exception as e:
            print(f"DEBUG: FCFE failed with error: {e}")
            results['fcfe'] = 0
            
        # Calculate FCFF
        print("DEBUG: Calling calculate_fcff...")
        try:
            fcff_result = self.calculate_fcff(assumptions)
            results['fcff'] = fcff_result
            print(f"DEBUG: FCFF result: {fcff_result}")
        except Exception as e:
            print(f"DEBUG: FCFF failed with error: {e}")
            results['fcff'] = 0
            
        # Calculate Justified P/E
        print("DEBUG: Calling calculate_justified_pe...")
        try:
            pe_result = self.calculate_justified_pe(assumptions)
            results['justified_pe'] = pe_result
            print(f"DEBUG: P/E result: {pe_result}")
        except Exception as e:
            print(f"DEBUG: P/E failed with error: {e}")
            results['justified_pe'] = 0
            
        # Calculate Justified P/B
        print("DEBUG: Calling calculate_justified_pb...")
        try:
            pb_result = self.calculate_justified_pb(assumptions)
            results['justified_pb'] = pb_result
            print(f"DEBUG: P/B result: {pb_result}")
        except Exception as e:
            print(f"DEBUG: P/B failed with error: {e}")
            results['justified_pb'] = 0

        results['weighted_average'] = 0
        results['summary'] = {}

        print(f"DEBUG: All results before filtering: {results}")

        # Calculate weighted average of valid models
        model_weights = assumptions.get('model_weights', {
            'fcfe': 0.25, 'fcff': 0.25, 'justified_pe': 0.25, 'justified_pb': 0.25
        })
        
        valid_models = {k: v for k, v in results.items() 
                       if k in model_weights and isinstance(v, (int, float)) and v > 0}

        print(f"DEBUG: Valid models: {valid_models}")

        if valid_models:
            total_weight = sum(model_weights[k] for k in valid_models.keys())
            if total_weight > 0:
                results['weighted_average'] = sum(
                    valid_models[k] * model_weights[k] for k in valid_models.keys()
                ) / total_weight
                
                # Add summary statistics
                values = list(valid_models.values())
                results['summary'] = {
                    'average': np.mean(values),
                    'min': min(values),
                    'max': max(values),
                    'models_used': len(values),
                    'total_models': 4
                }

        print(f"DEBUG: Final results: {results}")
        return results

    # ===================================================
    # HELPER FUNCTIONS
    # ===================================================
    
    def check_data_frequency(self, data, expected_frequency):
        """Check if data is yearly or quarterly, sort, and filter latest quarters if needed."""
        time_cols = [col for col in data.columns if any(kw in col.lower() for kw in ['year', 'quarter', 'date', 'time'])]
        quarter_col = [col for col in data.columns if 'lengthReport' in col or 'quarter' in col.lower()]
        
        if not time_cols and not quarter_col:
            print("No time or quarter columns found, assuming requested frequency.")
            return expected_frequency, data
        
        # Handle quarterly data with yearReport and lengthReport
        if 'yearReport' in data.columns and 'lengthReport' in data.columns:
            print("Detected yearReport and lengthReport for quarter data.")
            data = data.copy()
            data['yearReport'] = data['yearReport'].astype(float)
            data['lengthReport'] = data['lengthReport'].astype(float)
            data = data.sort_values(['yearReport', 'lengthReport'], ascending=[False, False]).reset_index(drop=True)
            
            if expected_frequency == 'quarter':
                latest_quarters = data.head(4)
                quarter_labels = [f"{int(row['yearReport'])}Q{int(row['lengthReport'])}" for _, row in latest_quarters.iterrows()]
                print(f"Summing quarters: {', '.join(quarter_labels)}")
                if len(latest_quarters) < 4:
                    print(f"Warning: Only {len(latest_quarters)} quarter(s) available.")
                return 'quarter', latest_quarters
            else:
                latest_year = data[data['lengthReport'] == 4].head(1) if not data[data['lengthReport'] == 4].empty else data.head(1)
                if not latest_year.empty:
                    print(f"Using year: {int(latest_year['yearReport'].iloc[0])}")
                return 'year', latest_year
        
        # Handle other datetime columns
        time_col = time_cols[0] if time_cols else None
        if time_col:
            try:
                data[time_col] = pd.to_datetime(data[time_col], errors='coerce')
                if data[time_col].notna().any():
                    print(f"Parsed '{time_col}' as datetime.")
                    data = data.sort_values(time_col, ascending=False).reset_index(drop=True)
                    if expected_frequency == 'quarter':
                        latest_quarters = data.head(4)
                        print(f"Summing quarters from datetime: {latest_quarters[time_col].tolist()}")
                        return 'quarter', latest_quarters
                    else:
                        latest_year = data.head(1)
                        print(f"Using latest year from datetime: {latest_year[time_col].iloc[0]}")
                        return 'year', latest_year
            except Exception as e:
                print(f"Error parsing datetime: {e}")
        
        return expected_frequency, data.head(1)

    def find_financial_value(self, data, column_names, is_quarterly=False):
        """Find and return value for given column names, following original logic."""
        total = 0
        matched_columns = []
        
        if data.empty:
            return 0
        
        for target_col in column_names:
            found = False
            for data_col in data.columns:
                # Check for exact match (case insensitive)
                if target_col.lower() == data_col.lower():
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
            print(f"  Found: {', '.join(matched_columns)}")
        
        return total

    def get_shares_outstanding(self):
        """Get shares outstanding from stock data"""
        if not self.stock:
            return self.stock_data.get('shares_outstanding', 1_000_000_000)
            
        try:
            price_board = self.stock.trading.price_board([self.stock_symbol])
            shares_outstanding = 1_000_000_000  # Default
            for col in price_board.columns:
                if 'listed_share' in str(col).lower():
                    shares_outstanding = price_board[col].iloc[0]
                    break
            return shares_outstanding
        except:
            return self.stock_data.get('shares_outstanding', 1_000_000_000)
      # ===================================================
    # VALUATION MODELS
    # ===================================================
    
    def calculate_fcfe(self, assumptions):
        """
        Calculate FCFE (Free Cash Flow to Equity) Valuation - CORRECTED
        Returns: value per share in VND
        """
        print("DEBUG: Entering FCFE method")
        try:
            print("DEBUG: FCFE try block started")
            print("\n" + "="*50)
            print("FCFE VALUATION (CORRECTED)")
            print("="*50)
            
            # Get assumptions - use revenue_growth as fallback for short_term_growth
            short_term_growth = assumptions.get('short_term_growth', 
                                               assumptions.get('revenue_growth', 0.05))
            terminal_growth = assumptions.get('terminal_growth', 0.02)
            wacc = assumptions.get('wacc', 0.10)
            tax_rate = assumptions.get('tax_rate', 0.20)
            forecast_years = assumptions.get('forecast_years', 5)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            print(f"DEBUG: FCFE assumptions loaded successfully")
            print(f"FCFE assumptions: short_term_growth={short_term_growth}, terminal_growth={terminal_growth}")
            
            shares_outstanding = self.get_shares_outstanding()
            print(f"DEBUG: Shares outstanding: {shares_outstanding:,.0f}")
            
            # Use stock data if available, otherwise use provided data
            if self.stock:
                print("DEBUG: Using live stock data...")
                # Fetch financial data
                income_data = self.stock.finance.income_statement(period=data_frequency, dropna=False)
                cash_flow_data = self.stock.finance.cash_flow(period=data_frequency, dropna=False)
                print("DEBUG: Financial data fetched successfully")
                
                # Process data frequency
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                _, processed_cash_flow = self.check_data_frequency(cash_flow_data.copy(), data_frequency)
                is_quarterly = actual_freq == 'quarter'
                print("DEBUG: Data frequency processed successfully")
                
                print("\nFCFE Components:")
                
                # Net Income
                net_income = self.find_financial_value(processed_income, ['Net Profit For the Year'], is_quarterly)
                print(f"Net Income: {net_income:,.0f} VND")
                
                # Non-Cash Charges (Depreciation)
                non_cash_charges = self.find_financial_value(processed_cash_flow, ['Depreciation and Amortisation'], is_quarterly)
                print(f"Non-Cash Charges: {non_cash_charges:,.0f} VND")
                
                # Working Capital Investment
                receivables_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in receivables'], is_quarterly)
                inventories_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in inventories'], is_quarterly)
                payables_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in payables'], is_quarterly)
                working_capital_investment = receivables_change + inventories_change - payables_change
                
                # Fixed Capital Investment
                fixed_capital_investment = self.find_financial_value(processed_cash_flow, 
                                                                   ['Purchase of fixed assets', 'Proceeds from disposal of fixed assets'], 
                                                                   is_quarterly)
                
                # Net Borrowing
                proceeds_borrowings = self.find_financial_value(processed_cash_flow, ['Proceeds from borrowings'], is_quarterly)
                repayment_borrowings = self.find_financial_value(processed_cash_flow, ['Repayment of borrowings'], is_quarterly)
                net_borrowing = proceeds_borrowings + repayment_borrowings
                
                # FCFE CALCULATION
                fcfe = net_income + non_cash_charges + net_borrowing - working_capital_investment + fixed_capital_investment
                print("DEBUG: FCFE calculation completed")
                
            else:
                print("DEBUG: Using provided stock data...")
                # Use provided stock data
                net_income = self.stock_data.get('net_income_ttm', 0)
                depreciation = self.stock_data.get('depreciation', 0)
                capex = abs(self.stock_data.get('capex', 0))
                net_borrowing = self.stock_data.get('net_borrowing', 0)
                working_capital_change = self.stock_data.get('working_capital_change', 0)
                
                fcfe = net_income + depreciation + net_borrowing - working_capital_change - capex
                
                print(f"\nFCFE Components (from provided data):")
                print(f"Net Income: {net_income:,.0f} VND")
                print(f"Depreciation: {depreciation:,.0f} VND")
                print(f"Net Borrowing: {net_borrowing:,.0f} VND")
                print(f"Working Capital Change: {working_capital_change:,.0f} VND")
                print(f"CapEx: {capex:,.0f} VND")
            
            print(f"\nFCFE = {fcfe:,.0f} VND")
            
            # Project and discount
            future_fcfes = [fcfe * ((1 + short_term_growth) ** year) for year in range(1, forecast_years + 1)]
            terminal_value = future_fcfes[-1] * (1 + terminal_growth) / (wacc - terminal_growth)
            pv_fcfes = [fcfe_val / ((1 + wacc) ** year) for year, fcfe_val in enumerate(future_fcfes, 1)]
            pv_terminal = terminal_value / ((1 + wacc) ** forecast_years)
            
            total_equity_value = sum(pv_fcfes) + pv_terminal
            per_share_fcfe = total_equity_value / shares_outstanding
            
            print(f"\nFCFE Valuation Results:")
            print(f"Total Equity Value: {total_equity_value:,.0f} VND")
            print(f"Per Share Value (FCFE): {per_share_fcfe:,.0f} VND")
            
            return per_share_fcfe

        except Exception as e:
            print(f"FCFE calculation failed: {e}")
            import traceback
            traceback.print_exc()
            return 0
    
    def calculate_fcff(self, assumptions):
        """
        Calculate FCFF (Free Cash Flow to Firm) Valuation - CORRECTED
        Returns: value per share in VND
        """
        try:
            print("\n" + "="*50)
            print("FCFF VALUATION (CORRECTED)")
            print("="*50)
            
            # Get assumptions
            short_term_growth = assumptions.get('short_term_growth', 0.05)
            terminal_growth = assumptions.get('terminal_growth', 0.02)
            wacc = assumptions.get('wacc', 0.10)
            tax_rate = assumptions.get('tax_rate', 0.20)
            forecast_years = assumptions.get('forecast_years', 5)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            shares_outstanding = self.get_shares_outstanding()
            
            # Use stock data if available, otherwise use provided data
            if self.stock:
                # Fetch financial data
                income_data = self.stock.finance.income_statement(period=data_frequency, dropna=False)
                cash_flow_data = self.stock.finance.cash_flow(period=data_frequency, dropna=False)
                
                # Process data frequency
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                _, processed_cash_flow = self.check_data_frequency(cash_flow_data.copy(), data_frequency)
                is_quarterly = actual_freq == 'quarter'
                
                print("\nFCFF Components:")
                
                # Net Income
                net_income = self.find_financial_value(processed_income, ['Net Profit For the Year'], is_quarterly)
                print(f"Net Income: {net_income:,.0f} VND")
                
                # Non-Cash Charges (Depreciation)
                non_cash_charges = self.find_financial_value(processed_cash_flow, ['Depreciation and Amortisation'], is_quarterly)
                print(f"Non-Cash Charges: {non_cash_charges:,.0f} VND")
                
                # Interest Expense After Tax (FCFF specific)
                interest_expense = self.find_financial_value(processed_income, ['Interest Expenses'], is_quarterly)
                interest_after_tax = interest_expense * (1 - tax_rate)
                print(f"Interest After Tax: {interest_after_tax:,.0f} VND")
                
                # Working Capital Investment
                receivables_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in receivables'], is_quarterly)
                inventories_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in inventories'], is_quarterly)
                payables_change = self.find_financial_value(processed_cash_flow, ['Increase/Decrease in payables'], is_quarterly)
                working_capital_investment = receivables_change + inventories_change - payables_change
                
                # Fixed Capital Investment
                fixed_capital_investment = self.find_financial_value(processed_cash_flow, 
                                                                   ['Purchase of fixed assets', 'Proceeds from disposal of fixed assets'], 
                                                                   is_quarterly)
                
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
                
                fcff = net_income + depreciation + interest_after_tax - working_capital_change - capex
                
                print(f"\nFCFF Components (from provided data):")
                print(f"Net Income: {net_income:,.0f} VND")
                print(f"Depreciation: {depreciation:,.0f} VND")
                print(f"Interest After Tax: {interest_after_tax:,.0f} VND")
                print(f"Working Capital Change: {working_capital_change:,.0f} VND")
                print(f"CapEx: {capex:,.0f} VND")
            
            print(f"\nFCFF = {fcff:,.0f} VND")
            
            # Project and discount
            future_fcffs = [fcff * ((1 + short_term_growth) ** year) for year in range(1, forecast_years + 1)]
            terminal_value_fcff = future_fcffs[-1] * (1 + terminal_growth) / (wacc - terminal_growth)
            pv_fcffs = [fcff_val / ((1 + wacc) ** year) for year, fcff_val in enumerate(future_fcffs, 1)]
            pv_terminal_fcff = terminal_value_fcff / ((1 + wacc) ** forecast_years)
            
            total_firm_value = sum(pv_fcffs) + pv_terminal_fcff
            per_share_fcff = total_firm_value / shares_outstanding
            
            print(f"\nFCFF Valuation Results:")
            print(f"Total Firm Value: {total_firm_value:,.0f} VND")
            print(f"Per Share Value (FCFF): {per_share_fcff:,.0f} VND")
            
            return per_share_fcff

        except Exception as e:
            print(f"FCFF calculation failed: {e}")
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
            print(f"DDM calculation error: {e}")
            return 0

    def calculate_justified_pe(self, assumptions):
        """
        Calculate Justified P/E Valuation
        Returns: value per share in VND
        """
        try:
            print("\n" + "="*50)
            print("JUSTIFIED P/E VALUATION")
            print("="*50)
            
            # Get assumptions
            roe = assumptions.get('roe', 0.15)
            payout_ratio = assumptions.get('payout_ratio', 0.40)
            cost_of_equity = assumptions.get('cost_of_equity', 0.12)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            shares_outstanding = self.get_shares_outstanding()
            
            # Get current EPS
            if self.stock:
                income_data = self.stock.finance.income_statement(period=data_frequency, dropna=False)
                actual_freq, processed_income = self.check_data_frequency(income_data.copy(), data_frequency)
                is_quarterly = actual_freq == 'quarter'
                
                net_income = self.find_financial_value(processed_income, ['Net Profit For the Year'], is_quarterly)
                current_eps = net_income / shares_outstanding
            else:
                net_income = self.stock_data.get('net_income_ttm', 0)
                current_eps = net_income / shares_outstanding
            
            dividend_growth_rate = roe * (1 - payout_ratio)
            
            if cost_of_equity <= dividend_growth_rate:
                justified_pe = 15  # Default fallback
                print(f"Warning: Cost of equity must be > growth rate. Using default P/E = 15")
            else:
                justified_pe = (payout_ratio * (1 + dividend_growth_rate)) / (cost_of_equity - dividend_growth_rate)
            
            per_share_pe = justified_pe * current_eps
            
            print(f"Current EPS: {current_eps:,.0f} VND")
            print(f"Dividend Growth Rate: {dividend_growth_rate*100:.1f}%")
            print(f"Justified P/E Ratio: {justified_pe:.2f}")
            print(f"Per Share Value (P/E): {per_share_pe:,.0f} VND")
            
            return per_share_pe

        except Exception as e:
            print(f"P/E calculation failed: {e}")
            return 0

    def calculate_justified_pb(self, assumptions):
        """
        Calculate Justified P/B Valuation - IMPROVED
        Returns: value per share in VND
        """
        try:
            print("\n" + "="*50)
            print("JUSTIFIED P/B VALUATION (IMPROVED)")
            print("="*50)
            
            # Get assumptions
            roe = assumptions.get('roe', 0.15)
            payout_ratio = assumptions.get('payout_ratio', 0.40)
            cost_of_equity = assumptions.get('cost_of_equity', 0.12)
            data_frequency = assumptions.get('data_frequency', 'year')
            
            shares_outstanding = self.get_shares_outstanding()
            
            # Get balance sheet data
            if self.stock:
                balance_sheet = self.stock.finance.balance_sheet(period=data_frequency, dropna=False)
                _, processed_balance = self.check_data_frequency(balance_sheet.copy(), data_frequency)
                is_quarterly = processed_balance is not None
                
                print("\nSearching for equity data...")
                
                # Try multiple equity column names (comprehensive search)
                equity_names = [
                    'Total Equity', 'Shareholders Equity', 'Total shareholders equity', 
                    'Total Shareholders Equity', 'Stockholders Equity', 'Total Stockholders Equity',
                    'Vốn chủ sở hữu', 'Tổng vốn chủ sở hữu', 'Total shareholders equity',
                    'Equity', 'Total equity', 'shareholders equity', 'stockholders equity',
                    'Owner Equity', 'Owners Equity', 'Total Owner Equity'
                ]
                
                total_equity = 0
                equity_found = False
                
                # Search for equity with case-insensitive partial matching
                for col in processed_balance.columns:
                    col_lower = str(col).lower()
                    for equity_name in equity_names:
                        if equity_name.lower() in col_lower or col_lower in equity_name.lower():
                            values = processed_balance[col]
                            if values.notna().any():
                                valid_values = values.dropna()
                                if not valid_values.empty:
                                    if data_frequency == 'quarter':
                                        total_equity = float(valid_values.sum())
                                    else:
                                        total_equity = float(valid_values.iloc[0])
                                    print(f"  Found equity in column '{col}': {total_equity:,.0f} VND")
                                    equity_found = True
                                    break
                    if equity_found:
                        break
                
                # If still zero, try calculating from assets - liabilities
                if total_equity == 0:
                    print("\nEquity not found directly, calculating from Assets - Liabilities...")
                    
                    # Find total assets
                    asset_names = ['Total Assets', 'Total assets', 'assets', 'Assets', 'Tổng tài sản']
                    total_assets = 0
                    for col in processed_balance.columns:
                        col_lower = str(col).lower()
                        for asset_name in asset_names:
                            if asset_name.lower() in col_lower or col_lower in asset_name.lower():
                                values = processed_balance[col]
                                if values.notna().any():
                                    valid_values = values.dropna()
                                    if not valid_values.empty:
                                        total_assets = float(valid_values.iloc[0])
                                        print(f"  Found assets in column '{col}': {total_assets:,.0f} VND")
                                        break
                        if total_assets > 0:
                            break
                    
                    # Find total liabilities
                    liability_names = ['Total Liabilities', 'Total liabilities', 'liabilities', 'Liabilities', 'Tổng nợ phải trả']
                    total_liabilities = 0
                    for col in processed_balance.columns:
                        col_lower = str(col).lower()
                        for liability_name in liability_names:
                            if liability_name.lower() in col_lower or col_lower in liability_name.lower():
                                values = processed_balance[col]
                                if values.notna().any():
                                    valid_values = values.dropna()
                                    if not valid_values.empty:
                                        total_liabilities = float(valid_values.iloc[0])
                                        print(f"  Found liabilities in column '{col}': {total_liabilities:,.0f} VND")
                                        break
                        if total_liabilities > 0:
                            break
                    
                    if total_assets > 0 and total_liabilities >= 0:
                        total_equity = total_assets - total_liabilities
                        print(f"  Calculated equity: {total_assets:,.0f} - {total_liabilities:,.0f} = {total_equity:,.0f} VND")
                        
            else:
                # Use provided data
                total_equity = self.stock_data.get('total_equity', 0)
                if total_equity == 0:
                    total_assets = self.stock_data.get('total_assets', 0)
                    total_liabilities = self.stock_data.get('total_liabilities', 0)
                    total_equity = total_assets - total_liabilities
            
            if total_equity > 0:
                book_value_per_share = total_equity / shares_outstanding
                dividend_growth_rate = roe * (1 - payout_ratio)
                
                print(f"\nP/B Calculation Inputs:")
                print(f"  ROE: {roe*100:.1f}%")
                print(f"  Cost of Equity: {cost_of_equity*100:.1f}%")
                print(f"  Payout Ratio: {payout_ratio*100:.1f}%")
                print(f"  Dividend Growth Rate: {dividend_growth_rate*100:.1f}%")
                
                # Improved P/B calculation with better validation
                if cost_of_equity <= dividend_growth_rate:
                    justified_pb = 1.0  # Conservative default
                    print(f"Warning: Cost of equity ({cost_of_equity*100:.1f}%) must be > dividend growth rate ({dividend_growth_rate*100:.1f}%). Using default P/B = 1.0")
                elif roe <= dividend_growth_rate:
                    justified_pb = 1.0  # Conservative default
                    print(f"Warning: ROE ({roe*100:.1f}%) must be > dividend growth rate ({dividend_growth_rate*100:.1f}%). Using default P/B = 1.0")
                else:
                    justified_pb = (roe - dividend_growth_rate) / (cost_of_equity - dividend_growth_rate)
                    print(f"  Justified P/B = (ROE - g) / (r - g) = ({roe:.3f} - {dividend_growth_rate:.3f}) / ({cost_of_equity:.3f} - {dividend_growth_rate:.3f}) = {justified_pb:.2f}")
                
                per_share_pb = justified_pb * book_value_per_share
                
                print(f"\nP/B Valuation Results:")
                print(f"  Total Equity: {total_equity:,.0f} VND")
                print(f"  Book Value per Share: {book_value_per_share:,.0f} VND")
                print(f"  Justified P/B Ratio: {justified_pb:.2f}")
                print(f"  Per Share Value (P/B): {per_share_pb:,.0f} VND")
                
                return per_share_pb
            else:
                print("\nError: Could not find or calculate total equity data")
                return 0
                
        except Exception as e:
            print(f"P/B calculation failed: {e}")
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

    print("Testing Valuation Models with mock data:")
    for model, value in results.items():
        print(f"{model.upper()}: {value:,.2f} VND per share")
