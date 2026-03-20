"""
Gold & Silver Price Service
Primary source: gold.quanganh.org/api/gold-prices
Fallback:       BTMC XML API
"""

import logging
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Dict, Any, List, Optional

import requests

logger = logging.getLogger(__name__)


# ─── Primary source: gold.quanganh.org ───────────────────────────────────────

_QUANGANH_URL = "https://gold.quanganh.org/api/gold-prices"

# Which types to show and their display names
_QA_TYPE_MAP = {
    'vàng miếng sjc':                  'Vàng SJC (Miếng)',
    'nhẫn tròn phú quý 999.9':         'Nhẫn Vàng 9999',
    'phú quý 1 lượng 999.9':           'Vàng PQ 9999 (Miếng)',
    'bạc thỏi phú quý 999':            'Bạc 1kg',
}

_QA_SORT = [
    'vàng miếng sjc',
    'nhẫn tròn phú quý 999.9',
    'phú quý 1 lượng 999.9',
    'bạc thỏi phú quý 999',
]


def _fetch_quanganh() -> Dict[str, Any]:
    r = requests.get(_QUANGANH_URL, timeout=10)
    r.raise_for_status()
    payload = r.json()
    prices: List[dict] = payload.get("prices") or []
    updated = payload.get("last_updated") or payload.get("scraped_at") or ""

    result: Dict[str, dict] = {}
    for item in prices:
        raw_type = (item.get("type") or "").strip()
        key = raw_type.lower()

        # prefix match against our map
        matched_key: Optional[str] = None
        for k in _QA_TYPE_MAP:
            if key.startswith(k) or k in key:
                matched_key = k
                break
        if not matched_key:
            continue

        buy  = item.get("buy_price")
        sell = item.get("sell_price")
        if not buy:
            continue

        if matched_key not in result:
            result[matched_key] = {
                "Id":         abs(hash(matched_key)) % 1000,
                "TypeName":   _QA_TYPE_MAP[matched_key],
                "BranchName": "Phú Quý",
                "Buy":        f"{int(buy):,}".replace(",", "."),
                "Sell":       f"{int(sell):,}".replace(",", ".") if sell else "-",
                "UpdateTime": updated[:16].replace("T", " ") if updated else "",
            }

    if not result:
        return {"success": False, "data": []}

    gold_data = [result[k] for k in _QA_SORT if k in result]
    return {
        "success":    True,
        "data":       gold_data,
        "source":     "gold.quanganh.org",
        "updated_at": updated,
    }


# ─── Fallback: BTMC XML API ───────────────────────────────────────────────────

_BTMC_URL = "http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v"
_BTMC_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/xml',
}
_BTMC_PRODUCTS = {
    'VÀNG MIẾNG SJC':  'Vàng SJC (Miếng)',
    'VÀNG MIẾNG VRTL': 'Vàng VRTL (Miếng)',
    'NHẪN TRÒN TRƠN':  'Nhẫn Vàng 9999',
    'BẠC MIẾNG':       'Bạc 1kg',
}
_BTMC_SORT = ['VÀNG MIẾNG SJC', 'VÀNG MIẾNG VRTL', 'NHẪN TRÒN TRƠN', 'BẠC MIẾNG']


def _match_btmc(name: str):
    n = name.upper()
    if 'VÀNG MIẾNG SJC' in n:
        return 'VÀNG MIẾNG SJC', 'Vàng SJC (Miếng)'
    if 'VÀNG MIẾNG VRTL' in n or 'VÀNG RỒNG THĂNG LONG' in n:
        if 'NHẪN' in n or 'TRÒN TRƠN' in n:
            return 'NHẪN TRÒN TRƠN', 'Nhẫn Vàng 9999'
        if 'MIẾNG' in n:
            return 'VÀNG MIẾNG VRTL', 'Vàng VRTL (Miếng)'
    if 'BẠC' in n and 'MIẾNG' in n:
        return 'BẠC MIẾNG', 'Bạc 1kg'
    return None, None


def _fetch_btmc() -> Dict[str, Any]:
    r = requests.get(_BTMC_URL, headers=_BTMC_HEADERS, timeout=15)
    if r.status_code != 200:
        return {"success": False, "data": []}

    root = ET.fromstring(r.content)
    latest: Dict[str, dict] = {}

    for elem in root.findall('Data'):
        row = elem.get('row')
        if not row:
            continue
        name       = " ".join(elem.get(f'n_{row}', '').split()).strip()
        karat      = elem.get(f'k_{row}', '').strip().lower()
        buy_price  = "".join(elem.get(f'pb_{row}', '0').split())
        sell_price = "".join(elem.get(f'ps_{row}', '0').split())
        time_str   = elem.get(f'd_{row}', '').strip()

        if not name or (buy_price == '0' and sell_price == '0'):
            continue
        key, display = _match_btmc(name)
        if not key:
            continue
        is_gold = 'VÀNG' in key or 'TRÒN TRƠN' in key
        if is_gold and karat not in ['24k', '999.9', '99.99', '']:
            continue
        try:
            dt = datetime.strptime(time_str, '%d/%m/%Y %H:%M')
        except Exception:
            dt = datetime.now()
        try:
            buy_val  = int(float(buy_price))
            sell_val = int(float(sell_price))
        except Exception:
            continue

        if key not in latest or dt >= latest[key]['_dt']:
            latest[key] = {
                'Id':         hash(key) % 1000,
                'TypeName':   display,
                'BranchName': 'BTMC',
                'Buy':        f"{buy_val:,}".replace(',', '.'),
                'Sell':       f"{sell_val:,}".replace(',', '.') if sell_val > 0 else '-',
                'UpdateTime': time_str or dt.strftime('%d/%m/%Y %H:%M'),
                '_dt':        dt,
            }

    if not latest:
        return {"success": False, "data": []}

    latest_time = max(v['_dt'] for v in latest.values()).strftime('%Y-%m-%dT%H:%M:00')
    gold_data = []
    for k in _BTMC_SORT:
        if k in latest:
            item = {kk: vv for kk, vv in latest[k].items() if kk != '_dt'}
            gold_data.append(item)

    return {"success": True, "data": gold_data, "source": "BTMC", "updated_at": latest_time}


# ─── Public GoldService class (keeps existing interface) ─────────────────────

class GoldService:
    @classmethod
    def fetch_once(cls) -> Dict[str, Any]:
        try:
            result = _fetch_quanganh()
            if result.get("success") and result.get("data"):
                return result
        except Exception as e:
            logger.warning("gold.quanganh.org failed, falling back to BTMC: %s", e)

        try:
            return _fetch_btmc()
        except Exception as e:
            logger.error("BTMC fallback also failed: %s", e)
            return {"success": False, "data": [], "error": str(e)}

    @classmethod
    def fetch_with_retry(cls, max_retries: int = 3) -> Dict[str, Any]:
        for attempt in range(max_retries):
            result = cls.fetch_once()
            if result.get('success') and result.get('data'):
                return result
            if attempt < max_retries - 1:
                logger.warning("Gold fetch empty/failed, retrying... (%d/%d)", attempt + 1, max_retries)
                time.sleep(1)
        logger.error("Gold fetch failed after %d attempts", max_retries)
        return {"success": False, "data": []}

    @staticmethod
    def validate_response(data: Dict) -> bool:
        return bool(data.get('success')) and len(data.get('data') or []) > 0
