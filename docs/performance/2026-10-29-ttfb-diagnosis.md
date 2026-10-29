# HTML TTFB: kiểm tra đường CDN và ISR

## Kết luận hiện tại

Chưa có bằng chứng rằng chỉ sửa frontend có thể đưa mọi lượt tải xuống mức
46 ms đã đo ở Kalshi. Website đang đi qua Cloudflare rồi Vercel; HTML thường có
`cf-cache-status: DYNAMIC`, đồng thời có các lượt đi tới tầng ISR ở `sin1`.
Vercel ghi rõ ISR cache nằm tại function region, khác với CDN cache gần người dùng.

Đã so sánh cùng URL `https://stock.quanganh.org/vi`, vẫn kiểm tra chứng chỉ TLS,
bằng cách override phân giải DNS riêng trong curl để kết nối trực tiếp Vercel.
Không đổi DNS công khai trong các phép thử.

| Trung vị 5 cặp, curl không giả lập mạng | Qua Cloudflare | Trực tiếp Vercel |
| --- | ---: | ---: |
| Đợt thứ nhất | 141 ms | 75 ms |
| Đợt thứ hai | 86 ms | 63 ms |
| CNAME rank 1 do Vercel xác nhận | 123 ms | 52 ms |

Tất cả response trong hai cặp so sánh trên là HTTP 200. DNS/TLS chỉ chiếm vài
chục ms; phần lớn biến động xuất hiện sau khi kết nối đã sẵn sàng. Hai đợt nhỏ
này cho thấy một cơ hội giảm độ trễ ở đường proxy, không đủ để dự báo mức cải
thiện cho mọi người dùng hoặc quy toàn bộ chênh lệch với Kalshi cho Cloudflare.
Các response curl 429 của Kalshi được lưu để chẩn đoán nhưng **không** dùng làm
kết quả tải HTML; các phép đo browser so sánh dùng response 200.

Sau khi được cấp quyền team Vercel, đã xác nhận production READY tại `sin1`,
domain đã verified, DNS bên ngoài do Cloudflare quản lý. Vercel khuyến nghị CNAME
rank 1 `83bae3792b6f3cab.vercel-dns-017.com.`; domain không bị báo misconfigured.
Đợt curl rank 1 trong bảng dùng đúng đích đã được Vercel xác nhận.

Đã thử thêm bằng Chromium với host-resolver override tới IP Vercel được khuyến
nghị, giữ nguyên URL `stock.quanganh.org`, HTTPS và kiểm tra chứng chỉ. Đây là
mô phỏng DNS-only trong trình duyệt đo, **không phải đổi DNS công khai**. Cùng
cấu hình với benchmark trước (cache trình duyệt trống, desktop và mobile CPU 4x,
mạng giả lập 10 Mbps và 40 ms, 12 giây mỗi lượt):

| Chromium, trung vị 3 lượt | Desktop TTFB | Mobile TTFB |
| --- | ---: | ---: |
| Trực tiếp Vercel qua override DNS | 37 ms | 32 ms |

Cả 6 lượt trả 200, có snapshot chart, không có uncaught page exception. Đường
trực tiếp vẫn có kết quả thấp ở cả HIT và STALE, nên không cần giữ HTML lâu hơn
để có lợi ích này. Phải đo lại sau khi đổi DNS thật; các kết quả ở một môi trường
không bảo đảm thời gian tương tự tại mọi vị trí mạng.

## Thay đổi và thử nghiệm

- `5a89183`: thu hẹp Node Proxy để canonical public pages, API và assets không
  chạy qua đoạn xử lý chỉ trả `NextResponse.next()`. Giữ lựa chọn ngôn ngữ tại
  `/`, legacy redirects, chuẩn hóa symbol và 404 sớm cho cổ phiếu không hợp lệ.
- Bốn kiểm tra bằng helper của Next và production build thành công. Đo qua nhiều
  chu kỳ 15 giây vẫn thấy các lượt tới `sin1`, nên không coi bỏ Proxy là lời giải
  đủ cho toàn bộ độ trễ.
- `de4b201`: thử Vercel CDN cache 60 giây riêng HTML overview, loại RSC. Header
  có hiệu lực: thấy cache HIT với age vượt 15 giây. Tuy nhiên TTFB vẫn biến động,
  có cả đường `gru1::sin1` và `iad1::sin1`; không có cải thiện ổn định trong các
  lượt đo này. Không thể tách ảnh hưởng của cache lạnh và đường mạng để gán mức
  chênh lệch đó chỉ cho chính sách cache.
- `86a7691`: hoàn tác toàn bộ chính sách cache thử nghiệm, giữ snapshot và
  browser/RSC caching theo chính sách Next trước đó. Không giữ HTML lâu hơn chỉ
  để cải thiện một điểm benchmark.

## Bước hạ tầng cụ thể

Đề xuất kiểm chứng frontend dùng CDN Vercel trực tiếp: trong Cloudflare, chuyển
**riêng record `stock.quanganh.org`** từ Proxied sang DNS only. Giữ nguyên đích
record đang trỏ tới Vercel; không thay bằng IP tạm dùng trong curl. Không đổi
`api.quanganh.org` hay nameserver của cả zone. Các header Origin/Referer mà API
nhận vẫn giữ domain `stock.quanganh.org`.

Nếu có nhiều A/AAAA cùng tên thì cần kiểm tra toàn bộ các record đó; Cloudflare
có thể tiếp tục proxy khi một record cùng tên vẫn được proxied. Cần kiểm tra
domain config trong Vercel trước khi thay đổi. DNS đổi trạng thái thường cần
vài phút để resolver cập nhật. Rollback bằng cách bật lại Proxied cho đúng record.

Sau thay đổi, đo lại cả cold/warm cache trên desktop và mobile, kiểm tra chứng
chỉ HTTPS, HTML/RSC, `/vi`, `/en`, legacy redirect và invalid-stock 404. Hiện chưa
thay đổi DNS vì chưa có kết nối quản trị Cloudflare. Kết nối Vercel đã đọc được
cấu hình domain sau khi người dùng cấp quyền team. Production sau rollback đã
vượt qua kiểm tra redirect/404, phân biệt HTML với RSC và client navigation từ
VCB về overview có chart, không có uncaught exception.

## Nguồn và dữ liệu

- [Vercel: các tầng CDN và ISR cache](https://vercel.com/docs/how-vercel-cdn-works#caching-layers)
- [Vercel: không khuyến nghị proxy chồng trước Vercel](https://vercel.com/kb/guide/can-i-use-a-proxy-on-top-of-my-vercel-deployment)
- [Cloudflare: Proxied và DNS only](https://developers.cloudflare.com/dns/proxy-status/)
- [Số đo từng lượt](2026-10-29-ttfb-diagnostics.json)
