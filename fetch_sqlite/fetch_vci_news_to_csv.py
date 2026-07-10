#!/usr/bin/env python3
"""Fetch VCI market news từ 2023-01-01 đến 2026-04-30 vào CSV.

Fetch từng tháng, mỗi tháng lấy hết các page, sleep giữa các request
để tránh bị rate-limit từ VCI.

Dùng:
    python fetch_sqlite/fetch_vci_news_to_csv.py --out exports/vci_news_2023_2026.csv
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import random
import time
from typing import Any

import requests

NEWS_API_URL = "https://ai.vietcap.com.vn/api/v3/news_info"

CSV_FIELDS = [
    "id",
    "ticker",
    "industry",
    "news_title",
    "news_short_content",
    "news_source_link",
    "news_image_url",
    "update_date",
    "news_from",
    "news_from_name",
    "sentiment",
    "score",
    "slug",
    "male_audio_duration",
    "female_audio_duration",
]


def _headers() -> dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://trading.vietcap.com.vn",
        "Referer": "https://trading.vietcap.com.vn/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }


def _request_json(params: dict[str, Any], timeout_s: int, retries: int, verify_ssl: bool) -> Any:
    for attempt in range(retries + 1):
        try:
            r = requests.get(NEWS_API_URL, params=params, headers=_headers(), timeout=timeout_s, verify=verify_ssl)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt >= retries:
                raise
            sleep_s = 2.0 * (2 ** attempt) + random.uniform(0, 0.5)
            print(f"  [retry {attempt+1}/{retries}] lỗi: {e}  sleep {sleep_s:.1f}s")
            time.sleep(sleep_s)
    raise RuntimeError("request thất bại")


def _months_in_range(start: dt.date, end: dt.date) -> list[tuple[dt.date, dt.date]]:
    """Trả về list (month_start, month_end) bao phủ từ start đến end."""
    result = []
    cur = start.replace(day=1)
    while cur <= end:
        # month_end = last day of cur month
        if cur.month == 12:
            next_month = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            next_month = cur.replace(month=cur.month + 1, day=1)
        month_end = next_month - dt.timedelta(days=1)
        result.append((max(cur, start), min(month_end, end)))
        cur = next_month
    return result


def fetch_month(
    date_from: dt.date,
    date_to: dt.date,
    *,
    ticker: str,
    page_size: int,
    sleep_between_pages: float,
    timeout_s: int,
    retries: int,
    verify_ssl: bool,
) -> list[dict[str, Any]]:
    """Fetch toàn bộ pages cho một tháng, trả về list items."""
    all_items: list[dict[str, Any]] = []
    page = 1
    while True:
        params = {
            "page": page,
            "ticker": ticker,
            "industry": "",
            "update_from": date_from.strftime("%Y-%m-%d"),
            "update_to": date_to.strftime("%Y-%m-%d"),
            "sentiment": "",
            "newsfrom": "",
            "language": "vi",
            "page_size": page_size,
        }
        data = _request_json(params, timeout_s=timeout_s, retries=retries, verify_ssl=verify_ssl)
        items = list(data.get("news_info", []) or [])
        if not items:
            break
        all_items.extend(items)
        print(f"    page {page}: {len(items)} items  (tổng tháng này: {len(all_items)})")
        if len(items) < page_size:
            # trang cuối
            break
        page += 1
        time.sleep(sleep_between_pages + random.uniform(0, 0.3))
    return all_items


def _row(item: dict[str, Any]) -> dict[str, Any]:
    news_id = item.get("id") or item.get("news_id") or item.get("_id") or ""
    return {
        "id": str(news_id),
        "ticker": (item.get("ticker") or "").upper(),
        "industry": item.get("industry") or "",
        "news_title": item.get("news_title") or item.get("title") or "",
        "news_short_content": item.get("news_short_content") or "",
        "news_source_link": item.get("news_source_link") or item.get("url") or "",
        "news_image_url": item.get("news_image_url") or item.get("image_url") or "",
        "update_date": item.get("update_date") or item.get("publish_date") or "",
        "news_from": item.get("news_from") or "",
        "news_from_name": item.get("news_from_name") or item.get("source") or "",
        "sentiment": item.get("sentiment") or "",
        "score": item.get("score") if item.get("score") is not None else "",
        "slug": item.get("slug") or "",
        "male_audio_duration": item.get("male_audio_duration") if item.get("male_audio_duration") is not None else "",
        "female_audio_duration": item.get("female_audio_duration") if item.get("female_audio_duration") is not None else "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch VCI market news to CSV (2023-2026)")
    parser.add_argument("--out", default="exports/vci_news_2023_2026.csv", help="Đường dẫn file CSV output")
    parser.add_argument("--ticker", default="", help="Lọc theo mã CK (mặc định: tất cả)")
    parser.add_argument("--start", default="2023-01-01", help="Ngày bắt đầu YYYY-MM-DD")
    parser.add_argument("--end", default="2026-04-30", help="Ngày kết thúc YYYY-MM-DD")
    parser.add_argument("--page-size", type=int, default=50, help="Page size (tối đa 50)")
    parser.add_argument("--sleep", type=float, default=1.5, help="Sleep (giây) giữa các page request")
    parser.add_argument("--sleep-month", type=float, default=3.0, help="Sleep (giây) giữa các tháng")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout giây")
    parser.add_argument("--retries", type=int, default=4, help="Số lần retry khi lỗi")
    parser.add_argument("--insecure", action="store_true", help="Tắt SSL verification")
    parser.add_argument("--append", action="store_true", help="Append vào file CSV có sẵn (không ghi đè, bỏ qua header)")
    args = parser.parse_args()

    start_date = dt.date.fromisoformat(args.start)
    end_date = dt.date.fromisoformat(args.end)
    page_size = min(max(args.page_size, 1), 50)
    ticker = (args.ticker or "").strip().upper()
    verify_ssl = not args.insecure

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)

    # Nếu append, load các ID đã có để deduplicate
    seen_ids: set[str] = set()
    if args.append and os.path.exists(args.out):
        with open(args.out, newline="", encoding="utf-8-sig") as ef:
            reader = csv.DictReader(ef)
            for row in reader:
                if row.get("id"):
                    seen_ids.add(row["id"])
        print(f"Đã load {len(seen_ids)} ID có sẵn từ file (deduplicate)")

    months = _months_in_range(start_date, end_date)
    print(f"Sẽ fetch {len(months)} tháng từ {start_date} đến {end_date}")
    print(f"Output: {args.out}  |  append={args.append}")
    print(f"Sleep giữa pages: {args.sleep}s  |  Sleep giữa tháng: {args.sleep_month}s")
    print("-" * 60)

    total_written = 0
    file_mode = "a" if args.append else "w"

    with open(args.out, file_mode, newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if not args.append:
            writer.writeheader()

        for i, (d_from, d_to) in enumerate(months):
            label = f"{d_from.strftime('%Y-%m')} ({d_from} → {d_to})"
            print(f"[{i+1}/{len(months)}] Tháng {label}")

            try:
                items = fetch_month(
                    d_from,
                    d_to,
                    ticker=ticker,
                    page_size=page_size,
                    sleep_between_pages=args.sleep,
                    timeout_s=args.timeout,
                    retries=args.retries,
                    verify_ssl=verify_ssl,
                )
            except Exception as e:
                print(f"  [LỖI] bỏ qua tháng {label}: {e}")
                time.sleep(args.sleep_month * 2)
                continue

            new_count = 0
            for item in items:
                row = _row(item)
                nid = row["id"]
                if not nid or nid in seen_ids:
                    continue
                seen_ids.add(nid)
                writer.writerow(row)
                new_count += 1

            total_written += new_count
            print(f"  => {new_count} dòng mới ghi vào CSV  (tổng: {total_written})")

            if i < len(months) - 1:
                time.sleep(args.sleep_month + random.uniform(0, 0.5))

    print("=" * 60)
    print(f"Hoàn tất. Tổng {total_written} bản ghi → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
