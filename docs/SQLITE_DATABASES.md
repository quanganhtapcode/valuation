# SQLite Databases — Reference

All canonical databases live in `fetch_sqlite/`. No feature should depend on the
legacy root-level databases (`stocks_optimized.db`, `vietnam_stocks.db`).

---

## Quick Reference

| File | Size | Rows (main table) | Tickers | Update cadence |
|------|------|-------------------|---------|----------------|
| `vci_company.sqlite` | 6.2 MB | 2 075 companies | 2 075 | Monthly |
| `vci_financials.sqlite` | 198 MB | ~43 k BS / IS / CF | 1 554 | Quarterly |
| `vci_screening.sqlite` | 2.7 MB | 1 547 | 1 547 | Daily |
| `vci_stats_financial.sqlite` | 18 MB | 48 002 (history) | 1 547 | Weekly |
| `vci_ratio_daily.sqlite` | 41 MB | 345 350 (history) | 1 383 | Daily |
| `vci_shareholders.sqlite` | 5.2 MB | 27 571 | 1 548 | Monthly |
| `vci_market_news.sqlite` | 12 MB | 4 994 | market-wide | Daily |
| `vci_news_events.sqlite` | 190 MB | 184 053 | 1 547 | Daily |
| `vci_foreign.sqlite` | 1.1 MB | 6 078 (intraday) | market-wide | Daily |
| `vci_valuation.sqlite` | 1.4 MB | 5 558 (history) | VNINDEX | Daily |
| `vci_index_history.sqlite` | 4.2 MB | 9 206 | 4 indices | Daily |
| `vci_price_history.sqlite` | 7.5 MB | 80 400 | 1 547 | Daily |
| `macro_history.sqlite` | 636 KB | 6 154 | 8 series | Daily |
| `fireant_macro.sqlite` | 472 KB | 7 160 (data) | 96 indicators | Weekly |
| `valuation_cache.sqlite` | 124 KB | 1 463 | 1 463 | On-demand |
| `vci_ai_standouts.sqlite` | 12 KB | 1 snapshot | HOSE | Daily |

---

## 1. `vci_company.sqlite`

**Nội dung:** Danh mục toàn bộ cổ phiếu niêm yết và OTC, thông tin ngành ICB, profile công ty.

**Nguồn:** VCI IQ API — `iq.vietcap.com.vn`  
**Tần suất update:** ~hàng tháng (hoặc khi có IPO / hủy niêm yết)  
**Fetcher:** `fetch_sqlite/fetch_vci_company.py`

```bash
python fetch_sqlite/fetch_vci_company.py --db fetch_sqlite/vci_company.sqlite
```

### Schema chính: `companies`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT PK | `VNM` |
| `organ_name` | TEXT | `Công ty Cổ phần Sữa Việt Nam` |
| `en_organ_name` | TEXT | `Vietnam Dairy Products JSC` |
| `floor` | TEXT | `HOSE` / `HNX` / `UPCOM` / `OTC` |
| `icb_code2` | TEXT | `3570` |
| `icb_name2` | TEXT | `Thực phẩm & Đồ uống` |
| `icb_name3` | TEXT | `Thực phẩm` |
| `icb_name4` | TEXT | `Sản phẩm sữa` |
| `isbank` | INT | `0` / `1` |
| `company_profile` | TEXT | mô tả dài |
| `fetched_at` | TEXT | ISO-8601 |

**Thống kê:**
- 2 075 công ty tổng cộng
- Sàn: HOSE, HNX, UPCOM, OTC, STOP, OTHER
- 19 ngành ICB cấp 2

---

## 2. `vci_financials.sqlite`

**Nội dung:** Báo cáo tài chính đầy đủ: Bảng cân đối kế toán, Kết quả kinh doanh, Lưu chuyển tiền tệ, Thuyết minh. Dữ liệu theo quý và năm từ 2018 đến nay.

**Nguồn:** VCI API financial statements  
**Tần suất update:** Hàng quý (sau mùa công bố BCTC, ~3–6 tuần sau khi kết thúc quý)  
**Fetcher:** `fetch_sqlite/fetch_vci_financial_statement.py`

```bash
python fetch_sqlite/fetch_vci_financial_statement.py \
  --db fetch_sqlite/vci_financials.sqlite \
  --tickers VNM ACB VCB
# Toàn bộ thị trường (~8–12 giờ):
python fetch_sqlite/fetch_vci_financial_statement.py --db fetch_sqlite/vci_financials.sqlite
```

