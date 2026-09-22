# Rà soát Python và SQLite — 22/09/2026

## Phạm vi

Rà cú pháp toàn bộ 108 file Python còn lại được Git theo dõi, tham chiếu service,
các điểm mở SQLite và truy vấn phục vụ API. Đọc schema/query plan, chạy
`PRAGMA quick_check` bằng `mode=ro` trên 19 file SQLite không rỗng ngoài thư mục
backup, gồm database hoạt động, notes fallback và bản trước SSI. Không chạy
`integrity_check` đầy đủ, không chứng minh mọi hàm không được tham chiếu tĩnh đều
là dead code, không thay đổi frontend hoặc xóa dữ liệu nghiệp vụ.

## Tình trạng SQLite

- 19/19 file được kiểm tra trả `quick_check = ok`; không gặp database locked.
- Các database phục vụ chính đều WAL. Notes fallback vẫn DELETE; giữ nguyên vì
  đây là archive được fetcher quản lý, không phải điểm đọc API cần đổi lần này.
- Công cụ `automation/optimize_sqlite.py` không tìm thấy index dư trong danh sách
  đã định nghĩa. Đây không phải kết luận mọi index trong mọi database đều tối ưu.
- Trang trống tổng cộng khoảng 1,1 MiB; không VACUUM hàng loạt, không thêm index
  vào production hoặc thay đổi schema trong đợt này.

## Thay đổi

1. Xóa `FinancialService`, `FinancialRepository`, getter/import và khởi tạo liên
   quan. Getter không có nơi gọi; tham số repository của `ValuationService` chỉ
   được gán, không đọc. Giữ các service và đường fallback còn có người gọi.
2. Chuyển 17 điểm mở connection trong tám module route/handler sang
   `read_connection`: đóng ngay cả khi truy vấn lỗi hoặc return sớm; mở database
   chính với `mode=ro`, tránh tạo nhầm file rỗng. Dùng thời gian chờ 3 giây
   của helper chung (thay cho mặc định 5 giây của sqlite3.connect). Loại import và thiết lập row factory không còn cần thiết.
3. Sửa revenue-profit: `sqlite3.Row` không có `.get()`; đọc YEAR hoặc QUARTER
   trực tiếp để không cộng trùng báo cáo năm với quý. Ngân hàng dùng `isb27`
   (thu nhập lãi thuần) và `isa20` (lợi nhuận sau thuế), đồng nhất mapping của
   `FinancialsTab.tsx`; bỏ hai mapping insurance/securities không được sử dụng.
4. JOIN thống kê toàn thị trường chuyển từ `UPPER(c.ticker)=UPPER(s.ticker)`
   sang `c.ticker=s.ticker COLLATE NOCASE`. SQLite có thể tạo automatic covering
   index thay vì quét toàn bảng companies cho mỗi dòng thống kê. Giữ đối chiếu
   ticker không phân biệt hoa/thường; không cần migration database.

## Đo và kiểm tra

- `python -m unittest discover -s tests`: 43 test, gồm hồi quy kỳ báo cáo,
  ngân hàng, lợi nhuận âm/0, payload API, đóng connection khi lỗi và JOIN với
  ticker khác hoa/thường/mã không có công ty/ngành lọc.
- Query plan income_statement dùng khóa `(ticker, period_kind, ...)`, bỏ
  `USE TEMP B-TREE FOR ORDER BY`. Median 20 lượt trên connection đã mở, dữ liệu
  FPT, LIMIT 24: khoảng 0,097 ms trước → 0,029 ms sau. Hai truy vấn khác phạm vi
  kỳ báo cáo có chủ đích; đây không phải benchmark tốc độ toàn API.
- JOIN thống kê thực tế 1.553 dòng: 2.769 ms trước → 8,25 ms sau, một lượt mỗi
  phương án. Kiểm tra toàn bộ cặp ticker/tên công ty bằng nhau. Query plan chuyển
  `SCAN c` thành `SEARCH c USING AUTOMATIC COVERING INDEX (ticker=?)`.
- HTTP localhost sau restart: revenue-profit FPT/VCB, ratio-daily-history,
  historical-chart-data, stats-financial một mã/toàn thị trường, peers-vci,
  top-movers, index-history, heatmap đều trả 200. Health trả 207/warn vì các vấn đề
  ingestion dưới đây. Các con số là ảnh chụp trên máy hiện tại, không phải load test.

## Việc nên ưu tiên tiếp

- Health ghi nhận giá mới nhất 18/09, financials ngày 21/09 có 132 lỗi và
  news/events chỉ 394/7.805 cặp mã/tab thành công trong 48 giờ. Log news/events
  ghi 7.411 lỗi; các lỗi lấy mẫu financials/news/price gồm timeout Vietcap.
- `vci_safe_run.sh` hiện có thể báo health check passed khi số dòng cũ được giữ
  nguyên nhưng lượt fetch lỗi nhiều hoặc không thêm dòng mới. Cần phân biệt
  up-to-date, upstream failure, tỷ lệ hoàn thành và độ mới theo lịch giao dịch;
  không chỉ dựa vào tổng dòng. Không chạy lại toàn bộ ingestion trong đợt audit.
- Còn đường đọc schema cũ ở `SQLiteDB`/`StockService`, `StockDataProvider` và
  `missing_routes`; một số vẫn có caller, nên không xóa cả module như dead code.
  Ví dụ companies/search vẫn đi qua bảng `company` của adapter cũ: cần chuyển
  sang nguồn VCI cùng kiểm tra payload tương thích.
- Còn connection tự mở ở các module khác; tiếp tục chuẩn hóa riêng từng đường
  đọc/ghi. Không đổi các connection xuất file có CREATE TEMP TABLE sang helper
  `query_only` vì chúng cần quyền tạo bảng tạm.
- Một số điều kiện `UPPER(ticker)` vẫn cản index; cần kiểm tra chuẩn hóa ticker
  và query plan trước khi đổi. Không bỏ xử lý hoa/thường chỉ để tối ưu.
- Giữ database dự phòng và schema rỗng: ít lợi ích hiệu năng khi xóa chúng và
  chưa có đủ bằng chứng về nhu cầu khôi phục để loại bỏ.
