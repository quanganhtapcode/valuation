# Tải trang tổng quan và heatmap — 19/10/2026

## Đo trên website đang chạy

Các phép đo cùng máy kiểm tra, gọi endpoint công khai qua HTTPS:

| Request | API trực tiếp | Qua domain website / Next proxy |
| --- | ---: | ---: |
| Heatmap, lượt đo đầu | 131 ms | 2.709 ms |
| Heatmap, hai lượt sau khi đã có cache backend | 49–57 ms | 572–609 ms |
| Tin tức, cache CDN đã hit | — | 119–121 ms |

Thời gian xử lý Flask của heatmap trong lượt đầu khoảng 15 ms. Response website có `x-vercel-id: iad1::sin1::...`: function đang ở Singapore. Những số này tách được phần xử lý backend khỏi đường truyền, proxy và khởi động function; chưa đủ để quy toàn bộ độ trễ cho một region hoặc kết luận nên đổi region.

Chromium với cache trình duyệt trống ghi nhận heatmap xuất hiện sau khoảng 2,79 giây ở viewport desktop và 1,87 giây ở viewport mobile trong hai lượt kiểm tra. Đây là mẫu đo tại máy kiểm tra, không phải Core Web Vitals của người dùng thực tế. HTML lúc đó không chứa heatmap và truyền toàn bộ các mảng dữ liệu ban đầu rỗng.

## Nguyên nhân

- Heatmap chờ hydrate, IntersectionObserver, tải chunk riêng, mount component rồi mới bắt đầu gọi API. API backend nhanh vẫn không loại bỏ chuỗi chờ này.
- Endpoint heatmap dùng `no-store`, nên mỗi lượt mở trang phải đi qua function và VPS, kể cả khi backend đã có cache.
- Lần gọi đầu lỗi ngoài giờ giao dịch có thể để spinner chờ 5 phút trước khi thử lại.
- Feed chỉ số trước giờ giao dịch trả `price: 0` nhưng có `refPrice` hợp lệ. Giao diện loại bỏ các snapshot này, khiến trạng thái thiếu dữ liệu kéo dài dù request đã xong.

## Thay đổi

- Fetch các snapshot nhỏ song song phía server: chỉ số, heatmap, tin tức, top tăng/giảm và giá vàng. Heatmap và chỉ số có budget tối đa 2,5 giây; nguồn phụ tối đa 800 ms để không giữ các panel chính chờ giá vàng hoặc tin tức.
- Render heatmap ngay từ HTML, bỏ defer và dynamic chunk ở panel này. Các panel thấp hơn tiếp tục được defer.
- Cache dữ liệu server 15/60 giây theo nguồn và revalidate HTML 15 giây. Client tính tuổi snapshot từ header Date để refresh đúng hạn, giữ bản hiện có trong lúc cập nhật.
- Chỉ heatmap có cache CDN 5 giây, stale window 10 giây và browser `max-age=0`. Giá trực tiếp, lỗi và yêu cầu bypass vẫn `no-store`.
- Heatmap timeout 10 giây, lỗi thử lại sau 2/4/8/15 giây. Response rỗng không thay bản dữ liệu tốt; đổi sàn không hiển thị dữ liệu của sàn trước.
- Memo hóa layout heatmap và nhóm mã lớn nhất; SVG responsive ngay trước hydration.
- Khi feed reset, hiển thị giá tham chiếu với nhãn Việt/Anh và màu trung tính. Không hiển thị mức tăng giả hoặc tạo nến giao dịch hôm nay từ giá tham chiếu.
- Thêm `Server-Timing: upstream` để phân biệt thời gian proxy gọi API với thời gian Flask xử lý.

HTML lớn hơn vì chứa SVG và snapshot, đổi lại heatmap hiển thị trước hydration và không chờ request API đầu tiên. Script inline của React vẫn dùng để mở các segment streaming; bundle client không cần tải xong để hiển thị heatmap. Không có thay đổi database, backend Python hoặc biến môi trường.

## Kiểm tra

Kiểm thử bao phủ cache, fetch song song, nguồn lỗi độc lập, tuổi snapshot, retry và feed reset trước giờ giao dịch. Dùng build production và Chromium để kiểm tra heatmap khi chặn bundle hydration, kích thước SVG mobile, refresh lỗi giữ dữ liệu, đổi sàn rồi phục hồi sau HTTP 503. Các artifact đo tạm được lưu tại `/tmp/valuation-load-audit/` trên workspace.

- 38 kiểm thử TypeScript đạt; lint không có lỗi, còn một warning cũ tại `useScroll.ts`; TypeScript strict check đạt.
- Production build Webpack đạt, tạo đủ 38 trang tĩnh. HTML Việt/Anh đều có SVG heatmap và nhãn giá tham chiếu trước hydration.
- Chromium desktop 1440×1000 và mobile 390×844: heatmap vẫn hiện khi chặn bundle, SVG vừa màn hình, refresh lỗi không xóa dữ liệu, không có runtime error.
- Mô phỏng lần gọi HNX đầu trả 503: lần gọi thứ hai thành công sau khoảng 2,47 giây ở cả hai viewport, thay vì đợi chu kỳ 5 phút.
