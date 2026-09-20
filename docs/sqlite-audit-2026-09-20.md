# Kiểm tra SQLite ngày 20/09/2026

## Phạm vi và phương pháp

Kiểm tra các file trong `data/` của checkout hiện tại bằng kết nối `mode=ro`; đọc schema, số dòng, index, journal mode, freelist và EXPLAIN QUERY PLAN. Không thay đổi database, chạy fetcher, VACUUM hoặc migration. Không chạy integrity_check toàn bộ. Không xác minh crontab đang cài trên host; lịch dưới đây là cấu hình trong repository. Không đo HTTP production, mạng hoặc thời gian render trình duyệt.

Benchmark trên máy hiện tại, mã VCB: mở kết nối mới mỗi lần, execute/fetchall, chuyển kết quả thành dictionary, đóng kết nối. Bảng đầu dùng median 10 lần sau lần đầu; không xóa OS page cache nên không phải cold-disk benchmark. Các phép đo nối tiếp, không phải load test đồng thời. Thí nghiệm tách conversion dùng median 7 lần. Số liệu chỉ là ảnh chụp tại thời điểm kiểm tra; ingestion có thể chạy đồng thời.

## Cấu trúc và dung lượng

23 file, tổng 1.287,40 MiB (~1,26 GiB), gồm 3 file 0 byte. Tổng này chỉ tính file `.sqlite`, không tính WAL, journal, backup nén hay JSON xuất kèm. Tổng freelist của những DB đọc được chỉ ~0,70 MiB: VACUUM hàng loạt hiện không có nhiều lợi ích thu hồi trang trống.

| File | MiB | Journal | Các bảng có dữ liệu (số dòng) |
|---|---:|---|---|
| `data/financial-statements/vci_financial_statement_data/vci_financial_statements.sqlite` | 116.11 | wal | `statement_metrics`: 709; `statement_periods`: 192,482; `meta`: 3; `balance_sheet`: 65,629; `income_statement`: 67,789; `cash_flow`: 59,064 |
| `data/sqlite/fireant_macro.sqlite` | 0.52 | wal | `macro_indicators`: 96; `macro_data`: 7,816; `beta_cache`: 1,343 |
| `data/sqlite/legacy/database.sqlite` | 0.00 | — | File 0 byte |
| `data/sqlite/legacy/valuation_cache.sqlite` | 0.00 | — | File 0 byte |
| `data/sqlite/macro_history.sqlite` | 1.09 | wal | `macro_prices`: 15,666 |
| `data/sqlite/valuation_cache.sqlite` | 10.95 | wal | `valuations`: 1,543; `ai_financial_analysis`: 2,036; `vci_financial_data`: 1,560; `vci_financial_data_years`: 7,790; `market_ai_takeaways`: 2 |
| `data/sqlite/vci_ai_analysis.sqlite` | 0.00 | — | File 0 byte |
| `data/sqlite/vci_company.sqlite` | 3.42 | wal | `fetch_log`: 68; `companies`: 2,099; `security_master`: 2,099 |
| `data/sqlite/vci_financials.pre-ssi-merge-20260814T144003Z.sqlite` | 237.19 | wal | `statement_metrics`: 2,139; `statement_periods`: 190,223; `fetch_log`: 154,109; `meta`: 4; `balance_sheet`: 49,480; `income_statement`: 49,535; `cash_flow`: 48,697; `note`: 42,511 |
| `data/sqlite/vci_financials.sqlite` | 300.43 | wal | `statement_metrics`: 2,142; `statement_periods`: 289,438; `fetch_log`: 60,278; `meta`: 5; `balance_sheet`: 83,808; `income_statement`: 86,031; `cash_flow`: 76,938; `note`: 42,661; `statement_provenance`: 188,837 |
| `data/sqlite/vci_financials_notes_fallback.sqlite` | 95.41 | delete | `note`: 42,661; `note_periods`: 42,661; `note_metrics`: 1,402 |
| `data/sqlite/vci_foreign.sqlite` | 1.00 | wal | `foreign_net_snapshot`: 20; `foreign_volume_minute`: 5,438 |
| `data/sqlite/vci_index_history.sqlite` | 4.34 | wal | `market_index_history`: 9,590; `meta`: 2 |
| `data/sqlite/vci_market_news.sqlite` | 19.99 | delete | `news_items`: 8,252; `news_meta`: 3 |
| `data/sqlite/vci_news_events.sqlite` | 224.35 | — | Không đọc được: database is locked |
| `data/sqlite/vci_price_history.sqlite` | 148.24 | wal | `stock_price_history`: 1,897,978 |
| `data/sqlite/vci_ratio_daily.sqlite` | 41.75 | wal | `ratio_daily`: 1,397; `meta`: 4; `ratio_daily_history`: 478,130 |
| `data/sqlite/vci_screening.sqlite` | 2.76 | wal | `screening_data`: 1,561; `meta`: 1 |
| `data/sqlite/vci_shareholders.sqlite` | 5.13 | wal | `shareholders`: 26,319; `meta`: 3 |
| `data/sqlite/vci_short_financials.sqlite` | 39.10 | wal | `short_financial_history`: 17,001; `short_financial_latest`: 386; `short_financial_payload`: 387; `meta`: 7 |
| `data/sqlite/vci_stats_financial.sqlite` | 16.05 | wal | `stats_financial_history`: 49,625; `stats_financial`: 1,553; `meta`: 3 |
| `data/sqlite/vci_technical.sqlite` | 18.18 | wal | `technical_snapshots`: 4,818; `technical_meta`: 2 |
| `data/sqlite/vci_valuation.sqlite` | 1.39 | delete | `valuation_history`: 5,655; `meta`: 1; `valuation_stats`: 2; `ema_breadth_history`: 6,005 |

