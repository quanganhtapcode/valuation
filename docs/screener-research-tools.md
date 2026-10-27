# Công cụ nghiên cứu trên Screener

Truy cập `/vi/screener` hoặc `/en/screener`.

- Tích ô cạnh mã cổ phiếu để chọn tối đa 5 mã, kể cả khi chuyển trang hoặc đổi điều kiện lọc. Bỏ mã bằng ô chọn hoặc nút × trong bảng so sánh.
- Trên điện thoại, kết quả hiển thị dạng thẻ: giá, định giá và tăng trưởng đọc ngay, không cần cuộn ngang. Công cụ lưu/chia sẻ và thông tin nguồn được thu gọn.
- Sau khi chọn ít nhất 2 mã, bấm **So sánh đã chọn** để mở bảng. Trên điện thoại, xem hai mã mỗi lần và đổi cặp bằng danh sách chọn; desktop hiển thị cả nhóm.
- Bảng so sánh hiển thị giá, vốn hóa, P/E, P/B, ROE, biên lợi nhuận và tăng trưởng doanh thu/lợi nhuận. Ô xanh/vàng đánh dấu giá trị cao nhất/thấp nhất trong nhóm đã chọn, không phải xếp hạng chất lượng hay thống kê ngành.
- Nhập tên rồi bấm **Lưu bộ lọc** để lưu điều kiện, thứ tự sắp xếp và danh sách so sánh. Tối đa 20 mục trên trình duyệt hiện tại; cùng tên sẽ thay thế. Dữ liệu này không đồng bộ giữa thiết bị.
- Bấm **Chia sẻ bộ lọc & so sánh** để tạo URL. Nếu clipboard bị chặn, sao chép từ ô liên kết hiện ra. URL khôi phục điều kiện và mã cổ phiếu, không đóng băng số liệu tại thời điểm chia sẻ.
- Mẫu tăng trưởng áp dụng doanh thu và lợi nhuận YoY tối thiểu 20%; không phải khuyến nghị đầu tư.
- Mở **Nguồn dữ liệu, thời gian & cách đọc chỉ tiêu** để xem đơn vị, định nghĩa và giới hạn thời gian. Thời điểm nhận kết quả là thời gian trình duyệt nhận phản hồi, không phải thời điểm giao dịch hoặc cập nhật báo cáo.

## Giới hạn dữ liệu

Sử dụng API `/api/market/screener` hiện có, bao gồm tham số `tickers` để so sánh. Chưa bổ sung dữ liệu nợ, dòng tiền hay trung vị ngành vì endpoint này chưa cung cấp các trường đó. Kỳ báo cáo và thời điểm cập nhật gốc từng chỉ tiêu chưa có trong phản hồi; không suy diễn từ thời gian tải trang. Mã không có dữ liệu sẽ được thông báo, giá trị thiếu hiển thị —, giá trị 0 vẫn được giữ nguyên.

Không cần biến môi trường, dependency hoặc migration database mới.

## Kiểm tra

Chạy `cd frontend-next && npm run lint` và `npm run build` để kiểm tra frontend.
