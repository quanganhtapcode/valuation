import pandas as pd
from typing import Dict, List, Any, Optional
from backend.data_sources.financial_repository import FinancialRepository

class FinancialService:
    def __init__(self, repo: FinancialRepository):
        self.repo = repo

    def get_financial_reports(self, symbol: str, period: str = 'year', limit: int = 5) -> Dict[str, Any]:
        """
        Fetch normalized financial reports for a stock
        """
        reports = self.repo.get_financial_reports(symbol, period, limit)
        
        # Convert DataFrames to list of dicts for JSON serialization
        formatted_reports = {}
        for name, df in reports.items():
            formatted_reports[name] = df.to_dict('records')
            
        return formatted_reports

    def get_latest_ratios(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self.repo.get_latest_ratios(symbol)

    def get_industry_comparables(self, symbol: str) -> Dict[str, Any]:
        ratios = self.get_latest_ratios(symbol)
        if not ratios:
            return {}
            
        # Try to find peers based on industry from stock_industry table
        # (This logic can be more complex, but starting simple)
        peers = self.repo.get_industry_peers(symbol) # Placeholder for actual industry lookup
        return {
            'symbol': symbol,
            'ratios': ratios,
            'peers': peers
        }
