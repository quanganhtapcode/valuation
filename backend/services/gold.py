"""
Gold & Silver Price Service
Fetches precious metal prices from BTMC API
"""

import requests
import logging
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class GoldService:
    """Service for fetching gold and silver prices from BTMC"""
    
    API_URL = "http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v"
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml'
    }
    
    # Products we want to display with their display names
    TARGET_PRODUCTS = {
        'VÀNG MIẾNG SJC': 'Vàng SJC (Miếng)',
        'VÀNG MIẾNG VRTL': 'Vàng VRTL (Miếng)',
        'NHẪN TRÒN TRƠN': 'Nhẫn Vàng 9999',
        'BẠC MIẾNG': 'Bạc 1kg'
    }
    
    SORT_ORDER = ['VÀNG MIẾNG SJC', 'VÀNG MIẾNG VRTL', 'NHẪN TRÒN TRƠN', 'BẠC MIẾNG']
    
    @classmethod
    def fetch_once(cls) -> Dict[str, Any]:
        """Fetch gold/silver prices from BTMC API once"""
        try:
            response = requests.get(cls.API_URL, headers=cls.HEADERS, timeout=15)
            
            if response.status_code != 200:
                return {"success": False, "data": []}
            
            root = ET.fromstring(response.content)
            product_latest = {}  # {product_key: {name, buy, sell, time, datetime}}
            
            for data_elem in root.findall('Data'):
                row = data_elem.get('row')
                if not row:
                    continue
                
                # Get attributes and clean them
                name = " ".join(data_elem.get(f'n_{row}', '').split()).strip()
                karat = data_elem.get(f'k_{row}', '').strip().lower()
                buy_price = "".join(data_elem.get(f'pb_{row}', '0').split())
                sell_price = "".join(data_elem.get(f'ps_{row}', '0').split())
                time_str = data_elem.get(f'd_{row}', '').strip()
                
                if not name or (buy_price == '0' and sell_price == '0'):
                    continue

                # Match product
                product_key, display_name = cls._match_product(name)
                if not product_key:
                    continue
                
                # Only process 24k gold or Silver
                is_gold = 'VÀNG' in product_key or 'SJC' in product_key or 'TRÒN TRƠN' in product_key
                if is_gold and karat not in ['24k', '999.9', '99.99', '']:
                    continue
                
                # Parse datetime
                try:
                    dt = datetime.strptime(time_str, '%d/%m/%Y %H:%M')
                except:
                    dt = datetime.now()
                
                # Parse prices
                try:
                    buy_val = int(float(buy_price))
                    sell_val = int(float(sell_price))
                except:
                    continue
                    
                # Keep only latest entry for each product
                if product_key not in product_latest or dt >= product_latest[product_key]['datetime']:
                    product_latest[product_key] = {
                        'Id': hash(product_key) % 1000,
                        'TypeName': display_name,
                        'BranchName': 'BTMC',
                        'Buy': f"{buy_val:,}".replace(',', '.'),
                        'Sell': f"{sell_val:,}".replace(',', '.') if sell_val > 0 else '-',
                        'UpdateTime': time_str or dt.strftime('%d/%m/%Y %H:%M'),
                        'datetime': dt
                    }
            
            if not product_latest:
                return {"success": False, "data": []}
            
            # Get latest update time
            latest_time = max(p['datetime'] for p in product_latest.values())
            latest_time_str = latest_time.strftime('%Y-%m-%dT%H:%M:00')
            
            # Build result list with consistent order
            gold_data = []
            for key in cls.SORT_ORDER:
                if key in product_latest:
                    item = product_latest[key].copy()
                    del item['datetime']
                    gold_data.append(item)
            
            return {
                "success": True, 
                "data": gold_data,
                "source": "BTMC",
                "updated_at": latest_time_str
            }
            
        except Exception as e:
            logger.error(f"Error fetching BTMC gold price: {e}")
            return {"success": False, "data": [], "error": str(e)}
    
    @classmethod
    def _match_product(cls, name: str) -> tuple:
        """Match product name to our target products"""
        name_upper = name.upper()
        
        if 'VÀNG MIẾNG SJC' in name_upper:
            return 'VÀNG MIẾNG SJC', 'Vàng SJC (Miếng)'
        elif 'VÀNG MIẾNG VRTL' in name_upper or 'VÀNG RỒNG THĂNG LONG' in name_upper:
            if 'NHẪN' in name_upper or 'TRÒN TRƠN' in name_upper:
                return 'NHẪN TRÒN TRƠN', 'Nhẫn Vàng 9999'
            elif 'MIẾNG' in name_upper:
                return 'VÀNG MIẾNG VRTL', 'Vàng VRTL (Miếng)'
        elif 'BẠC' in name_upper and 'MIẾNG' in name_upper:
            return 'BẠC MIẾNG', 'Bạc 1kg'
        
        return None, None
    
    @classmethod
    def fetch_with_retry(cls, max_retries: int = 3) -> Dict[str, Any]:
        """Fetch gold price with retries"""
        for attempt in range(max_retries):
            result = cls.fetch_once()
            if result.get('success') and len(result.get('data', [])) > 0:
                logger.info(f"BTMC gold price fetch successful on attempt {attempt + 1}")
                return result
            if attempt < max_retries - 1:
                logger.warning(f"BTMC gold price empty/failed, retrying... ({attempt + 1}/{max_retries})")
                time.sleep(1)
        
        logger.error(f"BTMC gold price fetch failed after {max_retries} attempts")
        return {"success": False, "data": []}
    
    @staticmethod
    def validate_response(data: Dict) -> bool:
        """Check if response has valid data (for caching)"""
        return data.get('success', False) is True and len(data.get('data', [])) > 0
