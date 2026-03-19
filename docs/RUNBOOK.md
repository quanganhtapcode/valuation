# RUNBOOK — Vietnam Stock Data Platform

Tài liệu vận hành chi tiết. Đọc khi: deploy mới, debug lỗi, onboard thành viên mới.

> Version: 2026-03 | VPS: `203.55.176.10` | Path: `/var/www/valuation`

---

## Mục lục

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Quy trình phát triển & deploy](#2-quy-trình-phát-triển--deploy)
3. [Vận hành hàng ngày](#3-vận-hành-hàng-ngày)
4. [Kiểm tra sức khỏe hệ thống](#4-kiểm-tra-sức-khỏe-hệ-thống)
5. [Debug pipeline lỗi](#5-debug-pipeline-lỗi)
6. [Các lỗi đã biết & cách fix](#6-các-lỗi-đã-biết--cách-fix)
7. [Biến môi trường](#7-biến-môi-trường)
8. [Database](#8-database)
9. [Scaling & bảo trì](#9-scaling--bảo-trì)

---

## 1. Kiến trúc tổng quan

```
┌──────────────────────────── VPS 203.55.176.10 ─────────────────────────────┐
│                                                                              │
│  ┌─ crontab ──────────────────────────────────────────────────────────┐     │
│  │  */5  min  fetch_vci_screener.py  → vci_screening.sqlite           │     │
│  │  */5  min  fetch_vci_news.py      → vci_ai_news.sqlite             │     │
│  │  */15 min  fetch_vci.py           → index_history.sqlite           │     │
│  │  */15 min  fetch_vci_standouts.py → vci_ai_standouts.sqlite        │     │
│  │  */30 min  telegram_uptime_report.sh                               │     │
│  │  Sun 03:00 backup_vci_screening.py                                 │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌─ systemd stock-fetch.timer (18:00 daily) ──────────────────────────┐     │
│  │  run_pipeline.py                                                    │     │
│  │    Step 1: backend.updater → balance_sheet/income/cashflow         │     │
│  │            (smart-skip nếu updated < 30 ngày)                      │     │
│  │    Step 2: (Chủ nhật) update company info                          │     │
│  │    Step 3: scripts/create_compat_views.py                          │     │
│  └─────────────────────────────────── → vietnam_stocks.db ───────────┘     │
│                                                                              │
│  ┌─ valuation.service (gunicorn, always-on) ──────────────────────────┐     │
│  │  backend/server.py :8000                                            │     │
│  │    /api/stock/*          ← vietnam_stocks.db                       │     │
│  │    /api/market/*         ← index_history.sqlite, vci_screening     │     │
│  │    /api/valuation/*      ← vietnam_stocks.db                       │     │
│  │    /api/download/*       ← Cloudflare R2                           │     │
│  └─────────────────────────────────────────────────────────────────── ┘     │
│                                                                              │
│  nginx :443  →  Flask :8000  (/v1/valuation/* → /api/*)                     │
└──────────────────────────────────────────────────────────────────────────── ┘
          │
     Vercel CDN — stock.quanganh.org (Next.js frontend)
```

### Domain mapping

| Domain | Nơi | Vai trò |
|---|---|---|
| `stock.quanganh.org` | Vercel | Next.js frontend |
| `api.quanganh.org` | VPS | nginx → Flask :8000 |

---

## 2. Quy trình phát triển & deploy

### Bước 1 — Làm việc local

```powershell
cd "C:\Users\PC\Downloads\Hello"
.venv\Scripts\activate
# sửa code...
```

### Bước 2 — Chạy test local (bắt buộc trước khi deploy)

```powershell
# Quick mode: chỉ syntax + imports (~10 giây)
.\scripts\test_local.ps1 -Quick

# Full mode: syntax + imports + spin up local server + test endpoints (~60 giây)
.\scripts\test_local.ps1

# Chỉ test endpoints (nếu server đang chạy sẵn ở cổng 8099)
.\scripts\test_local.ps1 -ApiOnly
```

> **Quy tắc**: Không deploy khi test_local.ps1 còn báo `[FAIL]`.

### Bước 3 — Deploy lên production

```powershell
# Commit + push GitHub + sync lên VPS + restart service
.\automation\deploy.ps1 -CommitMessage "fix: mô tả thay đổi"

# Kèm upload DB mới (cẩn thận — file ~1.6GB)
.\automation\deploy.ps1 -IncludeDatabase

# Bỏ qua pre-deploy tests (không khuyến khích)
.\automation\deploy.ps1 -SkipTests
```

Deploy tự động:
1. Chạy `test_local.ps1 -Quick`
2. `git add . && git commit && git push`
3. `scp` các folder `backend/`, `fetch_sqlite/`, `scripts/`, `automation/`
4. Dọn `__pycache__`, fix line endings
5. `systemctl restart valuation`
6. Smoke test: `/health`, `/api/market/vci-indices`, `/api/stock/VCB`

---

## 3. Vận hành hàng ngày

### Lịch tự động

| Thời gian | Script | Output DB |
|---|---|---|
| */5 phút | `fetch_vci_screener.py` | `vci_screening.sqlite` |
| */5 phút | `fetch_vci_news.py` | `vci_ai_news.sqlite` |
| */15 phút | `fetch_vci.py` | `index_history.sqlite` |
| */15 phút | `fetch_vci_standouts.py` | `vci_ai_standouts.sqlite` |
| */30 phút | `telegram_uptime_report.sh` | log |
| **18:00 daily** | `run_pipeline.py` (BCTC) | `vietnam_stocks.db` |
| Chủ nhật 18:00 | `run_pipeline.py` + company info | `vietnam_stocks.db` |
| Chủ nhật 03:00 | `backup_vci_screening.py` | `fetch_sqlite/backups/` |

### Chạy pipeline thủ công

```bash
# Cách 1: qua systemd (khuyến dùng — lưu history trong journalctl)
systemctl start stock-fetch.service

# Cách 2: trực tiếp
source /var/www/valuation/.env
cd /var/www/valuation
PYTHONPATH=/var/www/valuation .venv/bin/python3 run_pipeline.py

# Cách 3: force update company info (không đợi Chủ nhật)
FORCE_COMPANY_UPDATE=1 .venv/bin/python3 run_pipeline.py

# Chỉ refresh views (không fetch API)
PYTHONPATH=/var/www/valuation .venv/bin/python3 scripts/create_compat_views.py
```

---

## 4. Kiểm tra sức khỏe hệ thống

### Quick health check (từ Windows)

```powershell
$key = "$HOME\Desktop\key.pem"
ssh -i $key root@203.55.176.10 "curl -s http://127.0.0.1:8000/health | python3 -m json.tool"
```

### Comprehensive check (trên VPS)

```bash
# Service status
systemctl is-active valuation stock-fetch.timer

# API smoke test
BASE="http://localhost:8000"
for ep in /health /api/stock/VCB /api/market/vci-indices /api/valuation/VCB; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$ep")
  echo "$code  $ep"
done

# Pipeline log (10 dòng cuối)
tail -20 /var/www/valuation/logs/pipeline.log

# Cron logs
tail -5 /var/www/valuation/fetch_sqlite/cron_screener.log
tail -5 /var/www/valuation/fetch_sqlite/cron_vci_ai_news.log

# Disk usage
du -sh /var/www/valuation/vietnam_stocks.db
df -h /var/www/valuation
```

### Khi /health trả về field nào đó "stale"

| Field | Stale threshold | Hành động |
|---|---|---|
| `cron_screener` | > 10 phút | Kiểm tra `crontab -l`, xem `cron_screener.log` |
| `cron_news` | > 10 phút | Xem `cron_vci_ai_news.log` |
| `index_history` | > 20 phút | Xem `cron.log` |
| `main_db` | > 25 giờ | Pipeline chưa chạy? Xem `pipeline.log` |
| `pipeline_log` | > 26 giờ | `systemctl status stock-fetch.timer` |

---

## 5. Debug pipeline lỗi

### Xem log chi tiết

```bash
# Log pipeline hiện tại
tail -100 /var/www/valuation/logs/pipeline.log

# Log systemd (có cả stderr từ gunicorn / pipeline)
journalctl -u stock-fetch.service --no-pager -n 100

# Live tail khi pipeline đang chạy
journalctl -u stock-fetch.service -f
```

### Pipeline báo `updated=0/N symbols`

**Nguyên nhân thường gặp:**

1. **`KeyError: 'data'` từ vnstock VCI Company API** (lỗi đã biết)
   - Kiểm tra: `journalctl -u stock-fetch.service -n 50`
   - Fix: code đã monkey-patch tự động trong `backend/updater/updaters.py`
   - Nếu vẫn lỗi: xem mục [Lỗi đã biết](#6-các-lỗi-đã-biết--cách-fix)

2. **Rate limit / API key hết quota**
   ```bash
   grep "rate\|quota\|429\|limit" /var/www/valuation/logs/pipeline.log | tail -20
   ```
   Fix: thêm `VNSTOCK_API_KEY` vào `.env`, hoặc thêm key rotation qua `VNSTOCK_API_KEYS=key1,key2`

3. **Smart-skip bỏ qua tất cả** (data còn mới)
   - Bình thường nếu pipeline chạy trong vòng 30 ngày
   - Log sẽ có `⊙ Skip VCB (balance_sheet updated < 30d ago)`
   - Force re-fetch: `SKIP_IF_UPDATED_WITHIN_DAYS=0 .venv/bin/python3 run_pipeline.py`

4. **PYTHONPATH không set**
   ```bash
   PYTHONPATH=/var/www/valuation .venv/bin/python3 -c "import backend.updater; print('OK')"
   ```

### Service crash loop

```bash
journalctl -u valuation -n 30 --no-pager
# Tìm dòng "cannot import name" → là import error
# Tìm "ModuleNotFoundError" → missing package
```

Fix import error:
```bash
cd /var/www/valuation
PYTHONPATH=/var/www/valuation .venv/bin/python3 /tmp/ci.py
# (upload ci.py từ AppData/Local/Temp/ci.py)
```

---

## 6. Các lỗi đã biết & cách fix

### ❶ `KeyError: 'data'` — VCI Company API thay đổi format

**Nguyên nhân**: vnstock `explorer/vci/company.py` gọi VCI GraphQL, VCI trả về response không có key `'data'` (auth header thay đổi, quota exceeded, hoặc API breaking change).

**Impact**: `Vnstock().stock()` throw exception → không fetch được bất kỳ mã nào.

**Fix đã áp dụng** (trong `backend/updater/updaters.py`):
```python
# Monkey-patch: nếu Company._fetch_data fails, trả về {} thay vì crash
# Finance module dùng endpoint khác → vẫn hoạt động bình thường
```

**Nếu fix này không đủ**: tăng cường bằng cách dùng source khác:
```python
stock = self.vnstock.stock(symbol=symbol, source='TCBS')
```

### ❷ `cannot import name 'ValuationService'`

**Nguyên nhân**: deploy chỉ update một số file, file `valuation_service.py` trên VPS còn cũ (không có class `ValuationService`).

**Fix**: `scp` file mới lên, restart service.
```powershell
scp -i "$HOME\Desktop\key.pem" backend\services\valuation_service.py root@203.55.176.10:/var/www/valuation/backend/services/
ssh -i "$HOME\Desktop\key.pem" root@203.55.176.10 "systemctl restart valuation"
```

**Phòng tránh**: luôn dùng `deploy.ps1` thay vì scp từng file thủ công.

### ❸ Pipeline chạy nhanh bất thường (< 5 phút cho 1556 mã)

**Nguyên nhân**: Smart-skip đang bỏ qua tất cả vì data còn mới, hoặc mọi mã đều lỗi (không có API delay).

**Phân biệt**:
- Smart-skip bình thường → log có `⊙ Skip VCB`
- Lỗi toàn bộ → log có `✗ Error updating VCB`

### ❹ Frontend Vercel không thấy dữ liệu mới

1. Kiểm tra backend: `curl -s https://api.quanganh.org/v1/valuation/api/stock/VCB | head -100`
2. Kiểm tra nginx: `nginx -t && systemctl status nginx`
3. Kiểm tra CORS: response phải có `Access-Control-Allow-Origin`

---

## 7. Biến môi trường

### `/var/www/valuation/.env` (VPS production)

```env
# Bắt buộc — pipeline không chạy nếu thiếu
VNSTOCK_API_KEY=vnstock_xxxxxxxxxxxxxxxxxxxxxxxx

# Tuỳ chọn — nhiều key để rotation khi hết quota
VNSTOCK_API_KEYS=key1,key2,key3

# Database paths (phải match nhau)
VIETNAM_STOCK_DB_PATH=/var/www/valuation/vietnam_stocks.db
STOCKS_DB_PATH=/var/www/valuation/vietnam_stocks.db

# Pipeline tuning
FETCH_PERIOD=year                   # year | quarter
SKIP_IF_UPDATED_WITHIN_DAYS=30      # smart-skip threshold

# Cloudflare R2 (tuỳ chọn — dùng cho /api/download)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
```

### `.env.example` (local dev template)

```env
VNSTOCK_API_KEY=<lấy từ vnstocks.com/login>
STOCKS_DB_PATH=vietnam_stocks.db
```

### `frontend-next/.env.local` (local Next.js dev)

```env
BACKEND_API_URL_LOCAL=http://127.0.0.1:8000/api
NEXT_PUBLIC_BACKEND_WS_URL=ws://127.0.0.1:8000
```

---

## 8. Database

### File chính

```
/var/www/valuation/vietnam_stocks.db   (~1.6 GB)
```

### Bảng thật (do pipeline viết)

| Bảng | Viết bởi | Mô tả |
|---|---|---|
| `stocks` | `CompanyUpdater` | Danh sách cổ phiếu |
| `company_overview` | `CompanyUpdater` | Thông tin công ty |
| `balance_sheet` | `FinancialUpdater` | CĐKT năm/quý |
| `income_statement` | `FinancialUpdater` | KQKD năm/quý |
| `cash_flow_statement` | `FinancialUpdater` | LCTT năm/quý |
| `financial_ratios` | `FinancialUpdater` | Tỷ số tài chính |
| `update_log` | tất cả updater | Lịch sử cập nhật |

### Views tương thích (do `scripts/create_compat_views.py` tạo)

| View | Dùng bởi | Mô tả |
|---|---|---|
| `overview` | stock API | Tổng quan 1 mã (PE, PB, ROE…) |
| `ratio_wide` | valuation API | Lịch sử tỷ số dạng cột rộng |
| `company` | stock API | Info công ty + ngành |
| `fin_stmt` | revenue-profit API | BCTC JSON |

### Integrity check

```bash
sqlite3 /var/www/valuation/vietnam_stocks.db "PRAGMA integrity_check;"
# → ok

# Đếm nhanh
sqlite3 /var/www/valuation/vietnam_stocks.db "
  SELECT 'stocks' tbl, count(*) n FROM stocks
  UNION ALL SELECT 'balance_sheet', count(*) FROM balance_sheet
  UNION ALL SELECT 'income_statement', count(*) FROM income_statement
  UNION ALL SELECT 'overview view', count(*) FROM overview;
"
```

---

## 9. Scaling & bảo trì

### Tăng tần suất fetch real-time (mặc định 5 phút)

Sửa crontab trên VPS:
```bash
crontab -e
# Đổi */5 → */3
```

### Thêm mã chứng khoán mới vào pipeline

1. Thêm vào `symbols.txt` (mỗi dòng 1 mã, uppercase)
2. Deploy: `.\automation\deploy.ps1`
3. Trigger manual: `systemctl start stock-fetch.service`

### Reset smart-skip (force re-fetch toàn bộ)

```bash
source /var/www/valuation/.env
PYTHONPATH=/var/www/valuation SKIP_IF_UPDATED_WITHIN_DAYS=0 \
  .venv/bin/python3 run_pipeline.py
```
> ⚠️ Sẽ mất nhiều giờ và dùng nhiều API quota.

### Dọn dẹp disk

```bash
# Xem top consumer
du -sh /var/www/valuation/* | sort -rh | head -10

# Dọn log cũ
find /var/www/valuation/logs -name "*.log" -mtime +30 -delete
find /var/www/valuation/fetch_sqlite -name "*.log" -mtime +30 -delete

# Vacuum DB
sqlite3 /var/www/valuation/vietnam_stocks.db "VACUUM;"
```

### Backup DB thủ công

```bash
cp /var/www/valuation/vietnam_stocks.db \
   /var/www/valuation/backups/vietnam_stocks_$(date +%Y%m%d).db
```
