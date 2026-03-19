from typing import List, Dict, Any, Optional
from backend.data_sources.sqlite_db import SQLiteDB

class StockService:
    def __init__(self, db: SQLiteDB):
        self.db = db

    def get_company_profile(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self.db.get_company(symbol)

    def search_stocks(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        return self.db.search_companies(query, limit)

    def get_all_symbols(self) -> List[str]:
        return self.db.get_all_symbols()

    def get_stock_overview(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self.db.get_stock_overview(symbol)
