import threading

from backend.stock_provider import StockDataProvider
from backend.services.valuation_service import ValuationService
from backend.services.stock_service import StockService

# Global instances — protected by _init_lock to prevent race conditions
_init_lock = threading.Lock()
stock_provider = None
valuation_service = None
stock_service = None

def init_provider():
    global stock_provider, valuation_service, stock_service

    with _init_lock:
        if stock_provider is None:
            stock_provider = StockDataProvider()

        if valuation_service is None:
            valuation_service = ValuationService()

        if stock_service is None:
            stock_service = StockService()

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
