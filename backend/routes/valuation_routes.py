from flask import Blueprint, jsonify, request
import logging
import time
import pandas as pd
from datetime import datetime
from backend.extensions import get_provider
from backend.models import ValuationModels
from vnstock import Vnstock

valuation_bp = Blueprint('valuation', __name__, url_prefix='/api/valuation')
logger = logging.getLogger(__name__)

# Cache for valuation results (Key: symbol_assumptions, Value: {results, timestamp})
valuation_cache = {}
VALUATION_CACHE_DURATION = 14400  # 4 hours

@valuation_bp.route("/<symbol>", methods=['GET', 'POST'])
def calculate_valuation(symbol):
    try:
        logger.info(f"Calculating valuation for {symbol}")
        if request.method == 'GET':
            # Support direct browser/API GET calls with default assumptions.
            request_data = {}
        else:
            request_data = request.get_json(silent=True) or {}
        provider = get_provider()
        
        # Create cache key from symbol + assumptions (not weights)
        cache_key_parts = [
            symbol.upper(),
            str(request_data.get('revenueGrowth', 5.0)),
            str(request_data.get('terminalGrowth', 2.0)),
            str(request_data.get('wacc', 10.0)),
            str(request_data.get('requiredReturn', 12.0)),
            str(request_data.get('taxRate', 20.0)),
            str(request_data.get('projectionYears', 5))
        ]
        cache_key = '_'.join(cache_key_parts)
        
        # Check cache first
        if cache_key in valuation_cache:
            cached_data = valuation_cache[cache_key]
            if time.time() - cached_data['timestamp'] < VALUATION_CACHE_DURATION:
                logger.info(f"✅ Using cached valuation for {symbol} (cache hit!)")
                
                # Recalculate weighted average with current weights
                model_weights = {
                    'fcfe': request_data.get('modelWeights', {}).get('fcfe', 25) / 100,
                    'fcff': request_data.get('modelWeights', {}).get('fcff', 25) / 100,
                    'justified_pe': request_data.get('modelWeights', {}).get('justified_pe', 25) / 100,
                    'justified_pb': request_data.get('modelWeights', {}).get('justified_pb', 25) / 100
                }
                
                results = cached_data['results']
                
                # Use a specific logic to recalculate weighted average based on cached results
                # We need to extract the raw values first
                raw_values = {
                    'fcfe': results['valuations'].get('fcfe', 0),
                    'fcff': results['valuations'].get('fcff', 0),
                    'justified_pe': results['valuations'].get('justified_pe', 0),
                    'justified_pb': results['valuations'].get('justified_pb', 0)
                }
                
                valid_models = {k: v for k, v in raw_values.items() if v > 0}
                
                if valid_models:
                    total_weight = sum(model_weights.get(k, 0) for k in valid_models.keys())
                    if total_weight > 0:
                        weighted_avg = sum(
                            valid_models[k] * model_weights.get(k, 0) for k in valid_models.keys()
                        ) / total_weight
                        results['valuations']['weighted_average'] = weighted_avg
                
                return jsonify(results)
        
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
        
        # Get current price from request (faster) or fetch if needed
        current_price_from_request = request_data.get('currentPrice')
        
        # Get financial data from request (faster) or fetch if needed
        financial_data_from_request = request_data.get('financialData')
        
        # Load EPS/BVPS from database instead of JSON files
        stock_data_from_file = {}
        try:
            db_overview = provider.db.get_stock_overview(symbol.upper())
            if db_overview:
                stock_data_from_file = {
                    'eps': db_overview.get('eps'),
                    'bvps': db_overview.get('bvps'),
                    'pe_ratio': db_overview.get('pe'),
                    'pb_ratio': db_overview.get('pb'),
                    'shares_outstanding': db_overview.get('market_cap', 0) / db_overview.get('current_price', 1) if db_overview.get('current_price') else 0
                }
        except Exception as e:
            logger.warning(f"Failed to load stock data from DB: {e}")
        
        # 1. Determine Fetch Source & Exchange
        cached_info = provider._stock_data_cache.get(symbol.upper(), {})
        if not cached_info:
             company_db = provider.db.get_company(symbol.upper())
             if company_db: cached_info = company_db
        
        exchange = cached_info.get('exchange', 'HOSE')
        is_upcom = "UPCOM" in str(exchange).upper()
        
        income_data = pd.DataFrame()
        balance_data = pd.DataFrame()
        cash_flow_data = pd.DataFrame()
        shares_outstanding = 0
        
        # 2. Get Shares Outstanding
        so_data = provider.get_stock_data(symbol.upper())
        if so_data and so_data.get('shares_outstanding'):
             shares_outstanding = so_data['shares_outstanding']
        
        # 3. Fetch Financials (Prioritize DB -> VNSTOCK)
        
        # Try DB first
        if not is_upcom:
             try:
                 income_data = provider.get_financial_df(symbol.upper(), 'income', 'year')
                 balance_data = provider.get_financial_df(symbol.upper(), 'balance', 'year')
                 cash_flow_data = provider.get_financial_df(symbol.upper(), 'cashflow', 'year')
             except Exception as e:
                 logger.warning(f"DB Fetch Error: {e}")
        
        # Fallback to VNSTOCK
        if (is_upcom or income_data.empty or balance_data.empty):
             try:
                 vnstock_instance = Vnstock()
                 stock = vnstock_instance.stock(symbol=symbol.upper(), source='VCI')
                 income_data = stock.finance.income_statement(period='year', dropna=False)
                 balance_data = stock.finance.balance_sheet(period='year', dropna=False)
                 cash_flow_data = stock.finance.cash_flow(period='year', dropna=False)
             except Exception as e:
                 logger.error(f"VNSTOCK fallback failed for {symbol}: {e}")

        # 4. Initialize Models with Pre-fetched Data
        valuation_model = ValuationModels(
            stock_data=stock_data_from_file, 
            stock_symbol=symbol.upper(),
            income_df=income_data,
            balance_df=balance_data,
            cash_flow_df=cash_flow_data
        )
        # Ensure model has the correct shares outstanding
        if shares_outstanding > 0:
            valuation_model._shares_outstanding_cache = shares_outstanding
            valuation_model.stock_data['shares_outstanding'] = shares_outstanding
        
        # 5. Calculate
        known_sector = None
        if financial_data_from_request:
            known_sector = financial_data_from_request.get('sector')
            
        results = valuation_model.calculate_all_models(assumptions, known_sector=known_sector)
        
        # 6. Prepare Response Financial Info
        financial_data = {
            'eps': 0, 'bvps': 0, 'net_income': 0, 'equity': 0, 'shares_outstanding': shares_outstanding
        }
        
        if not income_data.empty and not balance_data.empty:
            try:
                # Basic extraction for context
                # Note: This might be redundant if ValuationModels does it, but kept for API response consistency
                col_net_profit = [c for c in income_data.index if 'Net Profit' in str(c) or 'Lợi nhuận sau thuế' in str(c)]
                col_equity = [c for c in balance_data.index if 'EQUITY' in str(c).upper() or 'Vốn chủ sở hữu' in str(c)]
                
                if col_net_profit and not income_data.empty:
                    net_incomes = income_data.loc[col_net_profit[0]].values
                    if len(net_incomes) > 0:
                        financial_data['net_income'] = float(net_incomes[0]) # Most recent
                        
                if col_equity and not balance_data.empty:
                    equities = balance_data.loc[col_equity[0]].values
                    if len(equities) > 0:
                        financial_data['equity'] = float(equities[0]) # Most recent

                if shares_outstanding > 0:
                    financial_data['eps'] = financial_data['net_income'] / shares_outstanding
                    financial_data['bvps'] = financial_data['equity'] / shares_outstanding

            except Exception as e:
                logger.warning(f"Error preparing financial_data meta: {e}")

        # Extract share values helper
        def get_share_value(result):
            if isinstance(result, dict):
                return float(result.get('shareValue', 0))
            return float(result) if result else 0
        
        fcfe_result = results.get('fcfe', {})
        fcff_result = results.get('fcff', {})
        
        formatted_results = {
            'symbol': symbol.upper(),
            'valuations': {
                'fcfe': get_share_value(fcfe_result),
                'fcff': get_share_value(fcff_result),
                'justified_pe': float(results.get('justified_pe', 0)) if results.get('justified_pe') else 0,
                'justified_pb': float(results.get('justified_pb', 0)) if results.get('justified_pb') else 0,
                'weighted_average': float(results.get('weighted_average', 0)) if results.get('weighted_average') else 0
            },
            'fcfe_details': fcfe_result if isinstance(fcfe_result, dict) else {},
            'fcff_details': fcff_result if isinstance(fcff_result, dict) else {},
            'sector_peers': results.get('sector_peers'),
            'financial_data': financial_data,
            'summary': results.get('summary', {}),
            'sensitivity_analysis': results.get('sensitivity_analysis'),
            'assumptions_used': assumptions,
            'success': True,
            'timestamp': datetime.now().isoformat()
        }
        
        # Use current price from request if available (faster), otherwise fetch
        current_price = current_price_from_request
        
        if not current_price:
            try:
                stock_data = provider.get_stock_data(symbol.upper())
                if stock_data.get('success') and stock_data.get('current_price'):
                    current_price = stock_data['current_price']
            except Exception as e:
                logger.warning(f"Could not fetch current price for {symbol}: {e}")
        
        # Add market comparison if we have current price
        if current_price:
            avg_valuation = formatted_results['valuations']['weighted_average']
            if avg_valuation > 0:
                upside_downside = ((avg_valuation - current_price) / current_price) * 100
                formatted_results['market_comparison'] = {
                    'current_price': current_price,
                    'average_valuation': avg_valuation,
                    'upside_downside_pct': upside_downside,
                    'recommendation': 'BUY' if upside_downside > 10 else 'HOLD' if upside_downside > -10 else 'SELL'
                }
        
        # Cache the results
        valuation_cache[cache_key] = {
            'results': formatted_results,
            'timestamp': time.time()
        }
        logger.info(f"✅ Valuation cached for {symbol}")
        
        return jsonify(formatted_results)
    except Exception as exc:
        logger.error(f"Valuation calculation error for {symbol}: {exc}")
        return jsonify({
            "success": False,
            "error": str(exc),
            "symbol": symbol.upper()
        }), 500