### Schema chính: `balance_sheet`, `income_statement`, `cash_flow`

Mỗi bảng có cấu trúc:

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT | `VNM` |
| `period_kind` | TEXT | `QUARTER` / `YEAR` |
| `year_report` | INT | `2025` |
| `quarter_report` | INT | `4` (0 = năm) |
| `public_date` | TEXT | `2026-01-20` |
| `bsa1`…`bsa96` | REAL | dữ liệu BS phần A (doanh nghiệp) |
| `bsb97`…`bsb132` | REAL | dữ liệu BS phần B (ngân hàng) |
| `bsi139`…`bsi208` | REAL | dữ liệu BS phần I (chứng khoán/bảo hiểm) |

Prefix quy ước:
- `bsa` = Balance Sheet type A (doanh nghiệp thường)
- `bsb` = Balance Sheet type B (ngân hàng)
- `bsi` = Balance Sheet type I (bảo hiểm / chứng khoán)
- `isa`, `isb`, `isi` = Income Statement tương ứng
- `cfa`, `cfb`, `cfi` = Cash Flow tương ứng

Để tra tên đầy đủ của từng field, dùng bảng `statement_metrics`:
```sql
SELECT field, title_vi, full_title_vi FROM statement_metrics WHERE section='balance_sheet';
```

**Thống kê:**
- 1 554 tickers có balance sheet, 1 552 có income statement
- Khoảng thời gian: Q1/2018 → Q4/2025
- ~43 000 kỳ báo cáo mỗi loại báo cáo

### Bảng `statement_periods` (khuyến nghị dùng)

Lưu toàn bộ dữ liệu từng kỳ dưới dạng JSON (`values_json`) thay vì wide-column. Phù hợp hơn cho truy vấn nhanh.

```sql
SELECT ticker, year_report, quarter_report, values_json
FROM statement_periods
WHERE ticker='VNM' AND section='income_statement'
ORDER BY year_report DESC, quarter_report DESC LIMIT 4;
```

---

## 3. `vci_screening.sqlite`

**Nội dung:** Snapshot cuối ngày của toàn thị trường — giá, khối lượng, PE/PB TTM, ROE, tăng trưởng doanh thu, ngành nghề. Dùng cho screener và bảng so sánh peers.

**Nguồn:** VCI screener API  
**Tần suất update:** Hàng ngày (sau 17:00)  
**Fetcher:** `fetch_sqlite/fetch_vci_screener.py`

```bash
python fetch_sqlite/fetch_vci_screener.py --db fetch_sqlite/vci_screening.sqlite
```

### Schema chính: `screening_data`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT | `VNM` |
| `exchange` | TEXT | `HSX` / `HNX` / `UPCOM` |
| `refPrice` | REAL | `61500` |
| `marketPrice` | REAL | `60900` |
| `marketCap` | REAL | `129 000 000 000 000` |
| `ttmPe` | REAL | `13.5` |
| `ttmPb` | REAL | `4.1` |
| `ttmRoe` | REAL | `0.32` |
| `npatmiGrowthYoyQm1` | REAL | tăng trưởng LNST YoY kỳ gần nhất |
| `revenueGrowthYoy` | REAL | tăng trưởng doanh thu YoY |
| `netMargin` | REAL | `0.18` |
| `grossMargin` | REAL | `0.45` |
| `adtv30Days` | REAL | ADTV 30 phiên (VNĐ) |
| `enSector` | TEXT | `Food & Beverage` |
| `viSector` | TEXT | `Thực phẩm & Đồ uống` |
| `fetched_at` | TEXT | ISO-8601 |

**Thống kê:** 1 547 tickers (HSX, HNX, UPCOM)

---

## 4. `vci_stats_financial.sqlite`

**Nội dung:** Chuỗi lịch sử các chỉ số tài chính theo quý — PE, PB, ROE, ROA, biên lợi nhuận, và các chỉ số đặc thù ngân hàng (NIM, CAR, NPL, LDR, CASA).

**Nguồn:** VCI stats API  
**Tần suất update:** Hàng tuần  
**Fetcher:** `fetch_sqlite/fetch_vci_stats_financial.py`

```bash
python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite
```

