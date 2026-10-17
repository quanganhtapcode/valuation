# Rà soát hiệu năng và API ngày 18/10/2026

Đợt này tập trung giảm công việc trên đường xử lý request, giảm dữ liệu thừa và chuẩn hóa URL mà vẫn giữ các client đang chạy tương thích. Quy ước URL, response, lỗi và cache được ghi tại [api-contract.md](api-contract.md).

## Frontend

- Tách state và subscription chỉ số thị trường vào `MarketIndices`. Snapshot WebSocket chỉ cập nhật vùng chỉ số, tránh render lại toàn bộ dashboard.
- Tải phần so sánh quỹ bằng dynamic import khi mở tab; giữ nội dung chỉ số chính trong lần render đầu.
- Tắt prefetch tự động trên các link trong danh sách quỹ và screener để giảm request nền theo số dòng hiển thị.
- Tái sử dụng `Intl.NumberFormat` và dữ liệu biểu đồ NAV đã tính thay vì tạo lại theo từng ô hoặc lần render.
- Dùng polling tuần tự cho trang quỹ và giao dịch khối ngoại: dừng khi tab ẩn, cập nhật khi quay lại, tránh request định kỳ chồng nhau.
- Screener bỏ qua response của trang, bộ lọc hoặc thứ tự sắp xếp cũ khi người dùng đã chuyển lựa chọn.

## Backend và luồng dữ liệu

- Request giá có `symbols` tra trực tiếp các mã cần thiết trong cache RAM, tránh duyệt cả thị trường. Giá trị số không hữu hạn được xử lý trước khi trả JSON.
- Danh sách tin `compact=1` chỉ đọc các cột phục vụ giao diện từ SQLite, tránh đọc và giải mã toàn bộ `raw_json`. Snapshot cũ chỉ có `raw_json` vẫn dùng đường tương thích.
- Trang tin rỗng trong snapshot đã khởi tạo trả ngay danh sách rỗng, tránh gọi upstream khi phân trang vượt dữ liệu đã lưu.
- Overview compact bỏ bản sao `peChart`, giữ `indexValuationChart` và tin rút gọn. Cache tin compact và đầy đủ có key riêng.
- Cache response cổ phiếu có giới hạn 300 mục, khóa truy cập và TTL dùng đồng hồ monotonic; kết quả rỗng cũng được cache.
- URL công khai dùng cấu trúc tài nguyên như `/api/stocks/{symbol}/price-history`. URL cũ tiếp tục dùng cùng handler; manifest alias được chia sẻ giữa backend và proxy.
- Proxy chuyển tiếp body thành công theo stream, giữ status và header tải file; lỗi dùng cùng schema. Cache phân theo loại tài nguyên, giữ các giới hạn upstream và tránh thêm một lớp cache fetch lâu dài trong Next.js.

## Số đo cục bộ

| Phép đo | Trước | Sau |
| --- | ---: | ---: |
| JSON overview đầy đủ so với compact, cùng dữ liệu | 111.338 byte | 47.022 byte, giảm 57,8% |
| Đọc 50 tin compact từ SQLite | 1,907 ms | 0,914 ms |
| Chọn 6 mã trong cache 1.700 mã | 0,0846 ms | 0,0066 ms |

Đây là số đo trên dữ liệu và môi trường cục bộ, không phải đo tải production, độ trễ qua mạng hoặc Core Web Vitals. Thời gian thực tế phụ thuộc cache, tài nguyên máy và nguồn dữ liệu. Chưa có số đo LCP/INP trước–sau trong trình duyệt.

Đối chiếu độc lập toàn bộ 8.415 bản tin trong SQLite hiện có cho thấy các field của projection compact mới khớp response compact cũ, không có sai khác.

## Kiểm tra

- 148 kiểm thử Python đạt, gồm hợp đồng API, alias, cache và đường đọc dữ liệu tối ưu.
- 23 kiểm thử TypeScript đạt.
- `npm run lint`: không có lỗi; còn một warning có sẵn về eslint-disable thừa tại `src/hooks/useScroll.ts`.
- `npx tsc --noEmit --incremental false`: đạt.
- `npm run build -- --webpack`: đạt; tạo đủ 38 trang tĩnh. Lần build Turbopack mặc định bị đình trệ trong môi trường kiểm tra nên dùng Webpack để hoàn tất production build.

Kiểm thử cron được sửa số dòng kỳ vọng từ 17 thành 18 để tính cả lịch Vietnam macro đã có trong installer, đồng thời kiểm tra job này chỉ xuất hiện một lần. Thay đổi đó sửa assertion cũ, không thêm hay thay lịch cron.

Backend và frontend cần nạp phiên bản mới để các tối ưu có hiệu lực. Frontend chuyển URL chuẩn về upstream tương thích bằng manifest nên không phụ thuộc thứ tự triển khai hai bên. Không cần cập nhật hoặc commit các file SQLite runtime cho đợt này.
