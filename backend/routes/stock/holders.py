from __future__ import annotations

import json
import logging
import os
import sqlite3

from flask import Blueprint, jsonify

from backend.cache_utils import cache_get, cache_set
from backend.db_path import resolve_vci_shareholders_db_path
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)

_CACHE_TTL = 3600  # 1 hour — data changes daily


def _cache_get(key):
    return cache_get(key)


def _cache_set(key, data, ttl: int = _CACHE_TTL):
    cache_set(key, data, ttl=ttl)


def _to_json_number(value, default: float = 0.0) -> float:
    try:
        v = float(value)
        return v
    except (TypeError, ValueError):
        return default


def _load_vci_shareholders(symbol: str) -> list[dict] | None:
    """Load shareholders from vci_shareholders.sqlite. Returns None if DB/symbol missing."""
    db_path = resolve_vci_shareholders_db_path()
    if not db_path or not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT owner_name, owner_name_en, owner_code,
                   position_name, position_name_en,
                   quantity, percentage, owner_type, update_date, public_date
            FROM shareholders
            WHERE ticker = ?
            ORDER BY percentage DESC, quantity DESC
            """,
            (symbol.upper(),),
        ).fetchall()
        conn.close()
        if rows is None:
            return None
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.debug(f"vci_shareholders lookup failed for {symbol}: {exc}")
        return None


def _fetch_vci_shareholders_live(symbol: str) -> list[dict] | None:
    """Fetch shareholders live from VCI API and cache to SQLite."""
    import gzip as _gzip
    from http.cookiejar import CookieJar
    try:
        url = f"https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{symbol.upper()}/shareholder"
        import urllib.request as _ur
        req = _ur.Request(url, headers={
            "accept": "application/json",
            "accept-encoding": "gzip",
            "origin": "https://trading.vietcap.com.vn",
            "referer": "https://trading.vietcap.com.vn/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        })
        opener = _ur.build_opener(_ur.HTTPCookieProcessor(CookieJar()))
        with opener.open(req, timeout=12) as resp:
            raw = resp.read()
            if "gzip" in resp.headers.get("Content-Encoding", "").lower():
                raw = _gzip.decompress(raw)
            body = json.loads(raw.decode("utf-8", errors="replace"))
            holders = body.get("data") if isinstance(body, dict) else body
            if not isinstance(holders, list):
                return None

        # Persist to SQLite for next request
        db_path = resolve_vci_shareholders_db_path()
        if db_path:
            try:
                import datetime as _dt
                fetched_at = _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat()
                sconn = sqlite3.connect(db_path)
                sconn.execute("PRAGMA journal_mode=WAL;")
                sconn.execute("""
                    CREATE TABLE IF NOT EXISTS shareholders (
                      ticker TEXT NOT NULL, owner_code TEXT NOT NULL,
                      owner_name TEXT, owner_name_en TEXT,
                      position_name TEXT, position_name_en TEXT,
                      quantity INTEGER, percentage REAL, owner_type TEXT,
                      update_date TEXT, public_date TEXT, fetched_at TEXT NOT NULL,
                      PRIMARY KEY (ticker, owner_code)
                    )
                """)
                sconn.execute("DELETE FROM shareholders WHERE ticker = ?", (symbol.upper(),))
                for h in holders:
                    owner_code = str(h.get("ownerCode") or h.get("ownerName") or "")[:50]
                    if not owner_code:
                        continue
                    sconn.execute("""
                        INSERT OR REPLACE INTO shareholders
                          (ticker, owner_code, owner_name, owner_name_en,
                           position_name, position_name_en, quantity, percentage,
                           owner_type, update_date, public_date, fetched_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        symbol.upper(), owner_code,
                        str(h.get("ownerName") or "").strip() or None,
                        str(h.get("ownerNameEn") or "").strip() or None,
                        str(h.get("positionName") or "").strip() or None,
                        str(h.get("positionNameEn") or "").strip() or None,
                        int(h["quantity"]) if h.get("quantity") is not None else None,
                        float(h["percentage"]) if h.get("percentage") is not None else None,
                        str(h.get("ownerType") or "").strip() or None,
                        str(h.get("updateDate") or "")[:10] or None,
                        str(h.get("publicDate") or "")[:10] or None,
                        fetched_at,
                    ))
                sconn.commit()
                sconn.close()
            except Exception:
                pass

        return [
            {
                "owner_name": h.get("ownerName"),
                "owner_name_en": h.get("ownerNameEn"),
                "owner_code": h.get("ownerCode"),
                "position_name": h.get("positionName"),
                "position_name_en": h.get("positionNameEn"),
                "quantity": h.get("quantity"),
                "percentage": h.get("percentage"),
                "owner_type": h.get("ownerType"),
                "update_date": str(h.get("updateDate") or "")[:10] or None,
                "public_date": str(h.get("publicDate") or "")[:10] or None,
            }
            for h in holders
        ]
    except Exception as exc:
        logger.debug(f"VCI live shareholders fetch failed for {symbol}: {exc}")
        return None


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/holders/<symbol>", methods=["GET"])
    @stock_bp.route("/holders/<symbol>", methods=["GET"])
    def api_stock_holders(symbol):
        """Return holders data from VCI shareholders SQLite (updated daily)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            cache_key = f"holders_vci_{clean_symbol}"
            cached = _cache_get(cache_key)
            if cached:
                return jsonify(cached)

            raw_holders = _load_vci_shareholders(clean_symbol)

            if not raw_holders:
                raw_holders = _fetch_vci_shareholders_live(clean_symbol)

            if not raw_holders:
                return jsonify({"success": False, "error": "No shareholder data available"}), 404

            current_price = 0.0
            try:
                from backend.data_sources.vci import VCIClient
                price_detail = VCIClient.get_price_detail(clean_symbol)
                if price_detail:
                    current_price = _to_json_number(price_detail.get("price"))
            except Exception:
                pass

            outstanding_shares = 0.0
            for h in raw_holders:
                qty = h.get("quantity") or 0
                pct = h.get("percentage") or 0
                if qty > 0 and pct > 0:
                    inferred = qty / pct
                    if inferred > outstanding_shares:
                        outstanding_shares = inferred

            institutional: list[dict] = []
            individuals: list[dict] = []

            for h in raw_holders:
                quantity = _to_json_number(h.get("quantity"))
                if quantity <= 0:
                    continue

                pct = h.get("percentage")
                name_vi = str(h.get("owner_name") or "").strip()
                name_en = str(h.get("owner_name_en") or "").strip()
                display_name = name_en or name_vi or str(h.get("owner_code") or "")
                position_en = str(h.get("position_name_en") or "").strip() or None
                position_vi = str(h.get("position_name") or "").strip() or None
                update_date = str(h.get("update_date") or "").strip() or None

                item = {
                    "manager": display_name,
                    "name_vi": name_vi or None,
                    "position": position_en or position_vi,
                    "shares": float(quantity),
                    "ownership_percent": float(pct) if pct is not None else None,
                    "value": float(quantity * current_price) if current_price > 0 else 0.0,
                    "update_date": update_date,
                }

                owner_type = str(h.get("owner_type") or "").upper()
                if owner_type == "CORPORATE":
                    institutional.append(item)
                else:
                    individuals.append(item)

            institutional.sort(key=lambda x: x.get("shares", 0), reverse=True)
            individuals.sort(key=lambda x: x.get("shares", 0), reverse=True)

            all_holders = institutional + individuals
            updated_at = max((str(x.get("update_date") or "") for x in all_holders), default="") or None

            summary = {
                "institutional_count": len(institutional),
                "individual_count": len(individuals),
                "institutional_total_shares": float(sum(x.get("shares", 0) for x in institutional)),
                "institutional_total_value": float(sum(x.get("value", 0) for x in institutional)),
                "individual_total_shares": float(sum(x.get("shares", 0) for x in individuals)),
                "individual_total_value": float(sum(x.get("value", 0) for x in individuals)),
            }

            payload = {
                "success": True,
                "symbol": clean_symbol,
                "current_price": float(current_price),
                "outstanding_shares": float(outstanding_shares),
                "updated_at": updated_at,
                "as_of_shareholders": updated_at,
                "sources": {"shareholders": "vci_shareholders.sqlite"},
                "summary": summary,
                "institutional": institutional,
                "individuals": individuals,
                "insiders": [],
            }

            _cache_set(cache_key, payload, ttl=3600)
            return jsonify(payload)
        except Exception as e:
            logger.error(f"Holders endpoint error for {symbol}: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
