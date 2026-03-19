from flask import request
import re

def validate_stock_symbol(symbol: str) -> tuple[bool, str]:
    """Validate stock symbol format and sanitize input"""
    if not symbol or not isinstance(symbol, str):
        return False, "Invalid symbol type"
    
    # Remove whitespace and convert to uppercase
    symbol = symbol.strip().upper()
    
    # Check length (Vietnamese tickers are typically 3-4 characters)
    if len(symbol) < 2 or len(symbol) > 10:
        return False, "Symbol length must be 2-10 characters"
    
    # Allow only alphanumeric characters
    if not symbol.isalnum():
        return False, "Symbol must contain only letters and numbers"
    
    return True, symbol

def get_client_ip() -> str:
    """Get real client IP, accounting for proxies"""
    if request.headers.get('X-Forwarded-For'):
        # Take first IP if multiple (original client)
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    return request.remote_addr or 'unknown'
