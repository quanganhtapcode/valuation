from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.utils import validate_stock_symbol
from backend.db_path import resolve_price_history_db_path
from backend.data_sources.vci import VCIClient


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    def get_price_history_from_db(symbol: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """
        Fetch price history from SQLite database.
        
        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date
            
        Returns:
            List of price records
        """
        try:
            db_path = resolve_price_history_db_path()
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT time as date, open, high, low, close, volume
                FROM stock_price_history
                WHERE symbol = ? AND time >= ? AND time <= ?
                ORDER BY time ASC
            ''', (symbol, start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')))
            
            rows = cursor.fetchall()
            conn.close()
            
            if not rows:
                return []
            
            # Convert to list of dicts
            result = []
            for row in rows:
                result.append({
                    'date': row['date'],
                    'open': float(row['open']) if row['open'] is not None else 0.0,
                    'high': float(row['high']) if row['high'] is not None else 0.0,
                    'low': float(row['low']) if row['low'] is not None else 0.0,
                    'close': float(row['close']) if row['close'] is not None else 0.0,
                    'volume': float(row['volume']) if row['volume'] is not None else 0.0,
                })
            
            return result
            
        except Exception as e:
            logger.error(f"Error fetching price history from DB for {symbol}: {e}")
            return []
    
    def get_price_history_from_vci(symbol: str, start_date: datetime, end_date: datetime) -> List[Dict]:
        """
        Fetch price history from VCI API as fallback.
        
        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date
            
        Returns:
            List of price records
        """
        try:
            # Fetch from VCI API (single page for fallback)
            records = VCIClient.fetch_price_history_batch(symbol=symbol, pages=1, size=250, delay=0)
            
            if not records:
                return []
            
            # Filter by date range and convert format
            result = []
            for record in records:
                trading_date_str = str(record.get('tradingDate') or record.get('time') or record.get('date') or '')[:10]
                try:
                    trading_date = datetime.strptime(trading_date_str, '%Y-%m-%d')
                    if start_date <= trading_date <= end_date:
                        result.append({
                            'date': trading_date_str,
                            'open': float(record.get('openPrice') or record.get('open') or 0),
                            'high': float(record.get('highestPrice') or record.get('high') or 0),
                            'low': float(record.get('lowestPrice') or record.get('low') or 0),
                            'close': float(record.get('closePrice') or record.get('matchPrice') or record.get('close') or 0),
                            'volume': float(record.get('totalVolume') or record.get('totalMatchVolume') or record.get('volume') or 0),
                        })
                except (ValueError, TypeError):
                    continue
            
            return sorted(result, key=lambda x: x['date'])
            
        except Exception as e:
            logger.error(f"Error fetching price history from VCI for {symbol}: {e}")
            return []
    
    @stock_bp.route("/stock/history/<symbol>")
    def get_stock_history(symbol):
        """Get historical price data for charting (returns last 6M to 10Y based on param)."""
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result, "success": False}), 400
            symbol = result

            try:
                range_param = request.args.get("period", request.args.get("range", "6M")).upper()
                days_map = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365, "3Y": 1095, "5Y": 1825, "ALL": 1825}
                days_back = days_map.get(range_param, 180)

                end_date = datetime.now()
                start_date = end_date - timedelta(days=days_back)
                
                # Try database first
                history_data = get_price_history_from_db(symbol, start_date, end_date)
                
                # Fallback to VCI API if no DB data
                if not history_data:
                    logger.info(f"No DB data for {symbol}, falling back to VCI API")
                    history_data = get_price_history_from_vci(symbol, start_date, end_date)
                
                if not history_data:
                    return jsonify({"success": False, "message": "No historical data available"}), 404

                return jsonify({"symbol": symbol, "data": history_data, "count": len(history_data), "success": True})
            except Exception as e:
                logger.error(f"Error fetching history for {symbol}: {e}")
                return jsonify({"success": False, "error": str(e)}), 500
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/history/<symbol>")
    def api_history_legacy(symbol):
        """Legacy endpoint for history (flexible start/end dates)."""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=365)
            start_str = request.args.get("start", start_date.strftime("%Y-%m-%d"))
            end_str = request.args.get("end", end_date.strftime("%Y-%m-%d"))
            
            start_date = datetime.strptime(start_str, "%Y-%m-%d")
            end_date = datetime.strptime(end_str, "%Y-%m-%d")

            # Try database first
            history_data = get_price_history_from_db(symbol, start_date, end_date)
            
            # Fallback to VCI API if no DB data
            if not history_data:
                logger.info(f"No DB data for {symbol}, falling back to VCI API")
                history_data = get_price_history_from_vci(symbol, start_date, end_date)
            
            return jsonify({"success": True, "data": history_data})
        except Exception as exc:
            logger.error(f"Error in legacy history endpoint for {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

