# Hướng dẫn Vận hành VPS

---

## 0. Kiến trúc Domain (stock.quanganh.org & api.quanganh.org)

### Sơ đồ tổng thể

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                          │
│                                                                   │
│  REST  :  stock.quanganh.org/api/*                               │
│           → Vercel (Next.js proxy)                                │
│              → api.quanganh.org/v1/valuation/*  (nginx :443)     │
│                 → Flask :8000  (/api/*)                           │
│                                                                   │
│  WebSocket:  wss://api.quanganh.org/v1/valuation/ws/market/indices│
│           → nginx :443 (ws passthrough)                           │
│              → Flask :8000  (/ws/market/indices)                  │
│           [Vercel không proxy WebSocket — browser kết nối thẳng] │
└──────────────────────────────────────────────────────────────────┘
```

### Domain mapping

| Domain | Nơi chạy | Vai trò |
|---|---|---|
| `stock.quanganh.org` | Vercel | Next.js frontend |
| `api.quanganh.org` | VPS `203.55.176.10` | API gateway (nginx) |

### nginx routes trên api.quanganh.org

| Prefix | Rewrite | Backend |
|---|---|---|
| `/v1/valuation/ws/*` | không rewrite | Flask :8000 `/ws/*` (WebSocket) |
| `/v1/valuation/*` | → `/api/$1` | Flask :8000 |
| `/v1/store/*` | → `/api/$1` | PM2 store :3001 |
| `/v1/invoice/*` | → `/$1` | Invoice :3000 |

Config: [`deployment/api.quanganh.org.nginx.conf`](deployment/api.quanganh.org.nginx.conf)

### Environment variables (frontend-next)

| Variable | Scope | Giá trị production |
|---|---|---|
| `BACKEND_API_URL` | Server-side (Vercel edge) | `https://api.quanganh.org/v1/valuation` |
| `BACKEND_API_URL_LOCAL` | Server-side (dev) | `http://127.0.0.1:8000/api` |
| `NEXT_PUBLIC_API_URL` | Browser | *(để trống — dùng `/api` proxy mặc định)* |
| `NEXT_PUBLIC_BACKEND_WS_URL` | Browser | `wss://api.quanganh.org/v1/valuation` |

Xem thêm: [`frontend-next/.env.example`](frontend-next/.env.example), [`frontend-next/.env.production`](frontend-next/.env.production)

---

## 1. Lịch chạy hàng ngày

| Schedule | Loại | Script | DB output |
|---|---|---|---|
| Mỗi 5 phút | crontab | `fetch_vci_screener.py` | `vci_screening.sqlite` |
| Mỗi 5 phút | crontab | `fetch_vci_news.py` | `vci_ai_news.sqlite` |
| Mỗi 15 phút | crontab | `fetch_vci.py` | `index_history.sqlite` |
| Mỗi 15 phút | crontab | `fetch_vci_standouts.py` | `vci_ai_standouts.sqlite` |
| Mỗi 30 phút | crontab | `telegram_uptime_report.sh` | `telegram_uptime.log` |
| **18:00 hàng ngày** | systemd | `run_pipeline.py` | `vietnam_stocks.db` |
| Chủ nhật 18:00 | systemd | `run_pipeline.py` (thêm company info) | `vietnam_stocks.db` |

**Cơ chế smart-skip**: nếu BCTC của 1 mã đã được cập nhật trong 30 ngày qua, pipeline tự bỏ qua để tiết kiệm API quota.

---

## 2. Database duy nhất

Toàn bộ hệ thống dùng **một file DB duy nhất**:

```
/var/www/valuation/vietnam_stocks.db   (~1.6 GB)
```

Tất cả 3 biến môi trường đều trỏ về file này:
- `VIETNAM_STOCK_DB_PATH` (trong `/var/www/valuation/.env`)
- `STOCKS_DB_PATH` (trong `/var/www/valuation/.env`)
- `VSW_DB_PATH` (trong `/var/www/valuation/db_updater/.env`)

**Nguồn gốc**: snapshot `vietnam_stocks_liquidity_fixed_2026-02-18.db` từ GitHub Release [`v2026.02.18`](https://github.com/Thanhtran-165/baocaotaichinh-/releases/tag/v2026.02.18), `PRAGMA integrity_check: ok`.

**Bảng thật** (do db_updater viết): `stocks`, `company_overview`, `stock_exchange`, `stock_industry`, `financial_ratios`, `income_statement`, `balance_sheet`, `cash_flow_statement`

**Views tương thích** (do `scripts/create_compat_views.py` tạo, chạy sau mỗi pipeline):
| View | Mục đích |
|---|---|
| `overview` | Tổng hợp thông tin mã chứng khoán (1730 rows) |
| `ratio_wide` | Lịch sử tỷ số tài chính theo kỳ (73K rows) |
| `company` | Thông tin công ty, ngành, sàn (1730 rows) |
| `fin_stmt` | BCTC thu nhập dạng JSON cho revenue-profit API (180K rows) |

---

## 3. Pipeline daily — luồng xử lý (`run_pipeline.py`)

```
Bước 1: db_updater fetch BCTC hàng ngày (balance_sheet, income, cashflow, ratios)
         → smart-skip nếu mã đã update trong 30 ngày
Bước 2: (Chủ nhật only) db_updater update thông tin công ty
Bước 3: scripts/create_compat_views.py — refresh tất cả compatibility views
```

Delay mặc định giữa từng mã: `FETCH_DELAY_SECONDS=2.0` (set trong service file hoặc `.env`).
Không giảm xuống dưới 1s để tránh rate limit VCI API.

---

## 4. Kiểm tra trạng thái VPS

```bash
# Timer sẽ chạy lúc nào tiếp theo?
systemctl status stock-fetch.timer

# Xem log lần chạy cuối
journalctl -u stock-fetch.service --no-pager -n 50

# Xem pipeline.log đầy đủ
tail -f /var/www/valuation/logs/pipeline.log

# Health check API
curl -s http://localhost:8000/health | python3 -m json.tool

# Crontab hiện tại
crontab -l
```

---

## 5. Kiểm tra API (test nhanh)

```bash
# Kiểm tra toàn bộ endpoints chính (chạy trên VPS)
BASE="http://localhost:8000"
for ep in /health \
  "/api/stock/VCB" "/api/current-price/VCB" "/api/tickers" \
  "/api/market/vci-indices" "/api/market/news" "/api/market/index-history" \
  "/api/market/top-movers" "/api/market/gold" "/api/market/prices"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$ep")
  echo "$status  $ep"
done
```

Tất cả phải trả về `200`. Các route deprecated trả về `410`.

---

## 6. Chạy thủ công (manual trigger)

```bash
# Qua systemd (khuyên dùng — giữ history trong journalctl)
systemctl start stock-fetch.service

# Hoặc trực tiếp (cần load .env trước)
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/run_pipeline.py

# Chỉ refresh views (không fetch API)
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/scripts/create_compat_views.py
```

---

## 7. Biến môi trường quan trọng

File `/var/www/valuation/.env` phải chứa:

```env
VNSTOCK_API_KEY=vnstock_xxxxxxxxxxxxxxxxxxxxxxxx
VNSTOCK_API_KEYS=key1,key2          # Tuỳ chọn: nhiều key để rotation
VIETNAM_STOCK_DB_PATH=/var/www/valuation/vietnam_stocks.db
STOCKS_DB_PATH=/var/www/valuation/vietnam_stocks.db
```

File `/var/www/valuation/db_updater/.env` phải chứa:

```env
VSW_DB_PATH=/var/www/valuation/vietnam_stocks.db
```

Service file `/etc/systemd/system/stock-fetch.service` phải có dòng:

```ini
EnvironmentFile=/var/www/valuation/.env
```

> **Lưu ý**: Nếu thiếu `EnvironmentFile`, pipeline sẽ chạy ở chế độ "Guest"
> (20 req/phút) và crash rate-limit chỉ sau vài giây.

```bash
systemctl daemon-reload
systemctl show stock-fetch.service | grep -E 'EnvironmentFile|VNSTOCK'
```

---

## 8. Cài đặt lần đầu trên VPS mới

```bash
# 1. Cài systemd service + timer
cd /var/www/valuation/automation
bash setup_systemd.sh

# 2. Cài crontab (screener, news, standouts, index history, telegram)
bash setup_cron_vps.sh

# 3. Tạo file Telegram credentials
printf 'TELEGRAM_BOT_TOKEN=<token>\nTELEGRAM_CHAT_ID=<chat_id>\n' \
  > /var/www/valuation/.telegram_uptime.env
chmod 600 /var/www/valuation/.telegram_uptime.env

# 4. Test Telegram
bash /var/www/valuation/scripts/telegram_uptime_report.sh

# 5. Tải DB từ GitHub Release (nếu chưa có)
wget -O /var/www/valuation/vietnam_stocks.db \
  "https://github.com/Thanhtran-165/baocaotaichinh-/releases/download/v2026.02.18/vietnam_stocks_liquidity_fixed_2026-02-18.db"

# 6. Tạo compatibility views
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/scripts/create_compat_views.py

# 7. Chạy thử pipeline và theo dõi
systemctl start stock-fetch.service
journalctl -u stock-fetch.service -f
```

---

## 9. Telegram Uptime Monitor

Script: `scripts/telegram_uptime_report.sh`
Cron: `*/30 * * * *` (mỗi 30 phút)
Credentials: `/var/www/valuation/.telegram_uptime.env`

Nội dung báo cáo mỗi 30 phút:
- Hostname, thời gian, uptime hệ thống
- Load average (1/5/15 phút)
- Memory & disk usage
- Trạng thái service `valuation`
- Tóm tắt health check API `/health`

Chạy thủ công để test:
```bash
bash /var/www/valuation/scripts/telegram_uptime_report.sh
```

---

## 10. Troubleshooting

### Rate limit exceeded (vnstock "Guest" 20 req/phút)
**Nguyên nhân**: `EnvironmentFile` chưa có trong service, hoặc `.env` thiếu `VNSTOCK_API_KEY`.
**Fix**:
```bash
grep EnvironmentFile /etc/systemd/system/stock-fetch.service
# Nếu không có dòng trên, thêm vào và reload:
sed -i '/^ExecStart=/i EnvironmentFile=/var/www/valuation/.env' /etc/systemd/system/stock-fetch.service
systemctl daemon-reload
```

### Pipeline crash sau vài phút
Xem log chi tiết:
```bash
journalctl -u stock-fetch.service --no-pager -n 100
```

### DB không được update nhiều ngày
```bash
# Kiểm tra trigger cuối cùng
systemctl list-timers stock-fetch.timer --no-pager
# Persistent=true: nếu VPS bị tắt, sẽ chạy bù ngay khi bật lại
```

### Backend trả về lỗi "no such table: company" hoặc "no such table: overview"
Views bị mất (sau khi replace DB hoặc WAL checkpoint). Re-tạo:
```bash
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/scripts/create_compat_views.py
systemctl restart valuation
```

### Crontab không chạy (log file có đuôi `.log\r`)
```bash
# Kiểm tra CRLF trong crontab
crontab -l | cat -A | grep '\^M'
# Nếu có: xoá CRLF và reinstall
crontab -l | tr -d '\r' | crontab -
# Hoặc reinstall đúng:
bash /var/www/valuation/automation/setup_cron_vps.sh
```

---

## 11. Daily Price History Updates

The system maintains historical OHLCV (Open, High, Low, Close, Volume) data for all stocks in the `stock_price_history` table. Data is fetched from VCI IQ API and updated daily.

### Automated Updates

**Linux/VPS (via cron):**
```bash
# Runs daily at 11:30 UTC (18:30 VN time - after market close)
# Configured in automation/setup_cron_vps.sh
30 11 * * * cd /var/www/valuation && .venv/bin/python -m backend.updater.update_price_history >> logs/price_history_update.log 2>&1
```

**Windows (via Task Scheduler):**
1. Import scheduled task:
   ```powershell
   schtasks /Create /TN "PriceHistoryUpdate" /XML "automation\PriceHistoryUpdate.xml"
   ```
2. Or run manually:
   ```powershell
   .\automation\update_price_history.ps1
   ```

### Manual Updates

**Update all symbols (full run):**
```bash
python -m backend.updater.update_price_history
```

**Test mode (first 5 symbols only):**
```bash
python -m backend.updater.update_price_history --test
```

**Update specific symbols:**
```bash
python -m backend.updater.update_price_history --symbols VCB,FPT,VNM,HPG,VIC
```

### Configuration

Default settings in `backend/updater/update_price_history.py`:
- **Workers:** 10 concurrent threads
- **Delay:** 0.5s between requests per worker (~6 req/sec total)
- **Pages:** 10 pages per symbol (up to 2,500 daily candles = ~10 years)
- **Logs:** `logs/price_history_update.log`

### Data Source

- **API:** `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{symbol}/price-history`
- **Table:** `stock_price_history` in `vietnam_stocks.db`
- **Schema:**
  ```sql
  CREATE TABLE stock_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      time DATE NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, time)
  )
  ```

### Monitoring

Check update status:
```bash
# View recent logs
tail -f logs/price_history_update.log

