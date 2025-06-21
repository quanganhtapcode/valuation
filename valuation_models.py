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

    #