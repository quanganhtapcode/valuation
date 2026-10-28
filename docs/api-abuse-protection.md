# Bảo vệ API tại VPS

Quy ước endpoint, lỗi và cache được mô tả trong `api-contract.md`. Không đổi schema thành công của endpoint hiện có khi bổ sung bảo vệ.

Các snippet trong `automation/nginx/` cung cấp giới hạn tổng quát cho REST ở origin: 50 request/giây mỗi địa chỉ kết nối, cho phép burst 200; vượt giới hạn trả HTTP 429 theo chuẩn lỗi API, `Retry-After` và `Cache-Control: no-store`. Đây là giới hạn bảo vệ VPS, không phải hạn mức riêng cho từng người dùng. Các kết nối WebSocket không dùng rule này. Giới hạn export hiện có vẫn áp dụng.

Trên VPS hiện tại, `valuation-rate-zone.conf` nằm trong `/etc/nginx/conf.d/`; hai snippet còn lại nằm trong `/etc/nginx/snippets/` và được include tại các virtual host API và địa chỉ IP trực tiếp. Khi thay đổi, đồng bộ các snippet vào những vị trí này, kiểm tra `nginx -t` trước khi reload và theo dõi 429 cùng tải thực tế để điều chỉnh. Các file trong repository không tự triển khai.

Origin nhìn thấy IP của Cloudflare hoặc Vercel, có thể đại diện cho nhiều người dùng. Không dùng `X-Forwarded-For` hoặc `CF-Connecting-IP` do client gửi trực tiếp làm khóa giới hạn: chúng có thể bị giả mạo. Muốn giới hạn theo khách thực cần cấu hình real IP với danh sách proxy đáng tin cậy được cập nhật và bảo vệ origin khỏi truy cập trực tiếp, hoặc đặt rate limit/WAF ở edge có xác thực IP. Thêm quota theo người dùng tại edge, phân biệt export và API thông thường, sau khi đo lưu lượng. Không thể suy ra cấu hình WAF riêng của Vietcap từ website công khai.

`robots.txt` và `X-Robots-Tag` là chỉ dẫn lập chỉ mục, không ngăn crawler cố tình truy cập. Không chặn hàng loạt theo User-Agent vì dễ giả mạo và có thể ảnh hưởng trình duyệt hoặc công cụ tìm kiếm hợp lệ.

Một số request tới Vietcap trong dự án gửi `Origin`, `Referer`, `User-Agent` và `device-id`; các giá trị này không chứng minh danh tính vì client có thể tự đặt. API hiện còn được Next.js server, các tích hợp trực tiếp và tác vụ nội bộ gọi, nên không yêu cầu các header giả trình duyệt ở origin. Nếu cần hạn chế truy cập thực sự, triển khai xác thực giữa proxy và origin bằng bí mật lưu ở server, đồng thời kiểm kê và chuyển đổi mọi client trước khi bắt buộc xác thực.
