<div align="center">

# Quang Anh Stocks

### Nền tảng nghiên cứu và định giá cổ phiếu Việt Nam

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-22C55E)](LICENSE)

[Khám phá tính năng](#tính-năng) · [Bắt đầu nhanh](#bắt-đầu-nhanh) · [Kiến trúc](#kiến-trúc) · [Đóng góp](#đóng-góp)

</div>

Quang Anh Stocks là nền tảng nghiên cứu thị trường chứng khoán Việt Nam, tập hợp dữ liệu thị trường, thông tin doanh nghiệp, công cụ sàng lọc và chỉ báo định giá trong một trải nghiệm song ngữ Việt–Anh.

> **Lưu ý:** Sản phẩm phục vụ mục đích nghiên cứu và giáo dục; không phải là khuyến nghị đầu tư.

## Tính năng

| Nhóm | Điểm nổi bật |
|---|---|
| Tổng quan thị trường | Chỉ số, độ rộng thị trường, cổ phiếu biến động mạnh, heatmap ngành và thị trường quốc tế |
| Phân tích cổ phiếu | Giá, biểu đồ, sổ lệnh, lịch sử giá, báo cáo tài chính, tỷ số, cổ đông, doanh nghiệp cùng ngành và sự kiện |
| Định giá & kỹ thuật | Theo dõi P/E, P/B theo thời gian, đối chiếu với ngành, cùng tín hiệu kỹ thuật trực tiếp |
| Stock Screener | Lọc cổ phiếu HOSE, HNX và UPCOM theo định giá, chất lượng, tăng trưởng, vốn hoá, sàn và ngành ICB |
| Vĩ mô & dòng tiền | Giao dịch khối ngoại, tỷ giá, hàng hoá, chỉ báo kinh tế và cơ cấu GDP |
| Tin tức hỗ trợ AI | Tin tức doanh nghiệp/thị trường, sự kiện cổ phiếu và các bản tóm tắt hỗ trợ nghiên cứu |

## Công nghệ

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS và Recharts
- **Backend:** Flask, Flask-Sock và Socket.IO
- **Dữ liệu:** SQLite, Pandas, NumPy và các quy trình cập nhật Python
- **Triển khai:** API REST qua proxy cùng WebSocket cho dữ liệu thời gian thực

## Bắt đầu nhanh

### Yêu cầu

- Node.js 20.9 trở lên
- Python 3.8 trở lên
- npm

### Cài đặt

```bash
git clone https://github.com/quanganhtapcode/valuation.git
cd valuation

pip install -r requirements.txt
cd frontend-next && npm install && cd ..
```

### Chạy local

Chạy backend và frontend trong hai terminal riêng:

```bash
# Terminal 1
npm run start-backend
```

```bash
# Terminal 2
npm run start-frontend
```

Frontend mặc định chạy tại `http://localhost:3000`. Để cấu hình kết nối backend cục bộ, sao chép `frontend-next/.env.example` thành `frontend-next/.env.local` và điều chỉnh các biến môi trường cần thiết.

## Kiến trúc

```text
Browser
  │
  ├── REST /api/* ──> Next.js API proxy ──> Flask API
  └── WebSocket ──────────────────────────> Flask Socket endpoint
                                           │
                                      SQLite & data pipelines
```

| Thư mục | Vai trò |
|---|---|
| `frontend-next/` | Ứng dụng Next.js: routes, components, API clients và giao diện |
| `backend/` | Flask API, nghiệp vụ định giá và các dịch vụ dữ liệu |
| `automation/` | Tác vụ cập nhật dữ liệu, xuất báo cáo và vận hành định kỳ |
| `fetch_sqlite/` | Các công cụ thu thập và xử lý dữ liệu SQLite |
| `docs/` | Tài liệu kỹ thuật và vận hành |

## Kiểm tra chất lượng

```bash
cd frontend-next
npm run lint
npm run build
```

Với thay đổi ở backend hoặc pipeline, hãy chạy trực tiếp tác vụ liên quan, ví dụ:

```bash
python run_pipeline.py
```

## Đóng góp

Đóng góp, báo lỗi và đề xuất cải tiến đều được hoan nghênh. Trước khi mở pull request, vui lòng chạy lint/build cho phần frontend bị ảnh hưởng và mô tả rõ thay đổi cùng cách kiểm tra.

## Miễn trừ trách nhiệm

Dữ liệu và phân tích trên Quang Anh Stocks chỉ nhằm hỗ trợ nghiên cứu. Thông tin có thể bị chậm, thiếu hoặc thay đổi; luôn tự xác minh trước khi đưa ra bất kỳ quyết định đầu tư nào.

## Giấy phép

Phát hành theo [giấy phép MIT](LICENSE).