### Schema chính: `stats_financial_history`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT | `VNM` |
| `year_report` | INT | `2018` |
| `quarter_report` | INT | `1` |
| `period_date` | TEXT | `2018-04-01` |
| `pe` | REAL | `24.3` |
| `pb` | REAL | `9.5` |
| `ps` | REAL | `3.1` |
| `roe` | REAL | `0.407` |
| `roa` | REAL | `0.28` |
| `gross_margin` | REAL | `0.45` |
| `after_tax_margin` | REAL | `0.18` |
| `market_cap` | REAL | tỷ VNĐ |
| `net_interest_margin` | REAL | ngân hàng |
| `car` | REAL | hệ số an toàn vốn (ngân hàng) |
| `npl` | REAL | tỷ lệ nợ xấu (ngân hàng) |
| `ldr` | REAL | tỷ lệ LDR (ngân hàng) |
| `casa_ratio` | REAL | CASA (ngân hàng) |

`stats_financial` (1 547 rows) = snapshot kỳ mới nhất cho từng ticker.

**Thống kê:** 1 547 tickers × nhiều kỳ, 48 002 records lịch sử

---

## 5. `vci_ratio_daily.sqlite` ⭐ Nguồn PE/PB ưu tiên cao nhất

**Nội dung:** PE và PB hàng ngày từ 2016 đến nay, cập nhật sau mỗi phiên. Đây là nguồn có độ chính xác và tần suất cao nhất cho PE/PB.

**Nguồn:** VCI ratio API  
**Tần suất update:** Hàng ngày (sau 17:00)  
**Fetcher:** `fetch_sqlite/fetch_vci_ratio_daily.py`

```bash
python fetch_sqlite/fetch_vci_ratio_daily.py --db fetch_sqlite/vci_ratio_daily.sqlite
```

### Schema chính: `ratio_daily_history`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT | `VNM` |
| `trading_date` | TEXT | `2026-04-29` |
| `pe` | REAL | `13.53` |
| `pb` | REAL | `4.15` |
| `fetched_at` | TEXT | ISO-8601 |

`ratio_daily` (1 383 rows) = snapshot ngày giao dịch gần nhất.

**Thống kê:**
- 1 383 tickers, 345 350 records
- Khoảng thời gian: **2016-05-04 → nay**

**Ưu tiên PE/PB:** `vci_ratio_daily` > `vci_stats_financial` > `vci_screening`

---

## 6. `vci_shareholders.sqlite`

**Nội dung:** Cơ cấu cổ đông lớn và nội bộ của các công ty niêm yết.

**Nguồn:** VCI shareholders API  
**Tần suất update:** Hàng tháng  
**Fetcher:** `fetch_sqlite/fetch_vci_shareholders.py`

```bash
python fetch_sqlite/fetch_vci_shareholders.py --db fetch_sqlite/vci_shareholders.sqlite
```

### Schema chính: `shareholders`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `ticker` | TEXT | `VNM` |
| `owner_name` | TEXT | `Tổng Công ty Đầu Tư Và Kinh Doanh Vốn Nhà Nước` |
| `owner_name_en` | TEXT | `SCIC` |
| `position_name` | TEXT | tên chức vụ (nếu là nội bộ) |
| `quantity` | REAL | số cổ phần |
| `percentage` | REAL | `0.36` (36%) |
| `owner_type` | TEXT | `CORPORATE` / `INDIVIDUAL` |
| `update_date` | TEXT | `2026-01-27` |

**Thống kê:** 1 548 tickers, 27 571 records

---

## 7. `vci_market_news.sqlite`

**Nội dung:** Tin tức thị trường có phân tích sentiment AI, liên kết với ticker hoặc ngành.

**Nguồn:** VCI market news API  
**Tần suất update:** Hàng ngày (fetch thêm trang mới)  
**Fetcher:** `fetch_sqlite/fetch_vci_market_news.py`

```bash
python fetch_sqlite/fetch_vci_market_news.py \
  --db fetch_sqlite/vci_market_news.sqlite \
  --pages 5 --page-size 50
```

### Schema chính: `news_items`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `id` | TEXT | UUID |
| `ticker` | TEXT | `BSR` (NULL nếu tin chung thị trường) |
| `industry` | TEXT | tên ngành |
| `news_title` | TEXT | tiêu đề tin |
| `news_short_content` | TEXT | tóm tắt |
| `news_source_link` | TEXT | URL gốc |
| `sentiment` | TEXT | `Positive` / `Negative` / `Neutral` |
| `score` | REAL | `8.9` (thang 0–10) |
| `update_date` | TEXT | `2026-05-02 20:42:00` |

**Thống kê:** 4 994 tin, từ 2026-03-16 đến nay

---

## 8. `vci_news_events.sqlite`