Financials dùng dạng rộng: balance_sheet 341 cột, income_statement 192 cột, cash_flow 234 cột, note 1.411 cột. Khóa chính thường là (ticker, period_kind, year_report, quarter_report). statement_metrics lưu định nghĩa chỉ tiêu; statement_periods lưu kỳ; statement_provenance lưu nguồn theo mã/báo cáo/kỳ. Vẫn có schema legacy rỗng; không nên xóa trước khi chuyển các đường đọc cũ.

Giá dùng (symbol,time), tỷ số lịch sử dùng (ticker,trading_date). Mô hình snapshot + history đã có ở ratios, stats và short financials. Tin tức, screening, technical và financial cache còn lưu JSON bên cạnh cột được trích xuất. Payload gốc short financials đã nén gzip, nhưng raw_json từng dòng history/latest vẫn là TEXT.

Bản trước SSI 237,19 MiB + financials legacy 116,11 MiB + notes fallback 95,41 MiB chiếm ~448,71 MiB. Đây là dữ liệu dự phòng/legacy, không phải dung lượng được phép xóa ngay. notes fallback hiện không có PK/index; không tìm thấy đường đọc trực tiếp trong backend qua tên file này, nhưng fetcher vẫn cập nhật archive.

## Tốc độ đo được

| Đọc dữ liệu | Dòng | Median, ms |
|---|---:|---:|
| Giá VCB gần nhất | 1.000 | 3,52 |
| Lịch sử PE/PB VCB | 347 | 1,38 |
| Tin thị trường | 12 | 0,27 |
| Tin VCB | 15 | 0,31 |
| Toàn bộ screening, tất cả cột | 1.561 | 37,84 |
| Balance sheet VCB, tất cả cột, không lọc period_kind | 24 | 26,47 |
| Note VCB, tất cả cột, không lọc period_kind — truy vấn chẩn đoán | 24 | 381,77 |
| Note fallback — truy vấn chẩn đoán, không phải đường API đã xác minh | 24 | 431,88 |
| News/events | — | database is locked |

Giá, ratios, tin thị trường dùng index đúng. Truy vấn financials chỉ lọc ticker nhưng sắp xếp year/quarter phải dùng TEMP B-TREE vì period_kind nằm giữa các cột khóa. Không tự thêm điều kiện period_kind nếu nghiệp vụ cần cả quý và năm; trường hợp đó phải cân nhắc index riêng sau benchmark.

### Chi phí Python đáng kể hơn SQL ở bảng rộng

Cùng SELECT, cùng số dòng/cột, chỉ đổi từ sqlite3.Row → dict(row) sang tuple → dict(zip(column_names,row)):

