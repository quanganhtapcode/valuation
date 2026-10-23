"""Phu Quy HTML quotes fetched and cached on the valuation VPS."""
from __future__ import annotations
import fcntl
import json
import logging
import os
import re
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timezone, timedelta
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import requests

logger = logging.getLogger(__name__)
GOLD_URL = "https://phuquygroup.vn/giavang"
CACHE_PATH = Path(os.getenv("GOLD_SNAPSHOT_PATH", str(Path(__file__).resolve().parents[2] / "data/cache/gold-prices.json")))


class PriceTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.cells = None
        self.text = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.cells = []
        elif tag == "td" and self.cells is not None:
            self.text = []

    def handle_data(self, data):
        if self.text is not None:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.text is not None:
            self.cells.append(" ".join("".join(self.text).split()))
            self.text = None
        elif tag == "tr" and self.cells is not None:
            self.rows.append(self.cells)
            self.cells = None
            self.text = None


def normalized(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.casefold()) if not unicodedata.combining(c)).replace("đ", "d")


def price(text):
    if not re.fullmatch(r"\d[\d,.]*", text.strip()):
        return None
    value = int(re.sub(r"[,.]", "", text))
    return value if value > 0 else None


def quote(identifier, name, raw_name, buy, sell, unit):
    if buy is None or sell is None or sell < buy:
        raise ValueError("Invalid retail quote")
    return {"Id": identifier, "TypeName": name, "SourceProduct": raw_name,
            "BranchName": "Phú Quý", "Buy": f"{buy:,}".replace(",", "."),
            "Sell": f"{sell:,}".replace(",", "."), "buy_price": buy,
            "sell_price": sell, "Unit": unit, "UpdateTime": ""}


def parse_gold(html):
    if "vnd/chi" not in normalized(unescape(html)).replace(" ", ""):
        raise ValueError("Unexpected price unit")
    parser = PriceTableParser()
    parser.feed(html)
    result = {}
    names = {"vang mieng sjc": (1, "Vàng SJC (Miếng)"),
             "nhan tron phu quy 999.9": (2, "Nhẫn Vàng 9999"),
             "phu quy 1 luong 999.9": (3, "Vàng PQ 9999 (Miếng)")}
    for cells in parser.rows:
        if len(cells) != 3:
            continue
        key = normalized(cells[0])
        selected = names.get(key)
        if key.startswith("bac thoi phu quy 999"):
            selected = (4, "Bạc Thỏi Phú Quý 999")
        if selected:
            identifier, name = selected
            result[identifier] = quote(identifier, name, cells[0], price(cells[1]), price(cells[2]), "VNĐ/chỉ")
    if set(result) != {1, 2, 3, 4}:
        raise ValueError("Missing expected Phu Quy gold or silver rows")
    return [result[k] for k in sorted(result)]


def issuer_timestamp(html):
    text = normalized(" ".join(unescape(html).split()))
    match = re.search(r"cap nhat lan cuoi luc (\d{2}:\d{2}) (\d{2}/\d{2}/\d{4})", text)
    if not match:
        raise ValueError("Missing issuer update timestamp")
    return datetime.strptime(" ".join(match.groups()), "%H:%M %d/%m/%Y").replace(tzinfo=timezone(timedelta(hours=7))).isoformat()


def read_cache():
    try:
        value = json.loads(CACHE_PATH.read_text())
        return value if GoldService.validate_response(value) else None
    except (OSError, ValueError):
        return None


def age(value):
    try:
        return max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(value["fetched_at"])).total_seconds())
    except (KeyError, ValueError, TypeError):
        return float("inf")


class GoldService:
    _refresh_lock = threading.Lock()
    _refreshing = False
    _retry_after = 0.0

    @classmethod
    def snapshot(cls):
        """Serve persisted quotes immediately and refresh outside the request."""
        cached = read_cache()
        if cached and age(cached) < 60:
            return {**cached, "stale": False}
        with cls._refresh_lock:
            if not cls._refreshing and time.monotonic() >= cls._retry_after:
                cls._refreshing = True
                try:
                    threading.Thread(target=cls._refresh_snapshot, daemon=True).start()
                except RuntimeError:
                    cls._refreshing = False
                    logger.exception("Unable to start gold refresh")
        return {**cached, "stale": True} if cached else {
            "success": False, "data": [], "error": "Quotes are refreshing"}

    @classmethod
    def _refresh_snapshot(cls):
        try:
            cls.fetch_once()
        except Exception:
            logger.exception("Gold snapshot refresh failed")
        finally:
            with cls._refresh_lock:
                cls._retry_after = time.monotonic() + 30
                cls._refreshing = False

    @classmethod
    def fetch_once(cls):
        cached = read_cache()
        if cached and age(cached) < 60:
            return {**cached, "stale": False}
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(str(CACHE_PATH) + ".lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {**cached, "stale": True} if cached else {"success": False, "data": [], "error": "Quotes are refreshing"}
            try:
                cached = read_cache()
                if cached and age(cached) < 60:
                    return {**cached, "stale": False}
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36", "Accept": "text/html", "Accept-Language": "vi-VN,vi;q=0.9"}
                response = requests.get(GOLD_URL, headers=headers, timeout=(5, 12))
                response.raise_for_status()
                response.encoding = "utf-8"
                rows = parse_gold(response.text)
                updated_at = issuer_timestamp(response.text)
                for row in rows:
                    row["UpdateTime"] = updated_at
                result = {"success": True, "data": rows, "source": "Phú Quý",
                          "source_url": GOLD_URL, "fetched_at": datetime.now(timezone.utc).isoformat(),
                          "updated_at": updated_at, "stale": False, "silver_available": True}
                # Retrieval time is not an issuer-reported quote timestamp.
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(mode="w", dir=CACHE_PATH.parent, delete=False, encoding="utf-8") as handle:
                        temporary = handle.name
                        json.dump(result, handle, ensure_ascii=False)
                    os.replace(temporary, CACHE_PATH)
                finally:
                    if temporary and os.path.exists(temporary):
                        os.unlink(temporary)
                return result
            except (requests.RequestException, ValueError, OSError) as exc:
                logger.warning("Direct gold quote refresh failed: %s", type(exc).__name__)
                return {**cached, "stale": True} if cached else {"success": False, "data": [], "error": "Gold quotes temporarily unavailable"}

    @classmethod
    def fetch_with_retry(cls, max_retries=3):
        return cls.fetch_once()

    @staticmethod
    def validate_response(data):
        return isinstance(data, dict) and bool(data.get("success")) and len(data.get("data") or []) >= 2
