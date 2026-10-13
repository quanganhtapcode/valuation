# Rà soát cron và crawl dữ liệu — 13/10/2026

## Kết luận

Cron trên VPS đã có `valuation.slice` giới hạn tổng CPU 140%, lịch chạy thưa
hơn và khóa theo database trong `vci_safe_run.sh`. Tuy nhiên, cấu hình cài đặt
trong repo chưa khớp với VPS; một số crawler vẫn ghi thừa, giữ giao dịch trong
lúc chờ mạng hoặc báo thành công khi còn lỗi.

Đã sửa source và kiểm tra bằng database tạm/mock HTTP. Chưa cài lại crontab,
chưa chạy crawl toàn bộ trên production và chưa đo hiệu năng sau thay đổi.
Các thay đổi Python sẽ được cron hiện tại sử dụng ở lần khởi chạy kế tiếp;
các tham số/lịch mới trong installer cần cài lại crontab để có hiệu lực.

## Bằng chứng và thay đổi

| Luồng | Phát hiện | Thay đổi |
| --- | --- | --- |
| Cài cron | Source chạy screener mỗi 7 phút cả ngày, stats mỗi giờ; VPS thực tế chạy screener mỗi 30 phút trong ngày giao dịch, stats cuối ngày. Source chưa dùng slice CPU. | Đồng bộ lịch và số worker với cấu hình VPS tiết kiệm tài nguyên, thêm slice CPU và `--dry-run`, giảm retry lồng nhau ở các job chính. |
| Cài cron | Bộ lọc xóa cron cũ thiếu `fetch_vci_financial_statement.py` chạy trực tiếp. | Bổ sung nhận diện, kiểm tra chạy lại không sinh cron trùng và giữ job không thuộc dự án. |
| Thống kê tài chính | Log 12/10: 16:05–17:49, 1.548 mã thành công, 9 mã không có dữ liệu, 5 mã lỗi; wrapper vẫn báo health check passed. Giao dịch batch có thể mở xuyên qua thời gian chờ HTTP. | Trả exit 75 khi còn lỗi, lưu trạng thái/số lỗi; gom dữ liệu trước khi mở giao dịch ngắn; savepoint từng mã ngăn ghi dở snapshot/history. Thêm `--incremental` vào lịch mới để retry bỏ qua mã đã ghi thành công trong ngày UTC. |
| Giá lịch sử | `delay` chỉ nghỉ giữa các trang, trong khi job incremental thường chỉ gọi một trang/mã. Giá không đổi vẫn bị UPDATE; nến lỗi có thể bị bỏ qua sau khi các nến khác đã commit. Log còn bị ghi hai lần do FileHandler và cron redirect cùng một file. | Giới hạn thời điểm bắt đầu request chung cho mọi worker, kể cả retry; kiểm tra cả tập dữ liệu trước khi ghi; dùng `executemany` và chỉ UPDATE khi OHLCV thay đổi; giữ volume 0; dùng một StreamHandler để cron ghi log. Có `--workers` và `--delay`. |
| Tin tức/sự kiện | Log 12/10: lần retry còn 7.719 tác vụ, dừng sau 78 tác vụ với 62 lỗi. Toàn bộ tác vụ được submit trước khi bộ ngắt lỗi hoạt động; mỗi HTTP call tạo kết nối mới. | Chỉ giữ tối đa số worker tác vụ đang chạy, kiểm tra thời gian ngay cả khi chưa có future hoàn tất; session HTTP riêng cho mỗi worker, tái sử dụng kết nối và đóng khi pool kết thúc. |
| Rollback | Khi database ban đầu không tồn tại nhưng còn `last_good` từ lần chạy cũ, wrapper có thể phục hồi nhầm backup cũ. | Chỉ rollback khi đã tạo snapshot từ database tồn tại ở đầu lần chạy hiện tại. |

## Sử dụng

