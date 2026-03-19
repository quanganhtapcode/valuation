#!/usr/bin/env python3
"""Fetch Vietcap (VCI) market index history into SQLite.

Default behavior (no args): fetch VNINDEX pages 0..45 (size=50) and upsert into
`vci_market_indices.sqlite` for fast re-runs and queries.

Example:
  python fetch_vci.py --index VNINDEX --start-page 0 --end-page 45 --size 50 --db vci.sqlite
"""

from __future__ import annotations

import argparse
import datetime as _dt
import gzip
import json
import random
import sqlite3
import re
import time
import inspect
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from typing import Any, Iterable


BASE_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/market-indices/history"


def _utc_now_iso() -> str:
	return _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat()


def _random_device_id_hex(n_bytes: int = 12) -> str:
	# Matches the common look of captured `device-id` header (hex string)
	return "".join(f"{random.randrange(256):02x}" for _ in range(n_bytes))


def _build_opener() -> urllib.request.OpenerDirector:
	cookie_jar = CookieJar()
	return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def _default_headers(device_id: str) -> dict[str, str]:
	return {
		"accept": "application/json",
		"accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
		"user-agent": (
			"Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) "
			"AppleWebKit/537.36 (KHTML, like Gecko) "
			"Chrome/145.0.0.0 Mobile Safari/537.36"
		),
		"origin": "https://trading.vietcap.com.vn",
		"referer": "https://trading.vietcap.com.vn/",
		"device-id": device_id,
		"accept-encoding": "gzip",
		"connection": "keep-alive",
		# Some deployments look for this header; harmless if ignored.
		"x-requested-with": "XMLHttpRequest",
	}


def _read_json_response(resp: urllib.response.addinfourl) -> Any:
	raw = resp.read()
	encoding = resp.headers.get("Content-Encoding", "").lower()
	if "gzip" in encoding:
		raw = gzip.decompress(raw)
	text = raw.decode("utf-8", errors="replace")
	return json.loads(text)


def request_json(
	opener: urllib.request.OpenerDirector,
	url: str,
	headers: dict[str, str],
	*,
	timeout_s: int = 30,
	retries: int = 6,
	backoff_base_s: float = 0.8,
) -> Any:
	"""GET JSON with retry/backoff for rate-limit or transient errors."""

	last_err: Exception | None = None
	for attempt in range(retries + 1):
		try:
			req = urllib.request.Request(url, headers=headers, method="GET")
			with opener.open(req, timeout=timeout_s) as resp:
				return _read_json_response(resp)
		except urllib.error.HTTPError as e:
			last_err = e
			retryable = e.code in (429, 500, 502, 503, 504)
			if not retryable or attempt >= retries:
				raise
		except (urllib.error.URLError, TimeoutError, OSError) as e:
			last_err = e
			if attempt >= retries:
				raise

		sleep_s = backoff_base_s * (2**attempt) + random.random() * 0.25
		time.sleep(sleep_s)

	if last_err is not None:
		raise last_err
	raise RuntimeError("request_json failed without exception")


def _get_first(item: dict[str, Any], keys: Iterable[str]) -> Any:
	for k in keys:
		if k in item and item[k] is not None:
			return item[k]
	return None


def _to_float(v: Any) -> float | None:
	if v is None:
		return None
	if isinstance(v, (int, float)):
		return float(v)
	if isinstance(v, str):
		s = v.strip().replace(",", "")
		if not s:
			return None
		try:
			return float(s)
		except ValueError:
			return None
	return None


def _to_percent(v: Any) -> float | None:
	"""Convert various percent formats to percent units.

	Vietcap `percentIndexChange` appears to be fractional (e.g. 0.0055 == 0.55%).
	We store pct_change in percent units for easier display.
	"""

	x = _to_float(v)
	if x is None:
		return None
	# Heuristic: treat values in [-1, 1] as fraction-of-1.
	if -1.0 <= x <= 1.0:
		return x * 100.0
	return x


