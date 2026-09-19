# Các bộ dữ liệu SQLite

Kiểm tra trực tiếp ngày 2026-09-12. Phạm vi: `data/sqlite/` trong checkout này;
đường dẫn triển khai có thể được ghi đè qua biến môi trường trong `backend/db_path.py`.
Tên file chỉ mô tả một bộ dữ liệu, không có nghĩa mọi bảng trong file đều đã được nạp.

| File | Vai trò |
|---|---|
| `vci_financials.sqlite` | Báo cáo tài chính chi tiết quý/năm: `balance_sheet`, `income_statement`, `cash_flow`, `note`; định nghĩa chỉ tiêu, kỳ báo cáo, nguồn và nhật ký nạp |
| `vci_short_financials.sqlite` | Báo cáo tài chính tóm tắt từ endpoint short-financial; bảng lịch sử, bản mới nhất và payload gốc nén |
| `vci_stats_financial.sqlite` | Tỷ số tính sẵn từ statistics-financial, lịch sử và bản TTM mới nhất; phần trăm lưu dạng thập phân |
| `vci_ratio_daily.sqlite` | Tỷ số thị trường theo ngày, bản hiện tại và lịch sử |
| `vci_screening.sqlite` | Snapshot phục vụ bộ lọc: giá, vốn hóa, thanh khoản, tỷ số, tăng trưởng |
| `vci_company.sqlite` | Tên/hồ sơ công ty, sàn, ICB; security_master và view active_stocks |
| `vci_price_history.sqlite` | OHLCV lịch sử từng cổ phiếu |
| `vci_index_history.sqlite` | Lịch sử chỉ số thị trường |
| `vci_technical.sqlite` | Snapshot chỉ báo kỹ thuật |
| `vci_foreign.sqlite` | Snapshot mua/bán ròng và dữ liệu khối ngoại theo phút |
| `vci_shareholders.sqlite` | Cổ đông |
| `vci_market_news.sqlite` | Tin thị trường |
| `vci_news_events.sqlite` | Tin và sự kiện theo mã cổ phiếu |
| `vci_valuation.sqlite` | Lịch sử định giá chỉ số, thống kê định giá và độ rộng EMA |
| `valuation_cache.sqlite` | Kết quả mô hình định giá, phân tích AI và dữ liệu cache của ứng dụng |
| `fireant_macro.sqlite`, `macro_history.sqlite` | Chỉ tiêu/dữ liệu vĩ mô và lịch sử giá các chuỗi vĩ mô |
| `vci_financials_notes_fallback.sqlite` | Kho thuyết minh dự phòng; không đồng nhất với bảng note chính |
| `vci_financials.pre-ssi-merge-20260814T144003Z.sqlite` | Bản sao trước khi trộn SSI; phục vụ khôi phục |
| `vci_ai_analysis.sqlite` | File 0 byte tại thời điểm kiểm tra, không có dữ liệu SQLite để sử dụng |

## Vì sao financials có bảng rỗng?

15 bảng rỗng: `statement_values`, `stocks`, `exchanges`, `indices`, `industries`,
`stock_exchange`, `stock_industry`, `update_log`, `company_overview`, `shareholders`,
`events`, `news`, `financial_reports`, `cash_flow_statement`, `financial_ratios`.

`statement_values` là cấu trúc dạng dài còn được khai báo trong schema của fetcher.
Dữ liệu báo cáo đang nằm trong các bảng dạng rộng: một dòng/mã/kỳ, mỗi chỉ tiêu
là một cột. Không được nhầm `cash_flow_statement` rỗng với `cash_flow` có dữ liệu.

Các bảng nghiệp vụ còn lại phù hợp với schema cũ dùng chung nhiều loại dữ liệu.
Chúng đã có trong bản sao trước khi trộn SSI. Không tìm thấy lệnh tạo chúng trong
code hiện tại; chưa xác định được script lịch sử nào đã tạo ra chúng. Fetcher
`scripts/fetchers/fetch_vci_financial_statement.py` hiện tại không nạp các bảng này.
Vì vậy sự hiện diện của chúng không chứng minh có dữ liệu tỷ số, cổ đông hay tin tức
trong financials. Dữ liệu đó hiện nằm trong các file chuyên biệt ở bảng trên.

Không xóa tự động: `backend/stock_provider.py`,
`backend/data_sources/financial_repository.py` và
`backend/routes/stock/missing_routes.py` vẫn có truy vấn schema cũ như
`financial_ratios`, `company_overview`. Cần di chuyển các đường đọc này trước khi
loại bỏ schema. Tổng dung lượng của 15 bảng rỗng và index tương ứng chỉ 140 KiB.

## Chính sách nguồn cho screener hiện tại

Screener chưa được đổi nguồn trong đợt bảo trì này. Nó đọc screening, dự phòng tỷ số
từ ratio_daily/stats_financial, ngành từ company và upside từ valuation_cache.
Financials là nguồn báo cáo, không thay thế độc lập được giá thị trường. Việc tính
lại P/E, P/B, ROE cần thống nhất kỳ TTM, vốn chủ, số cổ phiếu và thời điểm giá.

## Bảo trì ngày 2026-09-12

Các index dư trong sáu database của công cụ bảo trì trước đó đã được loại bỏ;
không chạy VACUUM lại toàn bộ chỉ để lặp lại công việc đã hoàn thành.

- `vci_company.sqlite`: 6.496.256 → 3.571.712 byte.
- `vci_market_news.sqlite`: 22.835.200 → 20.631.552 byte.
- Thu hồi tổng 5.128.192 byte (~4,89 MiB) trong các file đang hoạt động.
- Sao lưu nén ở `data/backups/sqlite-optimization/20260912T165418195193Z/`.
- Kiểm tra số dòng trước/sau, quick_check và làm mới thống kê truy vấn.
- Giữ nguyên báo cáo, tin tức, bảng rỗng và các bản sao dự phòng.

Dung lượng sao lưu là phần lưu trữ bổ sung, không tính vào mức giảm của file hoạt động.
Xem [hướng dẫn bảo trì](sqlite-maintenance.md) để chạy có chọn lọc và khôi phục.
