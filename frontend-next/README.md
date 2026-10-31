# Frontend Quang Anh Stocks

Ứng dụng Next.js, React và TypeScript cho nền tảng nghiên cứu cổ phiếu.
Xem [README dự án](../README.md) để biết kiến trúc backend và cách vận hành VPS.

## Bắt đầu

Chạy từ `frontend-next/`:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Các lệnh hỗ trợ: `npm run lint`, `npm run test:api`, `npm run build`, `npm run start`.
`npm run start` cần bản build đã hoàn tất.

## Kết nối API

Trên production, trình duyệt gọi trực tiếp API công khai:

```text
Trình duyệt -> trading-api.quanganh.org/v1/valuation/... -> Flask API
```

| Biến | Vai trò |
| --- | --- |
| `BACKEND_API_URL` | Backend cho proxy phía server ở production |
| `BACKEND_API_URL_LOCAL` | Backend cho môi trường development |
| `NEXT_PUBLIC_API_BASE_URL` | Gốc REST API phía trình duyệt |
| `NEXT_PUBLIC_BACKEND_WS_URL` | Địa chỉ WebSocket phía trình duyệt |

Giá trị production của HTTP và WebSocket lần lượt là
`https://trading-api.quanganh.org/v1/valuation` và `wss://trading-api.quanganh.org/v1/valuation`.
Local thường dùng `http://127.0.0.1:8000/api` và `ws://127.0.0.1:8000`.
Proxy `/api/...` vẫn phục vụ development và tương thích với client cũ; giá cổ phiếu có thể dùng proxy khi request trực tiếp thất bại. WebSocket kết nối trực tiếp tới VPS. Không đặt địa chỉ backend rải rác trong component.

Không dùng lại `NEXT_PUBLIC_API_URL` hoặc `NEXT_PUBLIC_REALTIME_API_URL`.
Thay đổi biến `NEXT_PUBLIC_*` cần build và triển khai lại frontend.

## Cấu trúc chính

| Đường dẫn | Nội dung |
| --- | --- |
| `src/app/` | Trang, route và API proxy |
| `src/components/` | Giao diện theo tính năng và UI dùng chung |
| `src/hooks/`, `src/contexts/` | Hook và trạng thái dùng chung |
| `src/lib/` | API client, kiểu dữ liệu, formatter và xuất Excel |
| `public/ticker_data.json` | Danh mục mã dùng cho frontend và Excel |
| `scripts/` | Kiểm thử, kiểm tra bản dịch và công cụ phát triển |

## Kiểm tra và triển khai

```bash
npm run lint
npm run test:api
npm run build
```

Với thay đổi proxy, kiểm tra `/api/health` qua frontend khi backend local đang chạy.
Frontend production được triển khai riêng trên Vercel; sửa source trên VPS không
tự cập nhật website. Không đưa secret phía server vào biến `NEXT_PUBLIC_*`.