def ensure_schema(conn: sqlite3.Connection) -> None:
	conn.execute("PRAGMA journal_mode=WAL;")
	conn.execute("PRAGMA synchronous=NORMAL;")
	conn.execute("PRAGMA temp_store=MEMORY;")
	# Wide schema: store all fields as columns (no raw JSON column).
	# Primary key uses (symbol, tradingDate) to uniquely identify an index day.
	conn.execute(
		"""
		CREATE TABLE IF NOT EXISTS market_index_history (
		  symbol                     TEXT NOT NULL,
		  tradingDate                TEXT NOT NULL,
		  id                         TEXT,
		  comGroupCode               TEXT,
		  indexValue                 REAL,
		  indexChange                REAL,
		  percentIndexChange         REAL,
		  referenceIndex             REAL,
		  openIndex                  REAL,
		  closeIndex                 REAL,
		  highestIndex               REAL,
		  lowestIndex                REAL,
		  typeIndex                  REAL,
		  totalMatchVolume           REAL,
		  totalMatchValue            REAL,
		  totalDealVolume            REAL,
		  totalDealValue             REAL,
		  totalVolume                REAL,
		  totalValue                 REAL,
		  totalStockUpPrice          REAL,
		  totalStockDownPrice        REAL,
		  totalStockNoChangePrice    REAL,
		  totalStockCeiling          REAL,
		  totalStockFloor            REAL,
		  totalUpVolume              REAL,
		  totalDownVolume            REAL,
		  totalNoChangeVolume        REAL,
		  totalTrade                 REAL,
		  totalBuyTrade              REAL,
		  totalBuyTradeVolume        REAL,
		  totalSellTrade             REAL,
		  totalSellTradeVolume       REAL,
		  foreignBuyValueMatched     REAL,
		  foreignBuyVolumeMatched    REAL,
		  foreignSellValueMatched    REAL,
		  foreignSellVolumeMatched   REAL,
		  foreignBuyValueDeal        REAL,
		  foreignBuyVolumeDeal       REAL,
		  foreignSellValueDeal       REAL,
		  foreignSellVolumeDeal      REAL,
		  foreignBuyValueTotal       REAL,
		  foreignBuyVolumeTotal      REAL,
		  foreignSellValueTotal      REAL,
		  foreignSellVolumeTotal     REAL,
		  foreignTotalRoom           REAL,
		  foreignCurrentRoom         REAL,
		  shareIssue                 REAL,
		  marketCap                  REAL,
		  foreignNetVolumeTotal      REAL,
		  foreignNetValueTotal       REAL,
		  foreignNetVolumeMatched    REAL,
		  foreignNetValueMatched     REAL,
		  foreignNetVolumeDeal       REAL,
		  foreignNetValueDeal        REAL,
		  totalBuyUnmatchedVolume    REAL,
		  totalSellUnmatchedVolume   REAL,
		  foreignOwned               REAL,
		  averageBuyTradeVolume      REAL,
		  averageSellTradeVolume     REAL,
		  totalNetTradeVolume        REAL,
		  indexChangeValue           TEXT,
		  fetched_at                 TEXT NOT NULL,
		  PRIMARY KEY (symbol, tradingDate)
		);
		"""
	)
	conn.execute(
		"""
		CREATE TABLE IF NOT EXISTS meta (
		  k TEXT PRIMARY KEY,
		  v TEXT NOT NULL
		);
		"""
	)
	_migrate_from_legacy_schema_if_needed(conn)
	conn.execute(
		"CREATE INDEX IF NOT EXISTS idx_market_index_history_date ON market_index_history(tradingDate);"
	)
	conn.commit()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
	rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
	return {r[1] for r in rows}


