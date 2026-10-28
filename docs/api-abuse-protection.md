# Bảo vệ API tại VPS

Quy ước endpoint, lỗi và cache nằm trong `api-contract.md`. Schema thành công không thay đổi.

Hai location REST `/v1/valuation/` trên VPS dùng giới hạn sau từ `automation/nginx/valuation-header-rate-*.conf.example`:

- Có cả `Origin: https://stock.quanganh.org` và `Referer` bắt đầu bằng `https://stock.quanganh.org/`: 20 request/giây cho mỗi IP kết nối, burst 100.
- Các request còn lại: 2 request/phút cho mỗi IP, không burst; request tiếp theo được nhận sau 30 giây.
- Vượt giới hạn trả HTTP 429 theo chuẩn lỗi API, `Retry-After: 30` và `Cache-Control: no-store`. WebSocket không dùng rule này; giới hạn export hiện có vẫn áp dụng.

Các header này do client tự đặt và có thể giả mạo: rule chỉ hạn chế crawler thông thường, không xác thực nguồn truy cập. Crawler cũng có thể gọi frontend proxy công khai `/api`, nơi hiện không có hạn mức riêng theo khách. Muốn kiểm soát thực sự cần bảo vệ ở edge frontend và xác thực giữa proxy với origin.

Nginx chỉ tin `CF-Connecting-IP` từ dải proxy Cloudflare liệt kê trong `valuation-cloudflare-realip.conf`, áp dụng riêng tại hai location REST; kết nối trực tiếp dùng IP socket. Cập nhật các dải theo danh sách chính thức của Cloudflare. Request server-side từ Vercel vẫn được tính theo IP Vercel, có thể dùng chung giữa nhiều người. Không tin `X-Forwarded-For` hoặc header Cloudflare do client trực tiếp gửi.

Trên VPS, nội dung zone được cài tại `/etc/nginx/conf.d/valuation-rate-zone.conf`; location, lỗi và real IP nằm trong `/etc/nginx/snippets/`. Các file `.example` là nguồn đã triển khai dù giữ đuôi tên để tránh tự động được include. Khi thay đổi phải đồng bộ, chạy `nginx -t`, reload và theo dõi 429. `valuation-rate-zone.conf` và `valuation-rate-location.conf` cũ trong repository là phương án rollback 50 request/giây, burst 200.

`robots.txt` và `X-Robots-Tag` chỉ là chỉ dẫn lập chỉ mục, không ngăn crawler cố tình truy cập. Không thể suy ra cấu hình WAF riêng của Vietcap từ website công khai.
