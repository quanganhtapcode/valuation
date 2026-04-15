# SQLite Databases — Full Analysis

> Last updated: 2026-04-15 | Total active files: **14** | Total size: **~560 MB**

---

## Overview by Category

| Category | Files | Total Size | Purpose |
|---|---|---|---|
| **Financial Statements (VCI)** | 1 | 132 MB | BCTC wide-format từ VCI (balance sheet, income, cash flow, notes) |
| **Price Data** | 1 | 218 MB | Daily OHLCV cho tất cả cổ phiếu |
| **Market Screener** | 1 | 2.6 MB | Snapshot real-time — giá, PE, PB, ROE, sector, market cap |
| **Financial Ratios** | 2 | 10.1 MB | TTM ratios (hiện tại + lịch sử) + tracking PE/PB hàng ngày |
| **Company Info** | 1 | 3.5 MB | Hồ sơ công ty, tên tổ chức, phân loại ngành |
| **News & Events** | 2 | 190 MB | Tin tức thô + tin tức phân tích AI |
| **Market Indices** | 1 | 0.2 MB | Lịch sử chỉ số VNINDEX, VN30, HNX hàng ngày |
| **Foreign Trading** | 1 | 0.8 MB | Snapshot mua/bán nước ngoài + khối lượng theo phút |
| **Macro Economics** | 2 | 1.0 MB | GDP, CPI, M2, lãi suất từ VCI + Fireant |
| **Valuation** | 2 | 1.5 MB | Lịch sử PE/PB VNINDEX + cache tính toán DCF |
| **Shareholders** | 1 | 5.1 MB | Danh sách cổ đông theo công ty |

---

## Detailed File Analysis

### ~~`stocks_optimized.db`~~ — REMOVED

**Status:** Đã xóa 2026-04-15.

**Lý do:** Pipeline KBS/vnstock (`run_pipeline.py`) không còn chạy; dữ liệu trong DB bị mất. Toàn bộ chức năng đã được migrate sang các nguồn VCI.

**Thay thế bởi:**
| Chức năng cũ | Nguồn VCI mới |
|---|---|
| `overview.industry` | `vci_company.companies.icb_name4` |
| `overview.current_price` | `vci_screening.screening_data.marketPrice` |
| `overview.pe/pb/ps/roe` | `vci_stats_financial.stats_financial` |
| `overview.eps_ttm` | `marketPrice / pe` từ `vci_stats_financial` |
| `overview.bvps` | `marketPrice / pb` từ `vci_stats_financial` |
| `overview.shares_outstanding` | `vci_stats_financial.stats_financial.shares` |
| `company_overview.company_profile` | `vci_company.companies.company_profile` |
| `company_overview.icb_name*` | `vci_company.companies.icb_name*` |
| `income_statement / balance_sheet / cash_flow` | `vci_financials.sqlite` (wide format, field codes) |
| `valuation_datamart` (precomputed medians) | `vci_screening` + `vci_stats_financial` (live peers) |
| `stocks` (ticker list) | `vci_company.companies` |

---

### 1. `vci_financials.sqlite` — BCTC từ VCI

| Property | Value |
|---|---|
| **Size** | 132 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Financial API |
| **Update** | Daily (`fetch_vci_financial_statement.py`) |
| **Used by** | `vci_financial_adapter.py`, `valuation_service.py`, `/api/financial-report/` |
| **Field mapping** | `fetch_sqlite/vci_field_codes.json` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `income_statement` | ~33,382 | KQHĐKD wide-format (isa*, isb*, isi*, iss* columns) |
| `balance_sheet` | ~33,333 | Bảng CĐKT wide-format (bsa*, bsb*, bsi*, bss* columns) |
| `cash_flow` | ~32,936 | Lưu chuyển tiền tệ (cfa*, cfb*, cfi*, cfs* columns) |
| `note` | ~29,260 | Thuyết minh BCTC (noc*, nob*, noi*, nos* columns) |
| `fetch_log` | ~6,194 | Trạng thái fetch theo ticker |
| `meta` | 7 | Timestamp lần chạy cuối |

**VCI field code prefixes:**
- `*a*` → Công ty thông thường
- `*b*` → Ngân hàng
- `*i*` → Bảo hiểm
- `*s*` → Chứng khoán
- `nos*` → Off-balance-sheet