| Dữ liệu | Cách hiện tại, ms | Tuple + zip, ms |
|---|---:|---:|
| Balance sheet, 24 dòng, không lọc loại kỳ | 27,05 | 6,00 |
| Balance sheet, 24 quý | 32,06 | 4,34 |
| Note, 8 năm | 125,47 | 6,59 |

Ở note 8 năm, riêng mở/đọc SQL khoảng 5,44 ms; chuyển dictionary khoảng 120,09 ms. Không được diễn giải con số 381 ms phía trên thành thời gian SQL thuần. backend/vci_data_access.py đang dùng dict(row); loan_breakdown.py chọn tất cả cột và tra từng tên cột dù chỉ cần một nhóm chỉ tiêu. Nên ưu tiên SELECT các cột cần thiết; nếu cần đầy đủ cột thì đổi cách chuyển dictionary. Mức tăng tốc này là microbenchmark, chưa phải mức tăng tốc toàn API.

## Luồng lấy, ghi và phục vụ dữ liệu

1. automation/setup_cron_vps.sh khai báo cron gọi fetcher VCI/Vietcap, FireAnt và các nguồn theo từng script. Screener mỗi 7 phút; market news mỗi 10 phút; foreign mỗi 2 phút trong khung 9–15 ngày làm việc; stats mỗi giờ; financials, giá, ratios, company và các bộ khác theo lịch ngày/tuần. Cần đối chiếu timezone host và crontab thực tế trước khi đổi lịch.
2. automation/vci_safe_run.sh dùng flock, SQLite backup, kiểm tra tổng dòng/chất lượng, retry và restore khi cần. Cấu hình còn có backup remote. Backup bảo vệ ghi lỗi nhưng số dòng không chứng minh dữ liệu mới hay đầy đủ từng mã.
3. Fetcher dùng HTTP worker pool rồi ghi SQLite qua upsert/replace, nhiều script commit theo batch. update_price_history lấy mốc mới nhất để cập nhật incremental; vẫn cần cơ chế sửa lại lịch sử khi upstream điều chỉnh dữ liệu.
4. run_pipeline.py chỉ refresh security master và batch valuation; không phải pipeline lấy toàn bộ dữ liệu. stock-fetch.timer khai báo chạy 4 lần/ngày.
5. Backend đọc qua db_path.py, VCIDataAccess và SQL riêng tại từng route/service; dùng TTL cache trong từng process, namespace version file để truyền invalidation. Một số route fallback sang upstream ngay trong request. Frontend gọi API để nhận dữ liệu đã xử lý.

## Các cải thiện theo ưu tiên

### P1 — Khóa news/events và thời gian chờ request

vci_news_events.sqlite trả database is locked ở hai lần inventory và một lượt benchmark riêng. Header read/write version 1/1 và file rollback journal tồn tại tại thời điểm kiểm tra. Điều này cho thấy file ở rollback-journal mode; chưa đủ để kết luận writer nào giữ khóa hay có journal cần recovery. Không tự xóa journal hoặc ép mở immutable.

batch_news.py chưa bật WAL, giữ transaction tới mỗi 500 tác vụ hoàn tất và chờ HTTP futures giữa các lần ghi. Route news_events.py chờ SQLite tối đa 5 giây, rồi có đường fallback upstream. Đây là tổ hợp có thể tạo độ trễ lớn. Đề xuất xác minh tiến trình/transaction, chuyển WAL trong đợt bảo trì phù hợp, gom batch đã fetch xong trước transaction ngắn, đặt thời hạn commit theo thời gian và số dòng. Theo dõi lock wait và lỗi busy. WAL cho phép reader/writer đồng thời nhưng vẫn chỉ có một writer và không loại trừ mọi SQLITE_BUSY: https://www.sqlite.org/wal.html

### P1 — Độ mới và độ phủ dữ liệu

short_financials chỉ có 386 mã latest, 17.001 dòng history; meta.last_run_finished = 2026-05-09T16:28:50+00:00. Không có lịch short_financials trong setup_cron_vps.sh đã đọc. Cần xác định có còn là nguồn phục vụ không; nếu còn thì bổ sung lịch và cảnh báo độ trễ/độ phủ, nếu không thì đánh dấu deprecated rõ ràng. Không coi đây là snapshot hiện tại.