**Nội dung:** Toàn bộ sự kiện theo từng mã: tin tức công ty, cổ tức, mua bán nội bộ, ĐHCĐ, sự kiện khác. Lịch sử từ 2008.

**Nguồn:** VCI news/events API (per-ticker)  
**Tần suất update:** Hàng ngày  
**Fetcher:** được populate từ job riêng (không có script độc lập trong `fetch_sqlite/`)

### Schema chính: `items`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `id` | TEXT | UUID sự kiện |
| `symbol` | TEXT | `VNM` |
| `tab` | TEXT | `news` / `dividend` / `insider` / `agm` / `other` |
| `public_date` | TEXT | `2026-04-29` |
| `title` | TEXT | tiêu đề sự kiện |
| `raw_json` | TEXT | toàn bộ payload JSON |
| `fetched_at` | TEXT | ISO-8601 |

**Thống kê:**
- 1 547 tickers, 184 053 records
- Khoảng thời gian: **2008-03-22 → nay**
- Tabs: `news`, `dividend`, `insider`, `agm`, `other`

---

## 9. `vci_foreign.sqlite`

**Nội dung:** Giao dịch của khối ngoại — snapshot cuối ngày và chi tiết theo phút trong phiên.

**Nguồn:** VCI foreign trading API  
**Tần suất update:** Hàng ngày  
**Fetcher:** `fetch_sqlite/fetch_vci_foreign.py`

```bash
python fetch_sqlite/fetch_vci_foreign.py --db fetch_sqlite/vci_foreign.sqlite
```

### Bảng `foreign_net_snapshot`

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `trading_date` | TEXT | ngày giao dịch |
| `raw_json` | TEXT | danh sách top mua/bán ròng theo mã |
| `fetched_at` | TEXT | ISO-8601 |

### Bảng `foreign_volume_minute`

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `trading_date` | TEXT | ngày |
| `minute` | INT | phút trong phiên |
| `buy_volume` | REAL | khối lượng mua |
| `sell_volume` | REAL | khối lượng bán |
| `buy_value` | REAL | giá trị mua (VNĐ) |
| `sell_value` | REAL | giá trị bán (VNĐ) |

**Thống kê:** Snapshot từ 2026-03-30 → nay; 6 078 records intraday theo phút

---

## 10. `vci_valuation.sqlite`

**Nội dung:** Lịch sử định giá VNINDEX (PE, PB, giá) từ 2004 đến nay, thống kê phân phối ±1σ/±2σ, breadth chỉ số EMA.

**Nguồn:** VCI valuation API  
**Tần suất update:** Hàng ngày  
**Fetcher:** `fetch_sqlite/fetch_vci_valuation.py`

```bash
python fetch_sqlite/fetch_vci_valuation.py --db fetch_sqlite/vci_valuation.sqlite
```

### Bảng `valuation_history`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `date` | TEXT | `2026-04-29` |
| `pe` | REAL | `13.2` |
| `pb` | REAL | `1.85` |
| `vnindex` | REAL | `1 235` |
| `close` | REAL | giá đóng cửa VNINDEX |
| `volume` | REAL | khối lượng |
| `ema50` | REAL | EMA50 của VNINDEX |

### Bảng `valuation_stats`

Thống kê phân phối của PE và PB theo lịch sử (dùng để vẽ dải ±1σ/±2σ):

| metric | average | +1σ | −1σ |
|--------|---------|-----|-----|
| `pe` | 14.51 | 17.15 | 11.87 |

### Bảng `ema_breadth_history`

Tỷ lệ cổ phiếu đang giao dịch trên EMA50. Từ **2000-08-11 → nay** (5 909 records).

**Thống kê:** 5 558 ngày lịch sử PE/PB VNINDEX từ **2004-01-05 → nay**

---

## 11. `vci_index_history.sqlite`

**Nội dung:** Lịch sử giá và thống kê phiên của 4 chỉ số chính: VNINDEX, VN30, HNXIndex, HNXUpcomIndex.

**Nguồn:** VCI market indices API  
**Tần suất update:** Hàng ngày  
**Fetcher:** `fetch_sqlite/fetch_vci.py`

```bash
python fetch_sqlite/fetch_vci.py \
  --index VNINDEX --start-page 0 --end-page 45 \
  --db fetch_sqlite/vci_index_history.sqlite
```