def _migrate_from_legacy_schema_if_needed(conn: sqlite3.Connection) -> None:
	"""Migrate from the previous schema that stored `raw_json`.

	Old schema table name is the same (`market_index_history`) but had different columns.
	If detected, we rebuild the table (no raw_json) and parse raw_json once to populate columns.
	"""

	cols = _table_columns(conn, "market_index_history")
	if "raw_json" not in cols:
		return

	conn.execute("ALTER TABLE market_index_history RENAME TO market_index_history_legacy;")
	# Create the new wide table (re-run create statement by calling ensure_schema body parts)
	conn.execute(
		"""
		CREATE TABLE IF NOT EXISTS market_index_history (
		  symbol                     TEXT NOT NULL,
		  tradingDate                TEXT NOT NULL,
		  id                         TEXT,
		  comGroupCode               TEXT,
		  indexValue                 REAL,
		  indexChange                REAL,
		  percentIndexChange         REAL,
		  referenceIndex             REAL,
		  openIndex                  REAL,
		  closeIndex                 REAL,
		  highestIndex               REAL,
		  lowestIndex                REAL,
		  typeIndex                  REAL,
		  totalMatchVolume           REAL,
		  totalMatchValue            REAL,
		  totalDealVolume            REAL,
		  totalDealValue             REAL,
		  totalVolume                REAL,
		  totalValue                 REAL,
		  totalStockUpPrice          REAL,
		  totalStockDownPrice        REAL,
		  totalStockNoChangePrice    REAL,
		  totalStockCeiling          REAL,
		  totalStockFloor            REAL,
		  totalUpVolume              REAL,
		  totalDownVolume            REAL,
		  totalNoChangeVolume        REAL,
		  totalTrade                 REAL,
		  totalBuyTrade              REAL,
		  totalBuyTradeVolume        REAL,
		  totalSellTrade             REAL,
		  totalSellTradeVolume       REAL,
		  foreignBuyValueMatched     REAL,
		  foreignBuyVolumeMatched    REAL,
		  foreignSellValueMatched    REAL,
		  foreignSellVolumeMatched   REAL,
		  foreignBuyValueDeal        REAL,
		  foreignBuyVolumeDeal       REAL,
		  foreignSellValueDeal       REAL,
		  foreignSellVolumeDeal      REAL,
		  foreignBuyValueTotal       REAL,
		  foreignBuyVolumeTotal      REAL,
		  foreignSellValueTotal      REAL,
		  foreignSellVolumeTotal     REAL,
		  foreignTotalRoom           REAL,
		  foreignCurrentRoom         REAL,
		  shareIssue                 REAL,
		  marketCap                  REAL,
		  foreignNetVolumeTotal      REAL,
		  foreignNetValueTotal       REAL,
		  foreignNetVolumeMatched    REAL,
		  foreignNetValueMatched     REAL,
		  foreignNetVolumeDeal       REAL,
		  foreignNetValueDeal        REAL,
		  totalBuyUnmatchedVolume    REAL,
		  totalSellUnmatchedVolume   REAL,
		  foreignOwned               REAL,
		  averageBuyTradeVolume      REAL,
		  averageSellTradeVolume     REAL,
		  totalNetTradeVolume        REAL,
		  indexChangeValue           TEXT,
		  fetched_at                 TEXT NOT NULL,
		  PRIMARY KEY (symbol, tradingDate)
		);
		"""
	)
	conn.execute(
		"CREATE INDEX IF NOT EXISTS idx_market_index_history_date ON market_index_history(tradingDate);"
	)

	legacy_rows = conn.execute(
		"SELECT index_code, trading_date, raw_json, fetched_at FROM market_index_history_legacy"
	).fetchall()
	for index_code, trading_date, raw_json, fetched_at in legacy_rows:
		try:
			item = json.loads(raw_json)
		except Exception:
			continue
		# Ensure keys exist
		item.setdefault("symbol", index_code)
		item.setdefault("tradingDate", trading_date)
		upsert_items(conn, index_code=str(index_code), items=[item], fetched_at=str(fetched_at))

	conn.execute("DROP TABLE market_index_history_legacy;")


