# News SQLite Cache (VCI AI)

Mục tiêu: giảm latency và tránh gọi upstream (ai.vietcap.com.vn) mỗi request bằng cách **prefetch news định kỳ** và phục vụ API từ SQLite.

## Files chuẩn

- SQLite DB (ưu tiên): `fetch_sqlite/vci_ai_news.sqlite`
- Legacy DB (fallback): `fetch_sqlite/vci_news.sqlite`
- Fetcher script: `fetch_sqlite/fetch_vci_news.py`
- Backend reader: `backend/services/vci_news_sqlite.py`
- API endpoints:
  - `/api/market/news` đọc SQLite trước, stale thì fallback upstream
  - `/api/stock/news/<symbol>` đọc SQLite trước, fallback upstream

## Fetch định kỳ (5 phút)

Trên VPS dùng cron (xem `automation/setup_cron_vps.sh`):

```bash
*/5 * * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_news.py \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 5 --page-size 50 --days-back 30 \
  --workers 10 --insecure \
  >> fetch_sqlite/cron_vci_ai_news.log 2>&1
```

## Prefill “backup sẵn” (10 trang, worker 10)

Chạy thủ công:

```bash
python fetch_sqlite/fetch_vci_news.py \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 10 --page-size 50 --days-back 30 \
  --workers 10 --insecure
`vci_ai_news_YYYYmmdd_HHMMSSZ.sqlite`

## Schema

- Table: `news_items`
  - `id` (PRIMARY KEY)
  - `ticker`, `update_date`, `news_title`, `news_source_link`, ...
  - `raw_json` lưu full JSON để backend trả ra nguyên bản (dễ forward/đổi UI mà không phải migrate schema).
- Table: `news_meta`
  - `last_fetch_utc`: ISO timestamp
  - `last_fetch_ticker`: ticker đã fetch (empty = market news)

## Duplicate & retention

- Duplicate: `news_items.id` là PRIMARY KEY nên fetch lại cùng 1 bài sẽ **upsert** (update row), không tạo row trùng.
- Retention: mặc định **không tự xoá** bài cũ. Trên VPS cron nên bật `--prune-days` để DB không phình mãi.

Ví dụ giữ 60 ngày gần nhất (theo `fetched_at_utc`):

```bash
python fetch_sqlite/fetch_vci_news.py --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 5 --page-size 50 --days-back 30 --workers 10 --insecure \
  --prune-days 60
```

## Debug nhanh

```sql
SELECT COUNT(*) FROM news_items;
SELECT value FROM news_meta WHERE key='last_fetch_utc';
SELECT ticker, update_date, news_title FROM news_items ORDER BY update_date DESC LIMIT 20;
```

## Note về SSL

`--insecure` sẽ tắt verify SSL (match behavior hiện tại trong `NewsService`). Nếu server upstream ổn định SSL, có thể bỏ `--insecure`.