### Schema chính: `market_index_history`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `symbol` | TEXT | `VNINDEX` |
| `tradingDate` | TEXT | `2026-04-29` |
| `indexValue` | REAL | `1 235.4` |
| `indexChange` | REAL | `+3.2` |
| `percentIndexChange` | REAL | `+0.26` |
| `totalVolume` | REAL | tổng khối lượng |
| `totalValue` | REAL | tổng giá trị (VNĐ) |
| `totalStockUpPrice` | INT | số mã tăng |
| `totalStockDownPrice` | INT | số mã giảm |
| `foreignBuyValueTotal` | REAL | KN mua |
| `foreignSellValueTotal` | REAL | KN bán |
| `marketCap` | REAL | vốn hóa toàn sàn |

**Thống kê:**
- 4 chỉ số: VNINDEX, VN30, HNXIndex, HNXUpcomIndex
- Khoảng thời gian: **2017-02-10 → nay** (9 206 records)

---

## 12. `vci_price_history.sqlite`

**Nội dung:** Lịch sử giá OHLCV ngày của tất cả cổ phiếu. Dùng cho biểu đồ giá, tính beta, phân tích kỹ thuật.

**Nguồn:** VCI price history API  
**Tần suất update:** Hàng ngày (sau 17:00)  
**Fetcher:** `backend/updater/update_price_history.py`

```bash
python -m backend.updater.update_price_history
# Fetch toàn bộ lịch sử:
python -m backend.updater.update_price_history --full
```

### Schema chính: `stock_price_history`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `symbol` | TEXT | `VNM` |
| `time` | TEXT | `2026-04-29` |
| `open` | REAL | `60 300` |
| `high` | REAL | `61 300` |
| `low` | REAL | `60 300` |
| `close` | REAL | `60 900` |
| `volume` | REAL | `2 582 460` |

**Thống kê:**
- 1 547 tickers, 80 400 records
- Khoảng thời gian mặc định: ~3 tháng rolling (**2026-01-07 → nay**)
- Lịch sử đầy đủ từ 2016 khi chạy `--full`

---

## 13. `macro_history.sqlite`

**Nội dung:** Lịch sử giá hàng ngày của 8 series vĩ mô — tỷ giá và hàng hóa — từ Yahoo Finance.

**Nguồn:** Yahoo Finance (qua `yfinance`)  
**Tần suất update:** Hàng ngày  
**Fetcher:** `fetch_sqlite/fetch_macro_history.py`

```bash
python fetch_sqlite/fetch_macro_history.py --db fetch_sqlite/macro_history.sqlite
```

### Schema: `macro_prices`

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `symbol` | TEXT | mã Yahoo Finance |
| `date` | TEXT | ngày |
| `close` | REAL | giá đóng cửa |

**Danh sách 8 series:**

| Symbol | Ý nghĩa |
|--------|---------|
| `USDVND=X` | Tỷ giá USD/VNĐ |
| `CNYVND=X` | Tỷ giá CNY/VNĐ |
| `EURVND=X` | Tỷ giá EUR/VNĐ |
| `JPYVND=X` | Tỷ giá JPY/VNĐ |
| `GC=F` | Giá vàng (USD/oz) |
| `SI=F` | Giá bạc (USD/oz) |
| `BZ=F` | Giá dầu Brent (USD/barrel) |
| `ZR=F` | Giá gạo thô (USD/cwt) |

**Thống kê:** 6 154 records, từ **2023-05-02 → nay**

---

## 14. `fireant_macro.sqlite`

**Nội dung:** 96 chỉ số kinh tế vĩ mô Việt Nam từ Fireant/Trading Economics (GDP, lãi suất, CPI, xuất nhập khẩu…) cộng với cache beta từng cổ phiếu.

**Nguồn:** FireAnt API  
**Tần suất update:** Hàng tuần (macro); beta tính lại theo yêu cầu  
**Fetcher:** `fetch_sqlite/fetch_fireant_macro.py`, `fetch_sqlite/fetch_fireant_beta.py`

```bash
python fetch_sqlite/fetch_fireant_macro.py --db fetch_sqlite/fireant_macro.sqlite
python fetch_sqlite/fetch_fireant_beta.py   --db fetch_sqlite/fireant_macro.sqlite
```

### Bảng `macro_indicators`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `id` | INT PK | `1` |
| `type` | TEXT | `InterestRate` |
| `name` | TEXT | `GDP Annual Growth Rate` |
| `name_vn` | TEXT | `Tốc độ Tăng trưởng GDP hàng năm` |
| `unit` | TEXT | `%` |
| `frequency` | TEXT | `Hàng quý` / `Hàng ngày` |
| `source` | TEXT | `Ngân hàng thế giới` |

