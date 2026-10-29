# So sánh tốc độ với Kalshi — 29/10/2026

Đo trực tiếp [trang tổng quan](https://stock.quanganh.org/vi) và
[Kalshi](https://kalshi.com/) bằng Chromium 156.0.8078.4. Bản tối ưu ban đầu
`39a2e5a` và bản sửa sau benchmark `2983e1e` đều đã deploy thành công trên Vercel.

## Điều kiện và giới hạn

- Desktop: 1365 × 900, CPU bình thường. Mobile giả lập: 390 × 844, CPU chậm 4 lần.
- Cùng mạng giả lập 10 Mbps tải xuống, 5 Mbps tải lên, thêm 40 ms độ trễ.
- Mỗi lượt dùng browser context mới, tắt HTTP cache; không xóa cache CDN/server.
- Quan sát 12 giây từ khi bắt đầu điều hướng, không cuộn hoặc bấm trong phép đo.
  Popup đăng ký tự xuất hiện của Kalshi được giữ nguyên trong các lượt đo.
- 3 lượt cho mỗi website/cấu hình, chạy xen kẽ ở đợt đầu (12 lượt). Sau bản sửa,
  đo lại 3 lượt desktop và 3 lượt mobile cho website mình (thêm 6 lượt).
- Đây là phép đo lab tại một môi trường, không phải dữ liệu người dùng Việt Nam.
  Header `x-vercel-id` quan sát được lần lượt có chuỗi `iad1::sin1` cho website
  mình và `iad1::cle1` cho Kalshi. Không đổi region để tối ưu riêng cho máy
  benchmark này.
- LCP là nội dung lớn nhất được trình duyệt ghi nhận: thường là số chỉ số của
  website mình và ảnh hero của Kalshi. LCP không đo thời điểm canvas chart vẽ xong,
  cũng không có nghĩa toàn bộ request nền đã hoàn tất. Không tạo điểm Lighthouse.

## Kết quả sau bản sửa

Trung vị 3 lượt; thời gian tính bằng giây. Thấp hơn là tốt hơn.

| Cấu hình / chỉ số | Website mình (`2983e1e`) | Kalshi |
| --- | ---: | ---: |
| Desktop: byte HTML đầu tiên | 0,465 | 0,046 |
| Desktop: nội dung đầu tiên (FCP) | 0,936 | 0,860 |
| Desktop: nội dung lớn nhất (LCP) | 0,936 | 0,860 |
| Desktop: dịch chuyển bố cục (CLS) | 0,0282 | 0,0057 |
| Mobile: byte HTML đầu tiên | 0,371 | 0,051 |
| Mobile: FCP | 0,752 | 0,636 |
| Mobile: LCP | 0,936 | 1,140 |
| Mobile: CLS | 0,0149 | < 0,001 |

Độ trễ server/CDN của website mình vẫn cao hơn trên đường mạng này. Thời gian
nội dung chính xuất hiện không chậm hơn Kalshi ở mọi cấu hình. Với 3 mẫu và
cache CDN biến động, không quy chênh lệch FCP/LCP giữa hai đợt thành mức tăng tốc
do thay đổi mã nguồn.

## Lỗi tìm thấy và đã sửa

1. Skeleton route ban đầu để footer nằm trong viewport desktop rồi đẩy footer
   ra ngoài khi dashboard xuất hiện. Đặt chiều cao tối thiểu một viewport cho
   skeleton. CLS desktop trung vị giảm từ **0,2149 xuống 0,0282**, khoảng **87%**.
2. Snapshot chart vắng trong **5/6 lượt** của bản đầu, dù client fallback vẫn tải
   được chart. Nới budget server từ 800 ms lên cùng mức 2,5 giây của chỉ số chính.
   **6/6 lượt mới có snapshot**, không có request API index-valuations sau khi mở
   trang; không có ngoại lệ JavaScript không được xử lý.
3. Bản `39a2e5a` đã tách Suspense cho các vùng dữ liệu và gửi compact chart cùng
   HTML. Năm logo thị trường được phục vụ cùng origin; kiểm tra production xác
   nhận logo trả 200 trực tiếp, `max-age=31536000, immutable`.

## Quan sát Kalshi

Ở lượt desktop mẫu, 394/470 request bắt đầu sau FCP (khoảng 84%). Có nhiều
analytics và request nền; số request toàn phiên không phản ánh thời gian người
dùng bắt đầu đọc trang.

Các chart nhỏ được kiểm tra trong DOM dùng SVG, không có canvas ở trang chủ trong
phiên quan sát: hero chart khoảng 386 × 138, preview khoảng 204 × 65–91. Giao diện
dùng nền trắng, đường chia nhạt, ít mốc trục và đường dữ liệu màu rõ. Đây là hướng
phù hợp cho preview nhỏ; chart phân tích tương tác của website mình có nhu cầu khác.

## Kiểm tra chức năng trên production

- Trang tổng quan trả 200 và tạo canvas chart.
- Nút P/E, P/B đổi trạng thái đúng; chuyển VN30 tải lịch sử 200 và quay lại VN-Index.
- Trang `/en` và `/vi/stock/VCB` trả 200; VCB hiển thị định danh cổ phiếu.
- Viewport 390 px không tràn ngang toàn trang; không có uncaught page exception.
- Lint, TypeScript trong production build, hai bài kiểm tra snapshot và
  `npm run build -- --webpack` đều thành công trước khi push bản sửa.

Số liệu từng lượt và cấu hình đầy đủ: [browser-results.json](2026-10-29-browser-results.json).