# Check last update time
sqlite3 vietnam_stocks.db "SELECT MAX(created_at) FROM stock_price_history"

# Count records by symbol
sqlite3 vietnam_stocks.db "SELECT symbol, COUNT(*) FROM stock_price_history GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT 10"
```

### Troubleshooting

**No data for specific symbol:**
```bash
# Check if symbol exists in DB
sqlite3 vietnam_stocks.db "SELECT * FROM stocks WHERE ticker='VCB'"

# Manually fetch for one symbol
python -m backend.updater.update_price_history --symbols VCB
```

**API rate limiting:**
- Default 0.5s delay should be safe (6 req/sec)
- Increase delay if seeing errors: edit `delay` parameter in script

**Database locked:**
```bash
# Check for long-running queries
sqlite3 vietnam_stocks.db "PRAGMA wal_checkpoint(TRUNCATE)"
```

---

## 12. Realtime WebSocket

Biến môi trường tuỳ chỉnh WebSocket kết nối VCI:

| Biến | Default | Mô tả |
|---|---|---|
| `VCI_INDEX_REST_POLL_IDLE_SECONDS` | `3` | Polling interval khi WS idle |
| `VCI_INDEX_RECENT_WS_SECONDS` | `2.5` | Ngưỡng coi WS data là fresh |
| `VCI_INDEX_WS_BACKOFF_MIN_SECONDS` | `2` | Reconnect backoff tối thiểu |
| `VCI_INDEX_WS_BACKOFF_MAX_SECONDS` | `60` | Reconnect backoff tối đa |

WebSocket endpoint: `ws://api.quanganh.org/v1/valuation/ws/market/indices`