Đối chiếu: ratio_daily cập nhật thành công 1.397 mã ngày 20/09; stats metadata có lượt hoàn thành 1.552 mã ngày 20/09 và lượt mới đang có started sau finished; financials lượt gần nhất trong meta là 19/09, 1.561 thành công, 0 lỗi, khoảng 1.498 giây. Số mã khác nhau chưa tự chứng minh mất dữ liệu vì tập nguồn có thể khác; nên đối chiếu security_master và tập mã hợp lệ của từng nguồn.

Nên lưu rõ run_id, started_at, finished_at, status, source timestamp, coverage và số lỗi. Snapshot nhiều DB đang được cập nhật độc lập, không có bằng chứng về một transaction/generation chung; nên trả as_of riêng từng bộ thay vì ngầm coi đồng thời.

### P1 — Giảm cột đọc và chi phí chuyển dữ liệu

Sửa các đường bảng rộng đã xác minh ở VCIDataAccess và loan_breakdown. Đo SQL, conversion, business logic, JSON encode riêng. Chuẩn hóa period_kind với giá trị thật YEAR/QUARTER. Kiểm tra tính tương đương payload, thứ tự, NULL và kiểu số trước triển khai.

### P2 — Hạn chế HTTP đồng bộ khi mở trang

/events/<symbol> trong news_events.py vẫn gọi bốn nhóm event upstream tuần tự, timeout 10 giây mỗi call, khi miss memory cache. Đây là rủi ro latency nhìn thấy trong code, chưa phải số đo endpoint. Nên phục vụ snapshot SQLite trước, refresh nền và trả data_as_of; phân biệt dữ liệu rỗng hợp lệ với lỗi nguồn.

### P2 — Chuẩn hóa tầng đọc và vòng đời connection

Có cả mode=ro và connect mặc định có thể tạo file mới; có with sqlite3.connect mà không đóng connection tường minh; VCIDataAccess._connect bắt exception quanh yield rồi yield lần hai, có thể che lỗi truy vấn bằng lỗi context manager. Chuẩn hóa helper mode=ro/query_only cho reader, timeout rõ ràng, đóng trong finally và xử lý lỗi mà không yield hai lần. Thu hẹp fallback đường dẫn legacy để tránh đọc nhầm file khi cấu hình trỏ tới file không tồn tại.

### P2 — Tối ưu lưu trữ có chọn lọc

Không cần VACUUM tất cả: freelist hiện rất nhỏ. Bảng note chiếm ~89,84 MiB trong financials; cân nhắc tách phần ít truy cập hoặc bảng chỉ tiêu cần cho API, nhưng phải benchmark/migration trước. short_financial_history ~33,28 MiB có raw_json lặp bên cạnh cột tách; cân nhắc chuyển raw sang archive nén với version/hash nếu vẫn cần audit. Không nén những trường phải lọc SQL.

Có index đơn ở shareholders.ticker (~0,34 MiB) và macro_data.indicator_id (~0,086 MiB) được khóa ghép bao phủ tiền tố; chỉ bỏ sau kiểm tra query plan/workload. Không bỏ idx_ph_time: phục vụ truy vấn theo ngày toàn thị trường. Quy tắc index ghép và tiền tố: https://www.sqlite.org/queryplanner.html

Di chuyển/nén backup trước SSI và legacy sau khi xác nhận cấu hình, đường fallback và yêu cầu khôi phục. Không xóa note fallback chỉ vì số dòng trùng: chưa so sánh nội dung.

## Kết luận

Dữ liệu giá/tỷ số/tin thị trường ở quy mô hiện tại đọc nhanh với SQLite. Chưa có bằng chứng cần chuyển PostgreSQL hay gom tất cả DB. Ưu tiên: xử lý khóa news/events, xác nhận nguồn short_financials quá cũ, giảm SELECT * và chi phí Python, rồi đo HTTP/browser. Chỉ cân nhắc đổi database khi có yêu cầu nhiều writer, nhiều host hoặc SLA đồng thời mà benchmark thực tế chứng minh SQLite không đáp ứng.