**9 loại chỉ số:** Business, Consumer, GDP, InterestRate, Labour, Money, Prices, Taxes, Trade

### Bảng `macro_data`

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `indicator_id` | INT | FK → `macro_indicators.id` |
| `date` | TEXT | kỳ (ví dụ: `Q1/2025`, `01/2025`) |
| `value` | REAL | giá trị chỉ số |

### Bảng `beta_cache`

Beta 252 ngày của từng cổ phiếu so với VN30:

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `symbol` | TEXT PK | mã cổ phiếu |
| `beta` | REAL | hệ số beta |
| `fetched_at` | TEXT | thời điểm tính |

**Thống kê:** 96 chỉ số vĩ mô, 7 160 data points, 1 138 tickers có beta

---

## 15. `valuation_cache.sqlite`

**Nội dung:** Cache kết quả định giá nội tại (DCF / Graham / đa phương pháp) đã tính sẵn cho toàn thị trường.

**Nguồn:** Tính bởi `backend/services/` từ `vci_financials` + `vci_screening`  
**Tần suất update:** On-demand (chạy batch khi cần refresh)

### Schema: `valuations`

| Cột | Kiểu | Ví dụ |
|-----|------|-------|
| `symbol` | TEXT PK | `VNM` |
| `intrinsic_value` | REAL | `85 000` (VNĐ/cổ phiếu) |
| `upside_pct` | REAL | `39.6` (%) |
| `quality_score` | REAL | `72.5` (0–100) |
| `quality_grade` | TEXT | `A` / `B` / `C` / … |
| `computed_at` | TEXT | ISO-8601 |

**Thống kê:** 1 463 symbols, tính lần cuối 2026-04-13

---

## 16. `vci_ai_standouts.sqlite`

**Nội dung:** Snapshot AI highlights của VCI — danh sách cổ phiếu nổi bật theo ngày.

**Nguồn:** VCI IQ API  
**Tần suất update:** Hàng ngày  
**Schema:** `standouts_snapshot(key, group_name, raw_json, fetched_at_utc)`  
`group_name` hiện tại = `hose`

---

## Ưu tiên nguồn dữ liệu

### PE / PB
```
vci_ratio_daily  (ngày, từ 2016)
  → vci_stats_financial  (quý)
    → vci_screening  (TTM snapshot)
```

### Giá cổ phiếu (OHLCV)
```
vci_price_history  (daily OHLCV)
```

### Báo cáo tài chính
```
vci_financials → statement_periods (JSON, nhanh)
               → balance_sheet / income_statement / cash_flow (wide-column, đầy đủ)
```

### Thông tin công ty / ngành
```
vci_company  (profile, ICB đầy đủ)
  → vci_screening  (có sector + exchange, real-time hơn)
```

---

## Biến môi trường

Tất cả path được resolve qua `backend/db_path.py` với fallback tự động. Đặt trong `.env`:

```
VCI_COMPANY_DB_PATH=/var/www/valuation/fetch_sqlite/vci_company.sqlite
VCI_FINANCIAL_STATEMENT_DB_PATH=/var/www/valuation/fetch_sqlite/vci_financials.sqlite
VCI_SCREENING_DB_PATH=/var/www/valuation/fetch_sqlite/vci_screening.sqlite
VCI_STATS_FINANCIAL_DB_PATH=/var/www/valuation/fetch_sqlite/vci_stats_financial.sqlite
VCI_RATIO_DAILY_DB_PATH=/var/www/valuation/fetch_sqlite/vci_ratio_daily.sqlite
VCI_SHAREHOLDERS_DB_PATH=/var/www/valuation/fetch_sqlite/vci_shareholders.sqlite
VCI_MARKET_NEWS_DB_PATH=/var/www/valuation/fetch_sqlite/vci_market_news.sqlite
VCI_NEWS_EVENTS_DB_PATH=/var/www/valuation/fetch_sqlite/vci_news_events.sqlite
VCI_VALUATION_DB_PATH=/var/www/valuation/fetch_sqlite/vci_valuation.sqlite
INDEX_HISTORY_DB_PATH=/var/www/valuation/fetch_sqlite/vci_index_history.sqlite
PRICE_HISTORY_DB_PATH=/var/www/valuation/fetch_sqlite/vci_price_history.sqlite
VALUATION_CACHE_DB_PATH=/var/www/valuation/fetch_sqlite/valuation_cache.sqlite
```