def upsert_items(
	conn: sqlite3.Connection,
	index_code: str,
	items: list[dict[str, Any]],
	fetched_at: str,
) -> tuple[int, int]:
	"""Returns (inserted_or_updated_rows, skipped_rows)."""

	changed = 0
	skipped = 0
	# Store full Vietcap payload into columns (no raw_json).
	columns = [
		"symbol",
		"tradingDate",
		"id",
		"comGroupCode",
		"indexValue",
		"indexChange",
		"percentIndexChange",
		"referenceIndex",
		"openIndex",
		"closeIndex",
		"highestIndex",
		"lowestIndex",
		"typeIndex",
		"totalMatchVolume",
		"totalMatchValue",
		"totalDealVolume",
		"totalDealValue",
		"totalVolume",
		"totalValue",
		"totalStockUpPrice",
		"totalStockDownPrice",
		"totalStockNoChangePrice",
		"totalStockCeiling",
		"totalStockFloor",
		"totalUpVolume",
		"totalDownVolume",
		"totalNoChangeVolume",
		"totalTrade",
		"totalBuyTrade",
		"totalBuyTradeVolume",
		"totalSellTrade",
		"totalSellTradeVolume",
		"foreignBuyValueMatched",
		"foreignBuyVolumeMatched",
		"foreignSellValueMatched",
		"foreignSellVolumeMatched",
		"foreignBuyValueDeal",
		"foreignBuyVolumeDeal",
		"foreignSellValueDeal",
		"foreignSellVolumeDeal",
		"foreignBuyValueTotal",
		"foreignBuyVolumeTotal",
		"foreignSellValueTotal",
		"foreignSellVolumeTotal",
		"foreignTotalRoom",
		"foreignCurrentRoom",
		"shareIssue",
		"marketCap",
		"foreignNetVolumeTotal",
		"foreignNetValueTotal",
		"foreignNetVolumeMatched",
		"foreignNetValueMatched",
		"foreignNetVolumeDeal",
		"foreignNetValueDeal",
		"totalBuyUnmatchedVolume",
		"totalSellUnmatchedVolume",
		"foreignOwned",
		"averageBuyTradeVolume",
		"averageSellTradeVolume",
		"totalNetTradeVolume",
		"indexChangeValue",
		"fetched_at",
	]
	pk = {"symbol", "tradingDate"}
	placeholders = ",".join(["?"] * len(columns))
	col_list = ",".join(columns)
	update_cols = [c for c in columns if c not in pk]
	update_set = ",".join([f"{c}=excluded.{c}" for c in update_cols])
	sql = (
		f"INSERT INTO market_index_history ({col_list}) VALUES ({placeholders}) "
		f"ON CONFLICT(symbol, tradingDate) DO UPDATE SET {update_set}"
	)

	cur = conn.cursor()
	for item in items:
		symbol = _get_first(item, ("symbol", "comGroupCode")) or index_code
		trading_date = _get_first(item, ("tradingDate", "trading_date", "date"))
		if not trading_date or not symbol:
			skipped += 1
			continue

		row: dict[str, Any] = {"symbol": str(symbol), "tradingDate": str(trading_date), "fetched_at": fetched_at}
		# Copy all known columns from payload, converting numbers to float.
		for c in columns:
			if c in ("symbol", "tradingDate", "fetched_at"):
				continue
			v = item.get(c)
			if v is None and c == "comGroupCode":
				v = item.get("comGroupCode") or item.get("symbol")
			if c == "id":
				row[c] = str(v) if v is not None else None
			elif c == "indexChangeValue":
				row[c] = str(v) if v is not None else None
			else:
				row[c] = _to_float(v)

		cur.execute(sql, tuple(row.get(c) for c in columns))
		changed += 1

	conn.commit()
	return changed, skipped


def build_url(index_code: str, page: int, size: int) -> str:
	q = urllib.parse.urlencode({"page": page, "size": size, "index": index_code})
	return f"{BASE_URL}?{q}"


def fetch_pages_to_sqlite(
	*,
	index_code: str,
	start_page: int,
	end_page: int,
	size: int,
	db_path: str,
	device_id: str | None,
	timeout_s: int,
	retries: int,
	backoff_base_s: float,
	workers: int,
	sleep_between_pages_s: float,
	incremental: bool = False,
) -> None:
	if end_page < start_page:
		raise ValueError("end_page must be >= start_page")
	if size <= 0:
		raise ValueError("size must be > 0")

	resolved_device_id = device_id or _random_device_id_hex()
	headers = _default_headers(resolved_device_id)

	conn = sqlite3.connect(db_path)
	try:
		ensure_schema(conn)
		conn.execute(
			"INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
			("device_id", resolved_device_id),
		)
		conn.execute(
			"INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
			("last_run_utc", _utc_now_iso()),
		)
		conn.commit()

		total_changed = 0
		total_skipped = 0

		def fetch_page(page: int) -> tuple[int, list[dict[str, Any]]]:
			# Per-thread opener+cookies to avoid thread-safety issues.
			opener = _build_opener()
			url = build_url(index_code=index_code, page=page, size=size)
			payload = request_json(
				opener,
				url,
				headers,
				timeout_s=timeout_s,
				retries=retries,
				backoff_base_s=backoff_base_s,
			)
			if not isinstance(payload, dict):
				raise RuntimeError(f"Unexpected response type: {type(payload)}")
			if payload.get("status") not in (200, None) and payload.get("successful") is False:
				raise RuntimeError(f"API returned failure: {payload.get('msg')!r}")
			data = payload.get("data") or {}
			content = data.get("content") or []
			if not isinstance(content, list):
				raise RuntimeError("Unexpected data.content type")
			return page, content

		pages = list(range(start_page, end_page + 1))

		if workers <= 1:
			for page in pages:
				_, content = fetch_page(page)
				fetched_at = _utc_now_iso()
				changed, skipped = upsert_items(
					conn, index_code=index_code, items=content, fetched_at=fetched_at
				)
				total_changed += changed
				total_skipped += skipped
				print(f"Page {page}: {len(content)} rows | upserted {changed} | skipped {skipped}")
				if sleep_between_pages_s > 0 and page != end_page:
					time.sleep(sleep_between_pages_s)
		else:
			with ThreadPoolExecutor(max_workers=workers) as ex:
				future_map = {ex.submit(fetch_page, p): p for p in pages}
				for fut in as_completed(future_map):
					page, content = fut.result()
					fetched_at = _utc_now_iso()
					changed, skipped = upsert_items(
						conn, index_code=index_code, items=content, fetched_at=fetched_at
					)
					total_changed += changed
					total_skipped += skipped
					print(f"Page {page}: {len(content)} rows | upserted {changed} | skipped {skipped}")

		print(
			f"Done. Pages {start_page}..{end_page} | total upserted {total_changed} | total skipped {total_skipped} | db={db_path}"
		)
	finally:
		conn.close()