Xem lịch đề xuất mà không thay đổi crontab:

```bash
bash automation/setup_cron_vps.sh --dry-run
```

Installer mặc định giữ backup tại máy, tương ứng crontab thực tế đã kiểm tra.
Biến `VCI_BACKUP_REMOTE` cho phép bật lại upload rclone nếu cần. Ví dụ:

```bash
VCI_BACKUP_REMOTE=onedrive:valuation-backups bash automation/setup_cron_vps.sh --dry-run
```

Chạy installer không có `--dry-run` sẽ cài lịch đã render. VPS cần có
`valuation.slice` như cấu hình hiện tại. Lịch theo timezone của máy chủ.

`--incremental` của stats chỉ bỏ qua mã đã ghi thành công trong cùng ngày UTC.
Chạy không có cờ này khi cần cập nhật lại dữ liệu trong ngày.

Updater giá mặc định cách các lần bắt đầu request ít nhất 0,3 giây, tương
đương tối đa khoảng 3,3 request/giây cho cả pool. Đây là cấu hình giới hạn
tải; tốc độ thực tế còn phụ thuộc thời gian trả lời và retry của upstream.

## Các giới hạn còn lại

- Timeout/hết thời gian của batch news ngừng cấp thêm công việc; các request
  đã chạy vẫn phải kết thúc theo HTTP timeout và số retry. Không hủy cưỡng bức
  thread đang gọi mạng.
- Cron chỉ số vẫn yêu cầu tối đa 46 trang mỗi chỉ số/ngày. Có thể tách một job
  backfill riêng và crawl phần gần nhất hằng ngày, nhưng cần kiểm chứng phân
  trang và khả năng điều chỉnh dữ liệu lịch sử trước khi thay đổi.
- Financials và metadata công ty giữ lịch hằng tuần đang dùng trên VPS. Chưa
  chuyển sang hằng ngày để tránh tăng tải; lịch này có độ trễ với báo cáo mới.
- Health check stats hiện dùng ngưỡng 3 giờ, chưa khớp lịch cập nhật một lần
  mỗi ngày giao dịch. Cần tính lịch giao dịch/ngày nghỉ khi điều chỉnh ngưỡng.
- Wrapper vẫn snapshot toàn database trước mỗi job. Đây là chi phí I/O còn
  lại, đặc biệt với financials khoảng 303 MiB, news/events 227 MiB và giá
  150 MiB tại thời điểm kiểm tra. Chưa giảm bảo vệ rollback để tiết kiệm I/O.
- Excel/R2 đã có pool kết nối và retry, nhưng `downloaded_files` giữ toàn bộ
  nội dung Excel trong RAM trước khi chuyển sang upload. Đây là điểm cần đổi
  sang hàng đợi download/upload có giới hạn hoặc file tạm nếu tiếp tục tối ưu
  bộ nhớ. Chưa sửa luồng này trong đợt thay đổi hiện tại.
- Luồng NAV quỹ đã có khóa chống chạy trùng, session HTTP, incremental đọc
  lại 7 ngày và báo lỗi khi chưa cập nhật đủ quỹ; chưa thấy cần thay đổi các
  cơ chế này qua phần code đã kiểm tra.
- Chưa thay đổi schema hoặc database production.

## Kiểm tra

```bash
.venv/bin/python -m unittest discover -s tests -p test_ingestion_regressions.py
.venv/bin/python -m unittest discover -s tests -p test_sqlite_improvements.py
bash -n automation/setup_cron_vps.sh automation/vci_safe_run.sh
git diff --check
```

32 test ingestion và 27 test SQLite đều qua. Các ca mới kiểm tra rollback
của từng mã, dữ liệu không đổi, volume 0, giới hạn request giữa các mã,
ngắt hàng đợi khi lỗi, vòng đời session, bỏ qua mã thành công khi retry,
không giữ writer lock lúc fetch và tính lặp lại an toàn của installer cron.