**Key fields cho valuation:**

| Field | Ý nghĩa |
|---|---|
| `isa1` | Doanh thu bán hàng |
| `isa3` | Doanh thu thuần |
| `isa7` | Chi phí tài chính |
| `isa20` | Lợi nhuận sau thuế |
| `isa22` | Lợi nhuận thuộc cổ đông công ty mẹ |
| `isa23` | EPS cơ bản (VND) |
| `bsa78` | Vốn chủ sở hữu (Owner's Equity) |
| `bsa80` | Vốn góp (Paid-in capital) |
| `bsa96` | Tổng cộng nguồn vốn (Total liabilities + Equity) |
| `cfa2` | Khấu hao TSCĐ |
| `cfa19` | Chi mua sắm TSCĐ (CapEx outflow) |

**Assessment:**
- ✅ Dữ liệu chi tiết hơn stocks_optimized.db — hàng trăm field code theo chuẩn VCI
- ✅ Hỗ trợ ngân hàng/bảo hiểm/chứng khoán với columns riêng biệt
- ✅ Nguồn dữ liệu BCTC chính thức, cập nhật daily
- ⚠️ ~33k rows vs 73k trước đây — số kỳ ít hơn, vẫn đang tích lũy
- 💡 Wide format (300+ columns) — tra cứu field code qua `vci_field_codes.json`

---

### 2. `price_history.sqlite` — Lịch sử giá OHLCV

| Property | Value |
|---|---|
| **Size** | 218 MB |
| **Location** | `/var/www/valuation/` |
| **Source** | VCI Price History API |
| **Update** | Daily 11:30 UTC (`update_price_history.py`) |
| **Used by** | `/api/stock/[symbol]/history`, chart rendering |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `stock_price_history` | 2,070,601+ | Daily OHLCV (open, high, low, close, volume) theo cổ phiếu |

**Assessment:**
- ✅ Nguồn duy nhất cho lịch sử giá — schema gọn, tập trung
- ✅ 2M+ rows cung cấp lịch sử nhiều năm cho ~1,700+ cổ phiếu
- 💡 Cân nhắc partition theo năm nếu query performance giảm

---

### 3. `vci_screening.sqlite` — Screener thời gian thực

| Property | Value |
|---|---|
| **Size** | 2.6 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Screener API |
| **Update** | Every 7 minutes (`fetch_vci_screener.py`) |
| **Used by** | `/api/market/screener`, peer comparison, `valuation_service.py` (giá hiện tại) |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `screening_data` | ~1,550 | Tất cả cổ phiếu niêm yết với metrics real-time |
| `meta` | — | Timestamp lần chạy cuối |

**Key columns:**
- **Giá:** `marketPrice`, `refPrice`, `ceiling`, `floor`, `dailyPriceChangePercent`
- **Khối lượng:** `accumulatedValue`, `accumulatedVolume`, `adtv30Days`, `avgVolume30Days`
- **Định giá:** `ttmPe`, `ttmPb`, `ttmRoe`
- **Tăng trưởng:** `npatmiGrowthYoyQm1`, `revenueGrowthYoy`
- **Biên lợi nhuận:** `netMargin`, `grossMargin`
- **Thông tin:** `enOrganName`, `viOrganName`, `exchange`, `icbCodeLv2`, `icbCodeLv4`, `enSector`, `viSector`
- **Khác:** `marketCap`, `stockStrength`

**Assessment:**
- ✅ Nguồn giá thời gian thực — cập nhật mỗi 7 phút
- ✅ Nguồn chính cho `current_price` trong valuation
- ✅ File nhỏ (2.6 MB) nhưng giàu metrics screening

---

### 4. `vci_stats_financial.sqlite` — TTM Ratios + Lịch sử

| Property | Value |
|---|---|
| **Size** | 10 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Stats Financial API |
| **Update** | Every 1 hour (`fetch_vci_stats_financial.py`) |
| **Used by** | `valuation_service.py` (PE, PB, PS, ROE, shares), `source_priority.py` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `stats_financial` | ~1,539 | TTM ratios mới nhất theo cổ phiếu (25+ metrics) |
| `stats_financial_history` | ~46,460 | Snapshot lịch sử theo quý |

**Metrics trong `stats_financial`:**
- **Định giá:** pe, pb, ps, price_to_cash_flow, ev_to_ebitda
- **Lợi nhuận:** roe, roa, gross_margin, pre_tax_margin, after_tax_margin
- **Ngân hàng:** net_interest_margin, cir, car, casa_ratio, npl, ldr
- **Đòn bẩy:** debt_to_equity, financial_leverage
- **Thanh khoản:** current_ratio, quick_ratio, cash_ratio, asset_turnover
- **Thị trường:** market_cap, shares (số cổ phiếu lưu hành)

**Assessment:**
- ✅ Dataset ratio đầy đủ nhất — 25+ metrics theo cổ phiếu
- ✅ History table lưu 30+ quý — tốt cho phân tích xu hướng
- ✅ Metrics ngân hàng riêng biệt — cần thiết cho phân tích cổ phiếu ngân hàng
- ✅ Cập nhật mỗi giờ — đủ fresh cho valuation

---

### 5. `vci_company.sqlite` — Hồ sơ & Phân loại Công ty

| Property | Value |
|---|---|
| **Size** | 3.5 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Company Info API |
| **Update** | Weekly, bi-weekly Sunday 02:00 (`fetch_vci_company.py`) |
| **Used by** | `valuation_service.py` (industry), `/api/companies`, `/api/stock/overview`, company profile |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `companies` | ~2,075 | Tên công ty (EN/VN), tên ngắn, sàn, phân loại ngành, hồ sơ |
| `fetch_log` | ~5 | Trạng thái fetch |

**Key columns:**
- `ticker` — mã cổ phiếu
- `organ_name` / `en_organ_name` — tên đầy đủ VI/EN
- `icb_name4` — ngành chi tiết nhất (ví dụ: "Thép và sản phẩm thép") — dùng làm khóa industry trong valuation
- `icb_name3` / `icb_name2` / `icb_name1` — ngành rộng hơn (fallback)
- `floor` — sàn giao dịch (HOSE/HNX/UPCOM)
- `isbank` — 1 nếu là ngân hàng (ảnh hưởng trọng số mô hình valuation)
- `company_profile` — mô tả công ty

**Assessment:**
- ✅ Bao phủ 2,075 công ty — nhiều hơn cổ phiếu đang niêm yết (gồm hủy niêm yết/OTC)
- ✅ File nhỏ, gọn — lookup nhanh
- ✅ Nguồn chính cho tên công ty và phân loại ngành sau khi xóa `stocks_optimized.db`
- ⚠️ Cập nhật weekly — company profile và ngành nghề không thay đổi thường xuyên nên OK

---

### 6. `vci_ratio_daily.sqlite` — PE/PB Hàng ngày

| Property | Value |
|---|---|
| **Size** | 136 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Daily Ratios API |
| **Update** | Daily 13:30 (`fetch_vci_ratio_daily.py`) |
| **Used by** | `source_priority.py` (PRIORITY #1 cho PE/PB trong screener) |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `ratio_daily` | ~1,382 | PE/PB mới nhất theo ngày per cổ phiếu |
| `meta` | — | Timestamp lần chạy cuối |

**Columns:** `ticker` (PK), `pe`, `pb`, `trading_date`, `fetched_at`

**Assessment:**
- ✅ File nhỏ nhất (136 KB) nhưng ưu tiên cao nhất cho PE/PB trong screener
- ✅ Priority chain: `vci_ratio_daily` → `vci_stats_financial` → `vci_screening` → vnstock live
- ⚠️ Chỉ lưu 2 ratios (PE, PB) — phạm vi hẹp nhưng rất nhanh

---

### 7. `vci_shareholders.sqlite` — Cổ đông

| Property | Value |
|---|---|
| **Size** | 5.1 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Shareholders API |
| **Update** | Daily 13:00 (`fetch_vci_shareholders.py`) |
| **Used by** | `/api/stock/[symbol]/shareholders`, tab Cổ đông |

| Table | Rows | Description |
|---|---|---|
| `shareholders` | 27,000+ | Cổ đông lớn per công ty (số lượng, %, loại) |

**Columns:** `ticker`, `owner_name`, `owner_name_en`, `quantity`, `percentage`, `owner_type` (CORPORATE/INDIVIDUAL)

---

### 8. `vci_foreign.sqlite` — Dòng tiền Nước ngoài

| Property | Value |
|---|---|
| **Size** | 760 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Foreign Trading API |
| **Update** | Every 2 minutes during market hours (`fetch_vci_foreign.py`) |
| **Used by** | `/api/market/foreign` |

| Table | Rows | Description |
|---|---|---|
| `foreign_net_snapshot` | ~17 | Snapshot mua/bán nước ngoài theo ngày (raw JSON) |
| `foreign_volume_minute` | ~4,624 | Khối lượng nước ngoài theo phút nội ngày |

---

### 9. `vci_valuation.sqlite` — Định giá VNINDEX

| Property | Value |
|---|---|
| **Size** | 1.4 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI API |
| **Update** | Daily (`fetch_vci_valuation.py`) |
| **Used by** | `/api/market/pe-chart`, `/api/market/index-valuation-chart` |

| Table | Rows | Description |
|---|---|---|
| `valuation_history` | ~5,547 | PE/PB/giá VNINDEX theo ngày |
| `valuation_stats` | 2 | Dải thống kê PE/PB (avg, ±1SD, ±2SD) |
| `ema_breadth_history` | ~5,897 | Tỷ lệ % cổ phiếu trên EMA50 hàng ngày |
| `meta` | 1 | Timestamp lần chạy cuối |

---

### 10. `index_history.sqlite` — Lịch sử Chỉ số

| Property | Value |
|---|---|
| **Size** | 160 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Index API |
| **Update** | Every 15 minutes (`fetch_vci.py`) |
| **Used by** | `/api/market/index-history` |

| Table | Rows | Description |
|---|---|---|
| `market_index_history` | ~272 | Dữ liệu chỉ số hàng ngày (VNINDEX, VN30, HNXINDEX, UPCOM) |
| `meta` | 2 | Timestamps |

**Assessment:**
- ⚠️ Chỉ ~272 rows = ~1 năm ngày giao dịch cho 4 chỉ số — xem xét backfill thêm

---

### 11. `macro_history.sqlite` / `fireant_macro.sqlite` — Kinh tế vĩ mô

| File | Size | Source | Update |
|---|---|---|---|
| `macro_history.sqlite` | 636 KB | VCI Macro API | Weekly |
| `fireant_macro.sqlite` | 376 KB | Fireant API | Weekly |

| Table | Rows | Description |
|---|---|---|
| `macro_prices` | ~6,126 | Time series cho các chỉ số vĩ mô (VCI) |
| `macro_indicators` | 96 | Metadata chỉ số (Fireant) |
| `macro_data` | ~6,695 | Dữ liệu lịch sử (Fireant) |

---

### 12. `valuation_cache.sqlite` — Cache DCF

| Property | Value |
|---|---|
| **Size** | 124 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | Self-calculated |
| **Update** | On-demand (`batch_valuations.py`) |
| **Used by** | Batch valuation pre-computation |

| Table | Rows | Description |
|---|---|---|
| `valuations` | ~1,463 | Kết quả DCF cache per symbol |

---

## Data Flow Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL APIs                               │
├───────────────────────┬────────────────────────────────────────────┤
│  VCI API              │  Fireant API                                │
│  (vietcap.com.vn)     │  (fireant.vn)                               │
└────┬──────────────────┴──────────────┬──────────────────────────────┘
     │                                 │
     ▼                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              FETCH SCRIPTS (fetch_sqlite/*.py)                       │
│  Cron jobs: every 2min – weekly                                      │
└────┬───────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────────┐
│                    LOCAL SQLITE DATABASES                            │
│                                                                     │
│  CORE (cho valuation):                                              │
│  ├── vci_financials.sqlite (132 MB)   ← BCTC wide-format daily     │
│  ├── vci_screening.sqlite (2.6 MB)    ← Giá + screener 7min        │
│  ├── vci_stats_financial.sqlite (10MB)← TTM ratios hourly          │
│  └── vci_company.sqlite (3.5 MB)      ← Hồ sơ + ngành weekly       │
│                                                                     │
│  PRICE & MARKET:                                                    │
│  ├── price_history.sqlite (218 MB)    ← OHLCV daily                │
│  ├── vci_ratio_daily.sqlite (136KB)   ← PE/PB daily                │
│  ├── vci_foreign.sqlite (760KB)       ← Nước ngoài 2min            │
│  └── index_history.sqlite (160KB)     ← Chỉ số 15min               │
│                                                                     │
│  COMPANY DATA:                                                      │
│  ├── vci_shareholders.sqlite (5.1MB)  ← Cổ đông daily              │
│  └── vci_news_events.sqlite (183MB)   ← Tin tức + sự kiện daily    │
│                                                                     │
│  AI & MACRO:                                                        │
│  ├── vci_ai_news.sqlite (6.5MB)       ← Tin tức AI 10min           │
│  ├── macro_history.sqlite (636KB)     ← VCI vĩ mô weekly           │
│  └── fireant_macro.sqlite (376KB)     ← Fireant vĩ mô weekly       │
│                                                                     │
│  VALUATION:                                                         │
│  ├── vci_valuation.sqlite (1.4MB)     ← PE/PB VNINDEX daily        │
│  └── valuation_cache.sqlite (124KB)   ← Cache DCF on-demand        │
└────┬───────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────────┐
│              BACKEND (Flask API)                                     │
│                                                                     │
│  valuation_service.py:                                              │
│    industry    ← vci_company.companies.icb_name4                   │
│    price       ← vci_screening.marketPrice                         │
│    PE/PB/PS    ← vci_stats_financial.stats_financial               │
│    EPS history ← vci_financials.income_statement.isa23             │
│    Net income  ← vci_financials.income_statement.isa22             │
│    Peers PE/PB ← vci_screening (icbCodeLv2) + vci_stats_financial  │
│                                                                     │
│  source_priority.py PE/PB chain:                                    │
│    #1 vci_ratio_daily → #2 vci_stats_financial                     │
│    → #3 vci_screening → #4 vnstock live API                        │
└────┬───────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────────┐
│              FRONTEND (Next.js)                                      │
│  /stock/[symbol] → overview, financials, valuation, news           │
│  /screener → vci_screening + vci_stats_financial                   │
│  Market → index-valuation-chart, ema50-breadth, foreign, macro     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Fetch Schedule

| Frequency | Script | Output |
|---|---|---|
| Every 2 min (giờ giao dịch) | `fetch_vci_foreign.py` | `vci_foreign.sqlite` |
| Every 7 min | `fetch_vci_screener.py` | `vci_screening.sqlite` |
| Every 10 min | `fetch_vci_news.py` | `vci_ai_news.sqlite` |
| Every 15 min | `fetch_vci.py` | `index_history.sqlite` |
| Every 1 hour | `fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| Daily 11:30 UTC | `update_price_history.py` | `price_history.sqlite` |
| Daily 13:00 | `fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| Daily 13:30 | `fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| Daily | `fetch_vci_financial_statement.py` | `vci_financials.sqlite` |
| Daily | `fetch_vci_news.py` (events) | `vci_news_events.sqlite` |
| Daily | `fetch_vci_valuation.py` | `vci_valuation.sqlite` |
| Weekly (Sun 02:00) | `fetch_vci_company.py` | `vci_company.sqlite` |
| Weekly | `fetch_macro_history.py` | `macro_history.sqlite` |
| Weekly | `fetch_fireant_macro.py` | `fireant_macro.sqlite` |
| On-demand | `batch_valuations.py` | `valuation_cache.sqlite` |

---

## Điểm mạnh & Cần cải thiện

### Điểm mạnh
- **Multi-source redundancy:** VCI + Fireant — tính bền vững dữ liệu
- **Fast queries:** File nhỏ cho dữ liệu truy cập thường xuyên (screening, ratios)
- **Clean separation:** Mỗi file có một trách nhiệm riêng
- **VCI-native:** Toàn bộ tính năng chính dựa trên VCI data — không phụ thuộc KBS/vnstock nữa

### Cần cải thiện
1. **`vci_news_events.sqlite` (183 MB):** Cân nhắc archive items cũ hơn 1 năm
2. **`index_history.sqlite` (272 rows):** Chỉ ~1 năm dữ liệu — backfill thêm lịch sử
3. **`vci_financials.sqlite` (~33k rows):** Ít hơn so với KBS cũ (~73k) — tiếp tục tích lũy thêm quý
4. **Periodic VACUUM:** Chạy `VACUUM` quarterly trên các DB lớn để tái sử dụng không gian