def parse_args() -> argparse.Namespace:
	p = argparse.ArgumentParser(description="Fetch Vietcap index history and store into SQLite")
	p.add_argument(
		"--index",
		action="append",
		default=None,
		help="Index code (repeatable). Example: --index VNINDEX --index VN30",
	)
	p.add_argument(
		"--indexes",
		default=None,
		help="Comma-separated indexes. Example: VNINDEX,VN30,HNXIndex",
	)
	p.add_argument("--start-page", type=int, default=0, help="Start page (inclusive)")
	p.add_argument("--end-page", type=int, default=45, help="End page (inclusive)")
	p.add_argument("--size", type=int, default=50, help="Page size")
	p.add_argument(
		"--incremental",
		action="store_true",
		help="Only insert rows with tradingDate newer than the latest date in the DB",
	)
	p.add_argument(
		"--db",
		default=None,
		help="SQLite db file for single-index runs. If omitted, defaults to <INDEX>.sqlite",
	)
	p.add_argument(
		"--db-dir",
		default=".",
		help="Directory to write per-index SQLite files when fetching multiple indexes",
	)
	p.add_argument(
		"--device-id",
		default=None,
		help="Optional device-id header value (hex string). If omitted, random per run.",
	)
	p.add_argument("--timeout", type=int, default=30, help="HTTP timeout (seconds)")
	p.add_argument("--retries", type=int, default=6, help="Retry count for transient errors")
	p.add_argument("--backoff", type=float, default=0.8, help="Backoff base seconds")
	p.add_argument(
		"--workers",
		type=int,
		default=10,
		help="Parallel fetch workers (threads). SQLite writes remain single-threaded.",
	)
	p.add_argument(
		"--sleep", type=float, default=0.05, help="Sleep seconds between pages (reduce rate-limit)"
	)
	return p.parse_args()


def _sanitize_filename(stem: str) -> str:
	stem = stem.strip()
	if not stem:
		return "index"
	# Keep letters/numbers/._- ; replace others with underscore
	stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)
	return stem.strip("._-") or "index"


def _resolve_indexes(args: argparse.Namespace) -> list[str]:
	if args.indexes:
		parts = [p.strip() for p in str(args.indexes).split(",")]
		return [p for p in parts if p]
	if args.index:
		return [str(x).strip() for x in args.index if str(x).strip()]
	return ["VNINDEX"]


def main() -> int:
	args = parse_args()
	indexes = _resolve_indexes(args)

	for index_code in indexes:
		if args.db:
			db_path = str(args.db)
		else:
			db_name = f"{_sanitize_filename(index_code)}.sqlite"
			db_path = str(args.db_dir).rstrip("\\/") + "/" + db_name
		print(f"\n=== Fetch {index_code} -> {db_path} ===")
		fetch_kwargs: dict[str, Any] = {
			"index_code": str(index_code),
			"start_page": int(args.start_page),
			"end_page": int(args.end_page),
			"size": int(args.size),
			"db_path": db_path,
			"device_id": (str(args.device_id) if args.device_id else None),
			"timeout_s": int(args.timeout),
			"retries": int(args.retries),
			"backoff_base_s": float(args.backoff),
			"workers": int(args.workers),
			"sleep_between_pages_s": float(args.sleep),
		}
		# Backward-compatible: some deployed variants of fetch_pages_to_sqlite
		# do not accept `incremental`. Only pass it when supported.
		if "incremental" in inspect.signature(fetch_pages_to_sqlite).parameters:
			fetch_kwargs["incremental"] = bool(args.incremental)

		fetch_pages_to_sqlite(**fetch_kwargs)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())

