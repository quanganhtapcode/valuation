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

## Đợt tiếp theo: sửa ingestion và phục hồi giá

- Phản hồi giá lỗi/malformed không còn biến thành `up_to_date`; từng trang được
  retry có giới hạn, lỗi trang sau không ghi một backfill thiếu trang. Lỗi ghi
  SQLite được rollback và truyền lên, không trả số bản ghi chưa commit.
- News/events retry từng cặp mã/tab, giảm mặc định từ 20 xuống 4 worker. Giữ
  timestamp cũ khi lỗi hoặc item thiếu ID. Incremental so ngày theo UTC vì
  timestamp được ghi UTC. Có CLI giới hạn mã, worker và số retry.
- Financials áp dụng thực sự `--retry`/`--timeout`, kiểm tra phản hồi lỗi và cấu
  trúc kỳ, dùng opener riêng cho worker và không khóa toàn bộ network I/O.
- Cả ba luồng dùng exit 75 cho kết quả không đầy đủ. Safe-run giữ tiến độ đã ghi
  khi retry loại lỗi này, vẫn kiểm tra sụt giảm dữ liệu và rollback khi vi phạm;
  không còn thông báo thành công chỉ vì tổng số dòng cũ được giữ nguyên.
- Metadata thêm trạng thái, phạm vi, số thành công/thất bại và thời gian chạy.
  Health phân biệt lượt chạy subset, full và partial; không coi một mẫu nhỏ là
  bằng chứng toàn thị trường đã được cập nhật.

Kiểm tra: 61 test đạt, gồm test chạy shell safe-run thực tế trên SQLite tạm cho
partial/retry/rollback, test financial main với writer thật, và concurrency HTTP.
Kiểm tra cú pháp Python, `bash -n`, `git diff --check`.

Kết quả chạy thực tế có backup và khóa database:

- Giá: 1.561/1.561 mã thành công, 1.523 bản ghi upsert, 38 mã không có dữ liệu mới,
  1 mã phục hồi sau retry, khoảng 112 giây. Ngày mới nhất lên 21/09/2026.
- News/events mẫu FPT, VCB, MWG, HDC, BMI: lượt đầu 23/25 thành công và exit 75;
  lượt sau bỏ qua đúng 23 cặp đã xong, hoàn tất 2 cặp còn lại, exit 0. Tổng số
  items 213.055 không giảm. Chưa chạy lại toàn bộ 7.805 cặp trong đợt này.
- Đọc thử không ghi cho MWG, HDC, BMI: cả ba trả đủ balance sheet, income,
  cash flow, note. Đây là xác minh upstream, chưa phải phục hồi toàn bộ 132 lỗi
  financials được ghi trong lượt toàn thị trường trước đó.

Không thay lịch cron hoặc bật thông báo Telegram. Các lượt theo lịch tiếp theo
sẽ dùng code mới và phản ánh lỗi partial thay vì báo thành công giả.

## Đợt 3: company search, dọn adapter cũ và giới hạn recovery

- Sửa `/api/companies/search`: adapter cũ truy vấn bảng `company` trong screening
  trong khi nguồn thực tế là `companies` tại company DB. List/search nay dùng
  chung truy vấn VCI, giữ các trường `symbol`, `name`, `exchange`, `industry`.
  Search hỗ trợ tên ngắn/tên tiếng Anh (ví dụ Vinamilk), ưu tiên mã khớp chính xác,
  xử lý `%`/`_` như ký tự tìm kiếm và trả 400 khi tham số phân trang không hợp lệ.
- Loại bỏ `backend/data_sources/sqlite_db.py` (322 dòng) sau khi chuyển caller cuối,
  cùng các phương thức StockService và khởi tạo/import không còn được dùng.
- Connection chính và database attach đều dùng `mode=ro`, đường dẫn attach được
  truyền qua SQL parameter. JOIN dùng NOCASE; kiểm tra 500 dòng company list giống
  kết quả truy vấn cũ. Không thay schema, frontend hoặc hợp đồng response.
- Bổ sung budget và dừng theo chuỗi lỗi cho news/events/financials; health hiển thị
  lý do dừng và số tác vụ chưa xử lý. Sửa `--resume-missing` dựa trên trạng thái
  mới nhất của mỗi ticker, tránh bỏ qua lỗi mới chỉ vì từng có lần thành công.

Kiểm tra: 71 test đạt, bao gồm tìm mã/tên/alias, ưu tiên mã chính xác, literal
wildcard, đường dẫn có dấu nháy, missing attachment, đóng connection, phân trang,
request budget, chuỗi lỗi và resume sau một thành công cũ/lỗi mới.

Kết quả nguồn thật trong đợt này:

- Hai lượt toàn thị trường gặp timeout liên tục. Đã dừng đúng hai nhóm tiến trình
  do task khởi chạy; giữ những transaction đã commit và đánh dấu metadata partial.
  News/events thêm 64 cặp mã/tab được refresh; financials 7 mã thành công, 23 mã
  lỗi và 1.531 mã chưa xử lý trong lượt này. Không coi đây là full refresh đạt.
- Lượt news/events mới có giới hạn 90 giây, một worker, không retry: bỏ qua 89
  cặp đã thành công trong ngày, tự dừng sau 5 lỗi liên tiếp; 7.711 tác vụ còn lại.
  Safe-run trả 75, giữ số dòng và không tuyên bố dữ liệu đã cập nhật đầy đủ.
- Thử financials chỉ cho các mã có kết quả mới nhất là lỗi, timeout 5 giây:
  endpoint mapping đã timeout trước khi bắt đầu fetch từng mã. Safe-run trả lỗi
  và khôi phục backup trước lượt thử. Không tiếp tục gây tải lên nguồn đang lỗi.
- News/events vẫn có 213.056 items. Snapshot trước mỗi lượt chạy nằm trong
  `data/backups/ingestion-20260922/` theo chính sách giữ backup hiện hành.

Phần còn phụ thuộc nguồn ngoài: phục hồi đầy đủ news/events/financials khi
Vietcap phản hồi ổn định. Code tự giới hạn thời gian và báo partial rõ ràng;
không dùng dữ liệu cũ để giả lập một lượt cập nhật thành công.
