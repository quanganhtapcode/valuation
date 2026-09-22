import threading

from backend.stock_provider import StockDataProvider
from backend.services.valuation_service import ValuationService
from backend.services.stock_service import StockService
from backend.data_sources.sqlite_db import SQLiteDB
from backend.db_path import resolve_vci_screening_db_path

# Global instances — protected by _init_lock to prevent race conditions
_init_lock = threading.Lock()
stock_provider = None
valuation_service = None
stock_service = None
_resolved_db_path = None

def init_provider():
    global stock_provider, valuation_service, stock_service, _resolved_db_path

    with _init_lock:
        if not _resolved_db_path:
            _resolved_db_path = resolve_vci_screening_db_path()
        db_path = _resolved_db_path

        if stock_provider is None:
            stock_provider = StockDataProvider()

        if valuation_service is None:
            valuation_service = ValuationService()

        if stock_service is None:
            sqlite_db = SQLiteDB(db_path)
            stock_service = StockService(sqlite_db)

    return stock_provider

def get_provider():
    if stock_provider is None:
        init_provider()
    return stock_provider

def get_valuation_service():
    if valuation_service is None:
        init_provider()
    return valuation_service

def get_stock_service():
    if stock_service is None:
        init_provider()
    return stock_service
