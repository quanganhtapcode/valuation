# Rà soát dữ liệu Vĩ mô — 01/10/2026

## Kết quả

- Kiểm tra toàn bộ 28 chuỗi kinh tế Việt Nam và 8 chuỗi tỷ giá/hàng hóa trong macro_history.sqlite.
- Bốn tỷ giá VND có mốc cuối 01/10/2026; bốn hàng hóa có mốc cuối 30/09/2026.
- Nhiều chuỗi kinh tế còn dừng ở tháng 6/quý II. Chuỗi lãi suất qua đêm dừng ngày 07/07/2026; thất nghiệp và lương dừng quý I.
- Các chuỗi theo năm có kỳ cuối 2023–2026; năm dữ liệu cũ không tự chứng minh lỗi tải dữ liệu. Cần đối chiếu lịch công bố và nguồn tương ứng.
- Cron macro_history hiện chỉ tải tỷ giá và hàng hóa từ Yahoo; không có tác vụ cập nhật ECONOMICS trong mã và cấu hình cron được kiểm tra. Vì vậy khôi phục cron tỷ giá không cập nhật các chuỗi kinh tế này.
- FireAnt đã tải lại thành công lúc 07:00 ngày 01/10 (96 chỉ tiêu, 6.668 điểm upsert); metadata nguồn vẫn trả kỳ cũ như bảng dưới. Trang Việt Nam hiện dùng các chuỗi ECONOMICS trong macro_history, không dùng dữ liệu FireAnt. Không thay thế hai nguồn vì có khác biệt kỳ và định nghĩa chỉ tiêu.
- macro_prices không lưu thời điểm tải; cột ngày trên giao diện là ngày/kỳ quan sát cuối, không phải last fetched. Không đổi ngày này thành ngày hôm nay.

## Tất cả các chuỗi đang hiển thị

| Chỉ tiêu/mã | Kỳ dữ liệu cuối trong DB | Số điểm |
| --- | --- | --- |
| BZ=F (BZ=F) | 2026-09-30 | 755 |
| CNYVND=X (CNYVND=X) | 2026-10-01 | 779 |
| Cán Cân Thương Mại (ECONOMICS:VNBOT) | 2026-06-01 | 352 |
| Lạm Phát Lõi (ECONOMICS:VNCIR) | 2026-06-01 | 135 |
| Chỉ Số Giá Tiêu Dùng (CPI) (ECONOMICS:VNCPI) | 2026-06-01 | 378 |
| Lãi Suất Tiền Gửi (ECONOMICS:VNDIR) | 2023-12-01 | 28 |
| Xuất Khẩu (ECONOMICS:VNEXP) | 2026-06-01 | 361 |
| Đầu Tư Trực Tiếp Nước Ngoài (FDI) (ECONOMICS:VNFDI) | 2026-06-01 | 234 |
| Dự Trữ Ngoại Hối (ECONOMICS:VNFER) | 2025-12-01 | 348 |
| Lạm Phát Thực Phẩm (ECONOMICS:VNFI) | 2026-06-01 | 266 |
| Giá Xăng Dầu (ECONOMICS:VNGASP) | 2026-06-01 | 155 |
| GDP - Nông Nghiệp (ECONOMICS:VNGDPA) | 2026-06-01 | 54 |
| GDP Thực Tế (hàng quý) (ECONOMICS:VNGDPCP) | 2026-06-01 | 54 |
| GDP - Công Nghiệp (ECONOMICS:VNGDPMAN) | 2026-06-01 | 54 |
| GDP Bình Quân Đầu Người (ECONOMICS:VNGDPPC) | 2025-12-01 | 42 |
| GDP - Dịch Vụ (ECONOMICS:VNGDPS) | 2026-06-01 | 54 |
| Tăng Trưởng GDP (YoY) (ECONOMICS:VNGDPYY) | 2026-06-01 | 104 |
| Đầu Tư Tài Sản Cố Định (ECONOMICS:VNGFCF) | 2025-12-01 | 36 |
| GNP (ECONOMICS:VNGNP) | 2024-12-01 | 35 |
| Nhập Khẩu (ECONOMICS:VNIMP) | 2026-06-01 | 357 |
| Lãi Suất Liên Ngân Hàng Qua Đêm (ECONOMICS:VNINBR) | 2026-07-07 | 5048 |
| Lãi Suất Chính Sách (ECONOMICS:VNINTR) | 2026-06-01 | 315 |
| Sản Lượng Công Nghiệp (YoY) (ECONOMICS:VNIPYY) | 2026-06-01 | 209 |
| Lạm Phát (YoY) (ECONOMICS:VNIRYY) | 2026-06-01 | 366 |
| Cung Tiền M2 (ECONOMICS:VNM2) | 2024-12-01 | 39 |
| Lương Tối Thiểu (ECONOMICS:VNMW) | 2026-01-01 | 21 |
| Dân Số (ECONOMICS:VNPOP) | 2025-12-01 | 66 |
| Doanh Thu Bán Lẻ (YoY) (ECONOMICS:VNRSYY) | 2026-06-01 | 280 |
| Tỷ Lệ Thất Nghiệp (ECONOMICS:VNUR) | 2026-03-01 | 71 |
| Lương Bình Quân (ECONOMICS:VNWAG) | 2026-03-01 | 64 |
| EURVND=X (EURVND=X) | 2026-10-01 | 779 |
| GC=F (GC=F) | 2026-09-30 | 755 |
| JPYVND=X (JPYVND=X) | 2026-10-01 | 779 |
| SI=F (SI=F) | 2026-09-30 | 754 |
| USDVND=X (USDVND=X) | 2026-10-01 | 779 |
| ZR=F (ZR=F) | 2026-09-30 | 753 |

## Đối chiếu nguồn FireAnt

Ngày kỳ cuối dưới đây là giá trị lớn nhất của nhóm, không có nghĩa mọi chỉ tiêu trong nhóm đều đạt ngày đó.

| Nhóm | Số chỉ tiêu | Kỳ cuối lớn nhất | Đã tải lúc (UTC) |
| --- | --- | --- | --- |
| Business | 10 | 2026-05-29 | 2026-10-01T00:00:03Z |
| Consumer | 5 | 2026-05-29 | 2026-10-01T00:00:03Z |
| GDP | 24 | 2026-03-31 | 2026-10-01T00:00:03Z |
| InterestRate | 17 | 2026-06-16 | 2026-10-01T00:00:03Z |
| Labour | 10 | 2026-03-31 | 2026-10-01T00:00:03Z |
| Money | 5 | 2025-09-30 | 2026-10-01T00:00:03Z |
| Prices | 7 | 2026-05-29 | 2026-10-01T00:00:03Z |
| Taxes | 6 | 2025-12-31 | 2026-10-01T00:00:03Z |
| Trade | 12 | 2026-05-29 | 2026-10-01T00:00:03Z |
